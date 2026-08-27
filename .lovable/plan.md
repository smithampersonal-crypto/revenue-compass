# ASC 606 SaaS Revenue Recognition — Revised Specification (Phase 0)

## 0. Conflict that must be resolved first (accounting policy)

Test 1 expects **$10,000 per month** for a $120,000 annual SaaS PO. A pure daily-ratable convention does **not** produce that: 365 service days at $328.767123/day gives January $10,191.78, February $9,205.48, April $9,863.01. The two requirements are mathematically incompatible.

Two defensible policies:

- **Policy A — Pure daily ratable.** Every month = allocated price x days in month / total service days. Test 1 expected results become $10,191.78 / $9,205.48 / ... (not $10,000).
- **Policy B — Full-month + daily stub (recommended default).** A calendar month wholly inside the service period receives an equal share of the whole-month portion; only partial (stub) months are prorated on days. A Jan 1–Dec 31 contract yields exactly $10,000/month, and a Jan 15 start yields a prorated January plus equal later months.

**Recommendation: Policy B**, as the default, with Policy A selectable per PO later. It matches how most SaaS revenue teams actually schedule ratable subscriptions and matches the Test 1 expectation. Everything below is written so either policy plugs into one function (`recognizeOverTime`). **Please confirm A or B before Phase 1.**

## 1. Revised architecture

Four layers, strictly separated:

1. **Inputs (authoritative):** contract facts, Step 1 criteria, promises, promise-to-PO grouping, PO-level SSP, transaction price, billing events, recognition method/dates, unbilled-right classification, judgments.
2. **Engine (pure TypeScript, no React, no I/O):** allocation, recognition, billing, contract balances, journal entries, validation. Deterministic and unit-testable.
3. **Derived outputs (read-only):** allocation table, revenue schedule, balance roll-forward, journal entries, validation results. Never user-editable; always recomputed from inputs.
4. **Presentation:** React components that render engine output and never perform arithmetic.

```text
Inputs ──> engine.analyzeContract(input) ──> ContractAnalysis (all outputs + explanations)
                                              └─> UI renders; nothing is edited downstream
```

Future `analysis_versions` snapshot: the engine returns a single serializable `ContractAnalysis` object, so "finalize" can later persist that object plus an input hash. Not built in MVP.

## 2. Entity model

```text
contracts(id, customer_name, contract_number, contract_date,
          term_start, term_end, transaction_price_cents, currency,
          step1_approved, step1_rights_identifiable, step1_payment_terms_identifiable,
          step1_commercial_substance, step1_collection_probable, step1_notes,
          step1_conclusion  -- derived: qualifies / does not qualify
         )

contract_promises(id, contract_id, seq, description, category, notes,
                  is_distinct, distinct_rationale,
                  performance_obligation_id NULL)      -- the grouping link

performance_obligations(id, contract_id, seq, name,
                        classification ('single_distinct' | 'bundle_not_distinct' | 'series'),
                        classification_rationale,
                        ssp_cents,                      -- SSP lives HERE, not on promises
                        recognition_method ('over_time_ratable' | 'point_in_time'),
                        service_start, service_end,     -- over time
                        recognition_date,               -- point in time
                        unbilled_right_treatment ('contract_asset' | 'receivable'),
                        unbilled_right_rationale,
                        unconditional_date NULL)        -- when a contract asset becomes AR

billing_events(id, contract_id, billing_date, amount_cents, description)

accounting_judgments(id, contract_id, issue, conclusion, reasoning, asc_reference)
```

**Promise ↔ PO relationship:** one-to-many (a PO has many promises; each promise belongs to exactly zero or one PO). A promise with no PO is a validation failure. Implemented as a nullable FK on `contract_promises` — the simplest structure that supports the required grouping and is easy to query in SQL. No join table, because a promise cannot belong to two POs.

**UI for grouping (Step 2, kept simple):** a two-panel screen. Left: the promise list the accountant entered, each row with distinct? + rationale. Right: performance obligations. Each promise row has a "Performance obligation" dropdown listing existing POs plus "+ New performance obligation". Selecting a PO moves the promise under it visually. Unassigned promises sit in a highlighted "Not yet assigned" tray. No drag-and-drop (fragile, unnecessary).

**Persistence split:** store inputs (all tables above). Do **not** store revenue schedules, allocations, waterfalls, or JEs — regenerate them. The only future exception is an immutable finalized snapshot.

