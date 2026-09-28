# Package 3D-Q.2 — Transaction price independent of billing, plus billing rules ARC can work out itself

PLAN ONLY. Nothing edited, published or run.

## 1. Why the transaction price dropped from $150,000 to $24,000

Where it happens: `src/lib/arc/ai/merge.ts`, in the transaction-price block (around line 2005).

```text
eligible = analysis.billingTerms.filter(aiFixedScheduleEligibility(term).ok)   // 3D-Q gate
fixedDerivation = deriveUnambiguousFixedBillingTotal({ billingTerms: eligible, servicePeriod })
derivedTotal = fixedDerivation.ok ? fixedDerivation.totalInput : null
fixed = derivedTotal ?? proposedFixed          // billing total wins over the model's Step 3 figure
mergeText(transaction-price:fixed, fixed)
```

For Test 03:
1. Subscription ($120,000, "four equal quarterly installments"): refused by the recurring check. The $30,000 per-invoice amount never appears in the text, so no single sentence contains amount + cadence + timing.
2. Training ("upon completion"): refused. There is no way to represent the timing, and no sentence has a cadence.
3. Implementation ($24,000, one-time, in advance): passes.
4. The refused terms are filtered out **before** `deriveUnambiguousFixedBillingTotal` counts fixed terms. Its `multiple_fixed_schedules` guard therefore sees only one term, and wrongly concludes that one schedule covers the whole contract.
5. It returns ok with a total of $24,000, one event. `derivedTotal ?? proposedFixed` then replaces the model's own Step 3 figure with $24,000. Allocation, revenue and the reconciliation all follow from that number.

Answers:
- **Q1 – what feeds the price today:** (a) the accountant's own amount, which is never overwritten; (b) the billing-derived total; (c) the model's `transactionPrice.fixedConsiderationInput`, used only when (b) is absent. Per-obligation contract prices feed only the provisional SSP basis, not Step 3. There are no other fallbacks.
- **Q2 – what happened to the $120,000 and $6,000:** they were left out because billing couldn't be worked out, and then the billing-derived total took precedence over the model's figure. They were not missing from the AI output as billing terms. Whether the model's own `fixedConsiderationInput` said $150,000 will be confirmed read-only from the stored Test 03 result before implementation. The code path overrides it either way.
- **Q3 – is the billing total authoritative for Step 3:** yes. It was added in 3D-Q to stop a periodic fee being taken as the contract total (e.g. $245,000 a year on a two-year term = $490,000). That's appropriate only when the billing schedule covers all of the fixed consideration. Nothing checks that today.
- **Q4 – does a billing check affect the price:** yes. `aiFixedScheduleEligibility`, used as a pre-filter, together with `derivedTotal ?? proposedFixed`.
- **Q5 – proposed order of authority:** see section 4.

## 2. Current rule-based billing: why Test 03 fails
- `deriveBillingSchedule` uses one contract-wide service period (`deriveContractServicePeriod`). It has no link from a billing term to an obligation.
- A one-time bill goes on the service start ("advance") or the service end ("arrears"). There is no "on completion of obligation X" trigger.
- A recurring bill needs a per-invoice amount. It can't split a stated total into N equal installments.
- The evidence check needs the per-invoice amount stated in the text, so "$120,000 in four equal installments" can never pass.

## 3. Step 3 correction (keeps billing out of the price)
New order of authority for the fixed transaction price:
1. The accountant's amount. Unchanged; never overwritten.
2. The model's validated full-term fixed consideration (`fixedConsiderationInput`).
3. The billing-derived total, which **confirms or challenges** (2) but may **replace** it only when the schedule is complete: every billing term the model marked `fixed_invoice_amount` passed the evidence check and was used in the derivation. The count happens **before** filtering. Any refused fixed term means incomplete, and the billing total has no say in Step 3.
4. If the schedule is complete and differs from (2): keep today's 3D-Q replacement, so the periodic-fee protection and Horizon stay unchanged. Also raise a visible, non-blocking Step 3 review item saying the figure came from the schedule. If the schedule is incomplete and differs: (2) stands and a Step 3 vs billing conflict review item is raised.

