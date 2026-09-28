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
Order of authority for the fixed transaction price:
1. **The accountant's amount.** It decides the price, as it does today, and is never overwritten.
2. **The model's validated full-term fixed consideration** (`fixedConsiderationInput`). This is the proposed Step 3 figure.
3. **The billing-derived total.** It only confirms or challenges the Step 3 figure and **never replaces** it. The `derivedTotal ?? proposedFixed` override is removed.

How the billing total is used:
- **Complete** means every billing term the model marked `fixed_invoice_amount` passed its evidence check and was used. ARC counts these before filtering out refused terms.
- **Incomplete or can't be worked out:** billing has no authority over Step 3, and no comparison is made.
- **Complete and agrees with Step 3:** nothing is raised.
- **Complete but disagrees with Step 3:** the Step 3 amount stays. ARC raises a **blocking** Step 3 / billing conflict item on the transaction price (reason code `source_conflict`, which already exists). Neither figure is silently changed, and the accountant must resolve it before finalizing.
- **The model gives no Step 3 figure:** the existing "enter the transaction price" item is raised. If a complete billing total exists, it is shown in that item for reference only and is never applied.
- **The $245,000 a year × 2 years case:** ARC now detects the disagreement and blocks for review instead of using the billing total.

For Test 03, the model's $150,000 stands. Once section 4 is in place, the schedule is complete, totals $150,000 and agrees, so nothing is raised.

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
- **New installment check.** One sentence from that term's own citations must state all of the following:
  - an invoicing word;
  - the exact total billing basis;
  - the installment count, in words or digits;
  - the word "equal";
  - the cadence;
  - the timing or first-invoice trigger that sets the dates. This is an advance or commencement phrase such as "in advance", "upon commencement", "beginning on the Effective Date" or "at the start of each".

  The check applies the same rate, percentage, interest and per-unit exclusions as the existing checks. A `commencement` trigger or `advance` timing from the model is never accepted on the model's word: if the qualifying sentence doesn't state it, the stream is blocked. No second clause is combined with it, not even one from the same billing section.
- **New trigger check.** One sentence must state an invoicing word, the exact amount, and a trigger phrase matching the trigger kind the model returned: "upon completion of" for `completion_of_linked_obligation`; "upon commencement" or "at signing/effective date" for `commencement`. If the phrase doesn't match the kind, the term is blocked. The date is never taken from that sentence. It comes only from the linked obligation's date already in the workpaper.
- **Who owns the obligation link.** `targetPerformanceObligationKey` is only an AI-side reference to a performance obligation's `semanticKey` in the same AI result. It is never an ARC ID. ARC:
  1. checks the reference matches exactly one AI obligation in that result;
  2. resolves it to the canonical workflow obligation using the adapter's existing semantic-key mapping (`poIdBySemanticKey`);
  3. fails closed if the reference is missing, unknown, matches more than one obligation, or maps ambiguously.

  The model never supplies or changes ARC's canonical IDs or relationships.
- **It also fails closed when:**
  - the linked obligation has no date;
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
  - TP3: a complete billing total differs from the Step 3 figure → a blocking conflict item; Step 3 is not replaced.
  - TP4: no billing total, and the price still comes from the contract figure.
  - TP5: usage, rate and variable amounts never become fixed price.
  - A complete billing total agrees with Step 3 → no item.
  - The model gives no Step 3 figure → the missing-input item is raised and the billing total is never applied.
  - The $245,000 × 2 case now gives a blocking conflict instead of a silent $490,000. Existing 3D-Q tests that expected the replacement are updated to match.
  - Horizon, the deterministic sample, is unchanged.
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