## 3. PO classification (documentation field)

`classification` is a required select with rationale text: single distinct good or service; bundle of promises not separately distinct; series of distinct goods/services accounted for as one PO. It drives no calculation in V1 — it appears on the PO tab, the results summary, and the judgments export.

## 4. Engine inputs and outputs

```ts
analyzeContract(input: ContractInput): ContractAnalysis

ContractAnalysis = {
  step1: { qualifies: boolean; failedCriteria: string[] }
  allocation: AllocationRow[]          // po, ssp, totalSsp, pct, allocatedCents, explanation
  revenueSchedule: {
    byPo: { poId, month, revenueCents, explanation }[]
    byMonth: { month, perPo: Record<poId, cents>, totalCents, cumulativeCents }[]
  }
  billingSchedule: { month, billedCents, cumulativeCents }[]
  balances: BalanceRow[]               // see §7
  journalEntries: JournalEntry[]       // see §8
  validation: { status: 'passed' | 'attention'; results: CheckResult[] }
  totals: { transactionPrice, allocated, revenue, billed }
}
```

Every numeric row carries an `explanation` object (`{ template, inputs }`, e.g. `{ template: 'ratable_month', inputs: { allocated: 8000000, days: 31, totalDays: 365 } }`) so the UI can later render "…x 31 March days / 365 total days" without recomputation.

## 5. Date conventions

- Dates are **plain `YYYY-MM-DD` strings** everywhere — inputs, engine, storage. No JS `Date` objects in the engine, no ISO timestamps, no timezone conversion. Arithmetic uses a small `dateUtils` module that converts to a day index via UTC-only math and back.
- Service **start and end dates are both inclusive**; total service days = `daysBetween(start, end) + 1`.
- Calendar days; leap years fall out naturally (2028 Jan 1–Dec 31 = 366 days).
- Mid-month commencement and termination supported; a month's eligible days = overlap of [month start, month end] with [service start, service end].
- Reporting periods are calendar months keyed `YYYY-MM`.
- Point in time: full allocated amount in the month containing `recognition_date`.

## 6. Rounding conventions

- All money is stored and computed as **integer cents**. Intermediate ratios use floating point only inside a single expression, never accumulated.
- **Allocation:** `raw_i = transactionPrice x ssp_i / totalSsp`, rounded half-up to cents; the residual (`transactionPrice - sum(rounded)`) is assigned to the **PO with the largest SSP** (deterministic, tie broken by lowest sequence). Guarantees exact tie-out.
- **Recognition:** months computed in order, each rounded to cents; the **final recognition month** of each PO receives `allocated - sum(prior months)`. Guarantees each PO's schedule sums exactly to its allocation, and therefore total revenue = transaction price.
- Displayed values are already cents — no display-time rounding, so screen totals always foot.

## 7. Contract balances: AR, contract asset, contract liability

Billing and revenue are tracked as separate event streams and combined per month:

```text
For each month, per contract (V1 presents one net contract position):
  beginning_liability, beginning_asset, beginning_ar   (prior month's endings)
  + billings_this_month           -> Dr AR, Cr liability (or relieves an asset first, see §8)
  + revenue_this_month            -> relieves liability first, then creates asset or AR
  + reclass_this_month            -> contract asset -> AR on unconditional_date
  = ending_liability, ending_asset, ending_ar
```

Rules:
1. Revenue first relieves any existing contract liability, up to its balance.
2. Revenue in excess of the liability creates an **unbilled right**, classified by the accountant's PO-level `unbilled_right_treatment`: `receivable` (unconditional, right depends only on passage of time) or `contract_asset` (conditional on something else). Never inferred automatically.
3. Billings first relieve any existing contract asset for that PO's unbilled amount, then create a contract liability.
4. On a PO's `unconditional_date`, its remaining contract asset reclassifies to AR.
5. Control: `cumulative_billings + cumulative_reclass_neutral = cumulative_revenue + ending_liability - ending_asset` must hold every month; the engine asserts `beginning + billings - revenue +/- reclass = ending`.

No cash receipts in V1; AR simply accumulates.

## 8. Journal entry generation

Entries are derived per month from the three event types, in this fixed order:

