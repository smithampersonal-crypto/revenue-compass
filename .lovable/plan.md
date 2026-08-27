# ASC 606 SaaS Revenue Recognition — Specification (Phase 0, Final Corrections)

Sections below marked **[REVISED]** changed in response to the director review. Unchanged sections (architecture layers, PO classification, module structure, phase sequence, judgments/reference handling) stand as previously approved and are restated only where needed for continuity.

## 1. Decided conventions

- **Over-time ratable = Policy A (pure daily ratable), the only convention in V1.** Monthly revenue = allocated price x eligible service days in the month / total service days. Start and end dates inclusive; calendar days; leap years natural; mid-month commencement/termination natural. `recognizeOverTime(po, convention)` takes a `convention` argument with the single value `'daily_ratable'` in V1, so straight-line/stub conventions plug in later without an engine rewrite.
- **Point in time:** one accountant-entered `recognition_date`; full allocated amount in the month containing it. No delivery/acceptance/transfer dates in V1.
- **Currency: USD only.** No currency column, no selector; "USD" is a static label.
- **Billing reconciliation:** fixed consideration only, so transaction price = expected total billings. Sum of billing events must equal the transaction price exactly; a mismatch is a **blocking** validation failure.

## 2. Revised entity model **[REVISED]**

```text
contracts(id, customer_name, contract_number, contract_date,
          term_start, term_end, transaction_price_cents,
          step1_approved, step1_rights_identifiable, step1_payment_terms_identifiable,
          step1_commercial_substance, step1_collection_probable, step1_notes)
          -- no currency column; USD is implicit in V1

contract_promises(id, contract_id, seq, description, category, notes,
                  capable_of_being_distinct        boolean,
                  distinct_within_contract_context boolean,
                  distinct_conclusion              boolean,   -- accountant's Step 2 conclusion
                  distinct_rationale               text,
                  performance_obligation_id        FK NULL)

performance_obligations(id, contract_id, seq, name,
                        classification ('single_distinct'|'bundle_not_distinct'|'series'),
                        classification_rationale,
                        ssp_cents,
                        ssp_basis                    text,     -- how SSP was determined
                        recognition_method ('over_time_ratable'|'point_in_time'),
                        service_start, service_end,            -- over time, inclusive
                        recognition_date)                      -- point in time
                        -- unbilled_right_treatment and unconditional_date REMOVED

consideration_events(id, contract_id, seq, invoice_date, amount_cents,
                     unconditional_right_date,  -- defaults to invoice_date, overridable
                     description)
                     -- replaces billing_events

accounting_judgments(id, contract_id, issue, conclusion, reasoning, asc_reference)
```

Promise-to-PO relationship is unchanged: one-to-many via the nullable FK on `contract_promises`; grouping follows the accountant's Step 2 conclusions. SSP is entered **only at the PO level**, after grouping, with a required `ssp_basis` note. The engine never determines distinctness.

UI note: the Step 2 screen now shows three fields per promise — capable of being distinct, distinct within the context of the contract, and the resulting conclusion (defaulted to the logical AND but editable, with rationale required whenever it is overridden).

## 3. Billing / unconditional-right model **[REVISED]**

A `consideration_event` records an invoice **and** the date the related right to consideration becomes unconditional:

- `invoice_date` — when the invoice is issued. Used for presentation and memos only.
- `unconditional_right_date` — defaults to `invoice_date`; the accountant may override it when the right becomes unconditional on another discrete date. **This date, not the invoice, drives Accounts Receivable recognition.**
- An invoice whose unconditional-right date has not yet arrived produces no AR and no entry; it is listed as an issued-but-conditional invoice.

**MVP limitation (documented in the app):** Version 1 models unconditional rights as discrete dated events. It does not model continuously accruing unbilled receivables, partial conditionality, or rights that become unconditional in tranches within a single invoice.

## 4. Contract balance roll-forward **[REVISED]**

Definitions for month *t*:

```text
Rev_t   = revenue recognized in month t (sum across POs)
Unc_t   = consideration amounts whose unconditional_right_date falls in month t
CumRev_t = sum(Rev_1..t)      CumUnc_t = sum(Unc_1..t)

AR_t            = CumUnc_t                     (no cash receipts in V1)
NetPosition_t   = CumRev_t - CumUnc_t
  NetPosition_t > 0  -> Contract Asset  = NetPosition_t,     Contract Liability = 0
  NetPosition_t < 0  -> Contract Liability = -NetPosition_t, Contract Asset     = 0
  NetPosition_t = 0  -> both zero
```

Presented roll-forward, one net contract-level position per month, AR shown separately:

```text
Beginning contract asset / (liability)
  + Revenue recognized                (increases asset / decreases liability)
  - Unconditional rights arising      (decreases asset / increases liability)
  = Ending contract asset / (liability)

Beginning AR + Unconditional rights arising = Ending AR
```