Test 03 result: the schedule is incomplete, so the model's $150,000 stands. After section 4 the schedule is complete and totals $150,000, so the two agree and nothing is raised.

No change to allocation, recognition or reconciliation math, or to how variable consideration is derived.

## 4. New billing rules ARC can work out itself
Two narrow patterns. All arithmetic and dates are done in TypeScript, never by the model.

**A. Equal installments of a stated total** (subscription)
- Facts from the model: `billingBasisTotalInput` = 120000, `installmentCount` = 4, `equalInstallments` = true, frequency quarterly, timing advance, `firstInvoiceTrigger` = `commencement`, linked obligation.
- ARC works out: 120000 ÷ 4 = 30000.00 exactly. A remainder in cents fails closed; ARC never rounds.
- Dates: the linked obligation's service start, plus 0/3/6/9 months (Jan 1, Apr 1, Jul 1, Oct 1). Count × months must fit the linked service period exactly.

**B. A single invoice triggered by an event**
- `invoiceTrigger` = `commencement` → the linked obligation's service start (Implementation: Jan 1).
- `invoiceTrigger` = `completion_of_linked_obligation` → the linked obligation's own completion date: its recognition date if recognised at a point in time, otherwise its service end (Training: Apr 15). This date must already be in the workpaper for that obligation.

The existing recurring and one-time paths and the 3D-Q.1 dated-invoice path stay as they are. A term uses the new path only when the new fields are present.

## 5. Schema / prompt decision
- **Schema v9 is needed.** Billing terms are strict objects, so adding fields to v8 would make stored v8 results fail to load. v9 adds five nullable fields to billing terms: `targetPerformanceObligationKey`, `billingBasisTotalInput`, `installmentCount`, `equalInstallments`, `invoiceTriggerKind` (`commencement` | `completion_of_linked_obligation` | `none`).
- Stored v7 and v8 results still load, with the new fields set to null. They are never rewritten on load or autosave. A deliberate Analyze or Reanalyze is still required, as in 3D-Q.1.
- **Prompt v13.** Prompt v12 doesn't ask for installment count, the equal-installment flag, a trigger or a linked obligation. The change is one short added paragraph. The existing "never divide a total unless the contract states the number…" line stays.