1. **Billing:** `Dr Accounts Receivable / Cr Contract Liability` for the billed amount (reduced by any contract asset relieved, which instead books `Dr AR / Cr Contract Asset`).
2. **Revenue against liability:** for the portion of the month's revenue covered by the liability balance — `Dr Contract Liability / Cr Revenue`.
3. **Revenue creating an unbilled right:** remainder — `Dr Contract Asset / Cr Revenue` or `Dr Accounts Receivable / Cr Revenue`, per the PO's classification.
4. **Reclassification:** on `unconditional_date` — `Dr Accounts Receivable / Cr Contract Asset`.

Each entry line references the month, source event, amount in cents, and a memo naming the PO. Control: total debits = total credits per month, and JE-derived account balances must equal the roll-forward balances in §7 (asserted by a validation check, not by trust).

## 9. Validation architecture

A single `validation.ts` returns `CheckResult[]` (`id`, `category`, `severity`, `message`, `passed`, optional `detail`). UI components render this list and never author checks. Categories and checks:

- **Contract setup:** all five Step 1 criteria satisfied (blocking for finalization); transaction price >= 0; term start/end present; term end >= term start.
- **Performance obligations:** every promise assigned to a PO; every PO has >= 1 promise; every PO has SSP > 0; total SSP > 0; every PO has a recognition method; PO classification documented.
- **Allocation:** SSP percentages total 100%; allocated total = transaction price exactly.
- **Revenue:** over-time POs have valid start <= end; point-in-time POs have a recognition date; recognition dates fall within the contract term (warning if outside); total scheduled revenue = total allocated.
- **Billing:** each event has a valid date and non-negative amount; total billings reconcile to the expected total billings entered by the accountant.
- **Balances:** roll-forward reconciles each month; asset and liability are never simultaneously non-zero for the same PO; JE debits = credits and JE balances tie to the roll-forward.

**Status banner:** `All Accounting Checks Passed` only when every blocking check passes **and** Step 1 qualifies. If Step 1 fails, the Results page renders a prominent "Analysis not finalized — ASC 606 contract criteria not met" banner, keeps all entered data and schedules visible as illustrative, and marks them "not a completed ASC 606 analysis." No pre-contract (ASC 606-25-7) accounting in V1.

## 10. Module structure

```text
src/lib/asc606/
  types.ts          contract input + analysis output types
  dates.ts          YYYY-MM-DD arithmetic, month enumeration, day overlap
  money.ts          cents math, half-up rounding, residual assignment
  allocation.ts     relative SSP allocation across POs
  recognition.ts    over-time (policy A/B) + point-in-time schedules
  billing.ts        billing events -> monthly billing schedule
  balances.ts       AR / contract asset / contract liability roll-forward
  journalEntries.ts entries derived from billing, revenue, reclass events
  validation.ts     all checks, single source of truth
  explain.ts        explanation templates for UI
  index.ts          analyzeContract() orchestrator
  __tests__/        one spec file per module + scenarios.spec.ts
src/data/sampleContracts.ts   fictional seed data
```

## 11. Test suite (Vitest) — expected results

Assumes Policy B where relevant; Policy A numbers noted.