**Event processing order within a month:** (1) unconditional-right events, (2) revenue recognition. This ordering only affects how a month's activity splits between relieving an existing balance and creating a new one in the journal entries; ending balances are order-independent because they derive from cumulative totals.

Because AR is created exactly once, at the unconditional-right date, and revenue never creates AR, there is no path that recognizes AR twice for the same right. Per-PO revenue detail is retained inside the engine for explanations and drill-down, but presentation is a single net contract position — never simultaneous gross asset and liability.

## 5. Journal entry logic **[REVISED]**

Per month, derived from the two event streams, in the fixed order above:

1. **Unconditional right arises (amount `U`).** `Dr Accounts Receivable U`. Credit side: relieve any existing contract asset first, up to the beginning contract-asset balance -> `Cr Contract Asset`; any remainder -> `Cr Contract Liability`.
2. **Revenue recognized (amount `R`).** `Cr Revenue R`. Debit side: relieve the contract liability balance available after step 1, up to that balance -> `Dr Contract Liability`; any remainder -> `Dr Contract Asset`.

Consequences: billing ahead of performance produces `Dr AR / Cr Contract Liability` then `Dr Contract Liability / Cr Revenue`; performance ahead of billing produces `Dr Contract Asset / Cr Revenue` then, when the right becomes unconditional, `Dr AR / Cr Contract Asset` — the reclassification entry falls out of the same rule rather than needing a separate mechanism. No cash receipt entries in V1.

Controls: per month, total debits = total credits; and the account balances rolled forward from the journal entries must equal the §4 balances exactly (asserted as a validation check).

## 6. Rounding algorithm **[REVISED]**

All money is integer cents. No floating-point arithmetic in allocation.

**Allocation (largest fractional remainder):**
1. For each PO *i*: `numerator_i = TP_cents * ssp_i`, `floor_i = numerator_i / totalSsp` using integer division, `remainder_i = numerator_i % totalSsp`. All values are exact integers (BigInt where products could exceed the safe integer range).
2. Start each PO at `floor_i` (never exceeds its exact entitlement). Compute `residual = TP_cents - sum(floor_i)`.
3. Distribute the `residual` cents one at a time to the POs with the largest `remainder_i`; ties broken by **lowest PO sequence number**.
4. Assertion: `sum(allocated_i) === TP_cents`.

**Recognition:** each month's amount = `round_half_up(allocated * eligibleDays / totalDays)` computed as exact integer arithmetic (`(allocated * days * 2 / totalDays + 1) / 2` in integer division); the **final recognition month** of each PO is set to `allocated - sum(prior months)`, absorbing any residual cent. Assertion: each PO's schedule sums exactly to its allocation, hence total revenue = transaction price.

## 7. Revised test expectations **[REVISED]**

All monetary assertions compare **exact integer cents** (`toBe` on cent integers), never `toBeCloseTo` or float equality. Every expected value below was computed before implementation.

**Test 1 — Annual SaaS, $120,000, 1/1/27–12/31/27, 365 days, daily ratable:**
Jan 10,191.78 · Feb 9,205.48 · Mar 10,191.78 · Apr 9,863.01 · May 10,191.78 · Jun 9,863.01 · Jul 10,191.78 · Aug 10,191.78 · Sep 9,863.01 · Oct 10,191.78 · Nov 9,863.01 · **Dec 10,191.80** (absorbs the $0.02 residual). Total 120,000.00.

**Test 5 — Penny rounding, TP $100,000, three POs with equal SSP $10,000:**
floor = 3,333,333 cents each, residual 1 cent, all remainders tie -> lowest sequence wins.
PO 1 **$33,333.34** · PO 2 $33,333.33 · PO 3 $33,333.33 · total $100,000.00.

**Test 7 — SaaS over time + distinct training point in time.** SSP SaaS $120,000 / Training $20,000; TP $120,000 -> allocation SaaS $102,857.14, Training $17,142.86 (exact: floors 10,285,714 and 1,714,285; residual 1 cent to the larger remainder = Training -> 1,714,286). Training recognized entirely in Jan-2027 ($17,142.86, recognition date 1/15/27). SaaS January = 102,857.14 x 31 / 365 = **$8,735.81**. **January total revenue $25,878.67.** SaaS remaining months: Feb 7,890.41 · Mar 8,735.81 · Apr 8,454.01 · May 8,735.81 · Jun 8,454.01 · Jul 8,735.81 · Aug 8,735.81 · Sep 8,454.01 · Oct 8,735.81 · Nov 8,454.01 · **Dec 8,735.83** (residual). SaaS total 102,857.14; contract total 120,000.00.