## 6. Evidence and linkage rules
- **Unsafe combining stays blocked:** the recurring check and the 3D-Q.1 check are unchanged. Separate sentences are never merged.
- **New installment check:** one sentence from that term's own citations must state an invoicing word, the exact total, the installment count (in words or digits), the word "equal", and the cadence. It gets the same rate, percentage, interest and per-unit exclusions.
- **New trigger check:** one sentence must state an invoicing word, the exact amount, and a trigger phrase ("upon completion of", "upon commencement", "at signing/effective date"). The date is not taken from that sentence. It comes only from the linked obligation's date already in the workpaper, which is deterministic and linked by exact key.
- **It fails closed when:**
  - the obligation link is missing or unknown;
  - the linked obligation has no date;
  - the link is ambiguous (the key doesn't exactly match one obligation);
  - the trigger is a completion trigger but the linked obligation is ongoing with no end date.
- No fuzzy matching of names or descriptions.

## 7. Identity / re-analysis
- Event IDs use the existing term identity plus the installment number, so they stay stable across runs.
- The trigger identity is the linked obligation's canonical ID plus the trigger kind.
- The derivation mode becomes `installment_v9` or `trigger_v9`. Switching between modes (rule, dated, installment, trigger) goes through the existing mode-change block.
- Safe Re-analysis gets a signature per stream made of (installment count, frequency, trigger kind, linked obligation, resolved dates, exact cents). If anything changes (count, frequency, trigger, the resolved date, or the linked obligation's date changing), the stream is declined as "unmatched" and existing rows stay.
- Deleted-item markers, collections (projected only, from Net 30), and the structural safeguard all work as they do today.

## 8. Files proposed to change
- `src/lib/arc/ai/schema.ts` — v9 fields, legacy v8 schema kept for loading old results.
- `src/lib/arc/ai/prompt.ts` — v13 paragraph.
- `src/lib/arc/ai/billing-evidence.ts` — installment and trigger checks.
- `src/lib/arc/ai/adapter.ts` — `deriveInstallmentSchedule` and `resolveTriggerDate`, both pure. `deriveUnambiguousFixedBillingTotal` gets a completeness input.
- `src/lib/arc/ai/merge.ts` — completeness count before filtering, the new order of authority, the conflict and derived-figure review items, and the new derivation modes.
- `src/lib/arc/ai/safe-reanalysis.ts` — v9 signature and schema gate.
- Loading paths for stored results (`persistence/snapshot.ts` only if it pins schema versions).
- New tests under `src/lib/arc/ai/__tests__/`, plus a Test 03 fixture (synthetic).
- `roadmap.md`.

No changes to the UI, database, security rules, sign-in, allocation or recognition engines.

## 9. Test matrix
- **Transaction price:**
  - TP1: billing can't be worked out, and the price keeps $120,000.
  - TP2: Test 03 gives $150,000.
  - TP3: the billing total differs from the Step 3 figure → a conflict item is raised and nothing is silently replaced.
  - TP4: no billing total, and the price still comes from the contract figure.
  - TP5: usage, rate and variable amounts never become fixed price.
  - Plus: Horizon and the $245,000 × 2 case still give their existing totals.
- **Billing positives:**
  - B1: four quarterly installments of $30,000.
  - B2: implementation billed Jan 1, $24,000.
  - B3: training billed Apr 15, $6,000.
  - B4: full Test 03 gives six events, $150,000, balances unblocked, allocation $28,125 / $112,500 / $9,375, revenue $150,000.
- **Negatives:**
  - N1: equal installments not stated.
  - N2: installment count missing.
  - N3: event date missing.
  - N4: ambiguous or unknown obligation link.
  - N5: the implementation date is not used for training.
  - N6: rate, interest and percentage language is still refused.
  - A total that doesn't divide exactly into cents.
  - The installment count doesn't fit the service period.
  - All existing 3D-Q and 3D-Q.1 negatives.
- **Re-analysis:**
  - Unchanged facts keep the same IDs with no duplicates.
  - Blocked when any of these changes: installment count, frequency, trigger, the resolved date, or the mode.
  - A citation-wording change still applies.
- **Regression:** Test 02 (Redwood) still gives six events and $150,000; the Horizon and Genomix fixtures are unchanged.

## 10. Verification
Focused tests first, then the full `bun run verify`. Then check the frozen state:
- `.env` has exactly the two public VITE values.
- `^2.15.0`, lock at 2.15.0 with the Europe West 4 metadata (restored from the (161) baseline if it drifts).
- Genomix SHA-256 is `7487979e…c4fdd4c7`.

Then deliver the ZIP. No publish and no AI run.

## 11. Live acceptance (after owner approval only)
Publish, then one Test 03 run:
- 3 performance obligations.
- Transaction price, allocated amount and revenue all $150,000.
- Allocation $28,125 / $112,500 / $9,375.
- Six billing events: Jan 1 $24,000; Jan 1, Apr 1, Jul 1, Oct 1 at $30,000 each; Apr 15 $6,000.
- Balances not blocked.
- Collections projected only.

Restore any drift afterwards without republishing.

## 12. Risks / stop conditions
- If the stored Test 03 result shows the model's own figure was not $150,000, the Step 3 fix alone won't reach $150,000 until the billing rules are in place. Report it and don't add any new source for the price.
- **Owner decision:** keep the 3D-Q billing-total replacement when the schedule is complete (as recommended, to protect Horizon and the periodic-fee case), or always treat a difference as a conflict to review.
- Stop if this needs obligation-level contract prices to become a new Step 3 source, fuzzy linking, changes to allocation or recognition, or changes outside billing and consideration.
- 3E and Recent Analyses stay paused.