| # | Scenario | Expected |
|---|---|---|
| 1 | Annual SaaS, 1 PO, $120,000, 1/1/27–12/31/27 | $10,000.00 each month; total $120,000.00 (Policy A: Jan $10,191.78, Feb $9,205.48, Apr $9,863.01) |
| 2 | Mid-month start: $35,100, 1/15/27–12/31/27 (351 days) | $100.00/day; Jan (17 days) $1,700.00; Feb $2,800.00; Dec $3,100.00; total $35,100.00 (Policy A figures; Policy B prorates Jan only and spreads the rest equally over 11 months at $3,036.36/$3,036.40 final) |
| 3 | Leap year: $366,000, 1/1/28–12/31/28 (366 days) | $1,000.00/day; Feb $29,000.00; total $366,000.00 |
| 4 | Two POs: SaaS SSP $120,000, Training SSP $20,000, TP $120,000 | 85.714286% / 14.285714%; allocated $102,857.14 and $17,142.86; sum $120,000.00 |
| 5 | Penny rounding: TP $100,000, three POs SSP $10,000 each | $33,333.33 / $33,333.33 / $33,333.34 (residual to largest SSP, tie -> lowest seq... documented as last) ; sum exactly $100,000.00 |
| 6 | SaaS + non-distinct implementation grouped into 1 PO | Exactly one allocation row; no separate allocation to the two promises; PO classification `bundle_not_distinct` |
| 7 | SaaS over time + distinct training point-in-time (Test 4 amounts, training 1/15/27) | Training $17,142.86 all in Jan-2027; SaaS $102,857.14 ratably; Jan total $25,714.62 (Policy B) |
| 8 | Upfront billing $120,000 on 1/1/27 | Jan beginning liability $0, billings $120,000, revenue $10,000, ending liability $110,000; Dec ending $0 |
| 9 | Billing in arrears (bill $10,000 on the last day of each following month) | Month 1 revenue $10,000 with no billing -> unbilled right $10,000, presented as contract asset or AR per the PO election; both variants tested |
| 10 | Contract asset then unconditional on 3/31/27 | Asset balance reclassifies: `Dr AR / Cr Contract Asset` for the full asset balance on 3/31/27; ending asset $0 |
| 11 | service_end before service_start | Validation fails (`po.dates.sequence`); status = attention; no schedule produced for that PO |
| 12 | SSP missing or zero on one PO | Validation fails (`po.ssp.positive`); allocation not finalized |
| 13 | Step 1 collection-probable = false | `step1.qualifies = false`; status never `passed`; results banner shows not finalized |
| 14 | Irregular billings: $50,000 on 1/10/27, $25,000 on 4/5/27, $45,000 on 9/22/27 | Roll-forward reconciles every month; Dec ending liability and asset both $0; cumulative billings $120,000 = cumulative revenue |
| 15 | Full multi-element: SaaS + non-distinct implementation (PO1, SSP $130,000, over time) + distinct training (PO2, SSP $20,000, point-in-time 2/10/27), TP $135,000, billed $67,500 on 1/1/27 and 7/1/27 | PO1 86.666667% -> $117,000.00; PO2 13.333333% -> $18,000.00; sum $135,000.00; full schedule, roll-forward, and JEs all reconcile; validation passed |

Every numeric expectation is written into the spec files **before** the corresponding code.

## 12. Phased sequence (your sequence, accepted with one change)

- **Phase 0** — this specification + resolution of the open decisions below. No code.
- **Phase 1** — engine: types, dates, money, allocation, recognition, plus tests 1–7, 11, 12. No UI.
- **Phase 1b (added)** — a minimal internal `/engine-check` page that renders the sample contract's engine output as plain tables. Reason: it lets you eyeball real schedules before any wizard exists, at almost no cost. Removed or folded into Results in Phase 5.
- **Phase 2** — five-step workflow UI: contract facts, Step 1 criteria, promise entry, promise-to-PO grouping, PO setup (classification, SSP, method, dates).
- **Phase 3** — billing events, unbilled-right classification, contract balance roll-forward; tests 8, 9, 10, 14.
- **Phase 4** — journal entries + validation dashboard; test 13, JE/roll-forward reconciliation checks.
- **Phase 5** — Results experience: summary, allocation, schedule, waterfall, JEs, judgments, explanations; test 15 end to end.
- **Phase 6** — persistence (Lovable Cloud / Postgres) using the §2 model.
- **Phase 7** — portfolio polish: sample contracts, landing page, empty states, responsive pass, README.
- **Post-MVP** — as you listed.

Each phase closes with a report: Completed / Accounting behavior / Tests / Assumptions / Known limitations / Next phase.

## 13. Decisions I need from you before Phase 1

1. **Ratable convention (blocking):** Policy A (pure daily) or Policy B (full-month + daily stub, recommended). This changes Tests 1, 2, 7, 15.
2. **Rounding residual placement in allocation:** to the largest-SSP PO (recommended) or to the last PO by sequence. Test 5's expected numbers depend on it.
3. **Expected total billings:** should the accountant enter an expected billing total independent of the transaction price (so a mismatch is a real control), or should billings always be validated against the transaction price? Recommend the former.
4. **Unbilled-right election granularity:** per performance obligation (recommended, since conditionality is usually PO-specific) or a single contract-level election.
5. **Contract balance presentation:** one net contract-level position (recommended for V1, simpler) versus per-PO balances. Per-PO is more precise but doubles the roll-forward UI.
6. **Point-in-time recognition month:** recognized in the month containing the recognition date (recommended) — confirm no separate delivery-vs-acceptance date is needed.
7. **Contract asset vs receivable on reclass:** should `unconditional_date` be a single date per PO (recommended for V1) or a schedule of partial reclassifications?