**Test 8 — Upfront billing $120,000, invoice and unconditional right both 1/1/27** (revenue per Test 1). AR $120,000.00 from January onward. Net position is a contract liability each month-end:
Jan 109,808.22 · Feb 100,602.74 · Mar 90,410.96 · Apr 80,547.95 · May 70,356.17 · Jun 60,493.16 · Jul 50,301.38 · Aug 40,109.60 · Sep 30,246.59 · Oct 20,054.81 · Nov 10,191.80 · Dec 0.00. January entries: `Dr AR 120,000.00 / Cr Contract Liability 120,000.00`, then `Dr Contract Liability 10,191.78 / Cr Revenue 10,191.78`.

**Test 9 — Billing in arrears.** Same PO as Test 1; invoices dated the last day of the following month.
- Variant A (`unconditional_right_date = invoice_date`, the default): at 1/31/27 no unconditional right exists -> **contract asset $10,191.78**, AR $0.00; entry `Dr Contract Asset 10,191.78 / Cr Revenue 10,191.78`. On 2/28/27 the January invoice's right becomes unconditional -> `Dr AR 10,191.78 / Cr Contract Asset 10,191.78`.
- Variant B (accountant overrides `unconditional_right_date` to 1/31/27): AR $10,191.78 at 1/31/27 and contract asset $0.00. Both variants asserted.

**Test 10 — Contract asset reclassification.** Revenue Jan–Mar per Test 1 with a single invoice on 3/31/27 for $30,000.00 whose right is unconditional the same day. Contract asset: 1/31 $10,191.78 · 2/28 $19,397.26 · 3/31 net position = 29,589.04 − 30,000.00 = **contract liability $410.96**, AR $30,000.00. March entries: `Dr AR 30,000.00 / Cr Contract Asset 19,397.26, Cr Contract Liability 10,602.74`, then `Dr Contract Liability 10,191.78 / Cr Revenue 10,191.78`. (Processing order: right first, then revenue.)

**Test 14 — Irregular billing schedule.** Revenue per Test 1; invoices $50,000.00 on 1/10/27, $25,000.00 on 4/5/27, $45,000.00 on 9/22/27, each unconditional on the invoice date. Sum = $120,000.00 = TP (billing reconciliation check passes). Month-end net position (positive = contract asset, negative = contract liability):
Jan (39,808.22) · Feb (30,602.74) · Mar (20,410.96) · Apr (35,547.95) · May (25,356.17) · Jun (15,493.16) · Jul (5,301.38) · **Aug 4,890.40 contract asset** · Sep (30,246.59) · Oct (20,054.81) · Nov (10,191.80) · Dec 0.00. AR reaches $120,000.00 by 9/22/27. The August flip from liability to asset is the point of the test.

**Test 15 — Full multi-element example.** Promises: SaaS platform access + implementation (grouped, `bundle_not_distinct`) = PO1, SSP $130,000, over time 1/1/27–12/31/27; distinct training = PO2, SSP $20,000, point in time 2/10/27. TP $135,000. Allocation: PO1 $117,000.00 (86.666667%), PO2 $18,000.00 (13.333333%), exact with no residual. PO1 schedule: Jan 9,936.99 · Feb 8,975.34 · Mar 9,936.99 · Apr 9,616.44 · May 9,936.99 · Jun 9,616.44 · Jul 9,936.99 · Aug 9,936.99 · Sep 9,616.44 · Oct 9,936.99 · Nov 9,616.44 · **Dec 9,936.96** (residual −$0.03). PO2 $18,000.00 in Feb-2027. February total revenue $26,975.34; contract total $135,000.00. Invoices $67,500.00 on 1/1/27 and 7/1/27, unconditional on the invoice dates (sum $135,000.00 = TP). Roll-forward and journal entries must reconcile every month; validation status = passed.

Tests 2, 3, 4, 6, 11, 12, 13 are unchanged except that Test 2's daily figures (351 days at $100.00/day: Jan $1,700.00, Feb $2,800.00, Dec $3,100.00, total $35,100.00) are already pure daily ratable and remain correct.

## 8. Validation changes **[REVISED]**

Added/changed checks: billing total must equal transaction price exactly (blocking); each `consideration_event` must have `unconditional_right_date >= invoice_date` unless the accountant supplies a rationale (warning) and both dates valid; each promise must carry all three distinctness fields; each PO must have a non-empty `ssp_basis`. Removed: checks on `unbilled_right_treatment`. The "contract asset and liability not simultaneously non-zero" check is now structural — the net position makes it impossible — and is retained as an engine assertion.

## 9. Remaining accounting issues before Phase 1

None that block Phase 1. Two items are flagged for your awareness, both with a stated V1 default that can be revisited later:

1. **Contract asset relief order across POs.** When an unconditional right arises, V1 relieves the single net contract asset without attributing the relief to a specific PO, because presentation is contract-level. Per-PO attribution would be required only if you later want PO-level balance disclosure.
2. **Invoices issued but not yet unconditional** produce no accounting entry in V1 and appear only in an informational list. If you want them presented differently (for example a memo-only receivable schedule), say so and it becomes a Phase 3 display item.
