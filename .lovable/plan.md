# Package 3D-Q — Billing Evidence / Contract Balances Fail-Closed Correction (PLAN ONLY, rev 2)

Approved in principle: schema v7 with `amountKind`, legacy normalization to `unknown`, gating `deriveUnambiguousFixedBillingTotal`, manual billing authority preserved. This revision covers the four review points. Nothing is implemented. No AI run, no publish, no 3E.

## 0. Read-only inspection of the stored ABC run (done, nothing modified)

Run `bf7ebf0f…` (v6, succeeded, 10 review items), revision `00ce1a45…` (draft):
- The model emitted a billing term with key **`billing.overdue_interest`**. ARC created 12 invoice rows (`billing.overdue_interest#1..#12`, first row $1.5 on 2026-10-31) and 12 projected collections. **No review item was raised for this term.**
- The model's second term, `billing.aggregate_contract_fees` ($447,000 "upon execution… Net 3…"), was correctly refused (`billing_schedule_not_derivable`, unsupported frequency, red), and the model raised `needs_user_input`: "Clarify whether USD 447,000 is invoiced in a single invoice… or in multiple installments".
- The cited excerpt for both is ARC-owned text: "Total aggregate contract fees amounting to $447,000.00 USD shall be invoiced in net thirty (30) day installments upon execution. Overdue accounts shall accrue interest at a rate of 1.5% per month."
- Transaction price stayed $447,000 only by chance: the aggregate term also had advance/arrears timing and an amount, so the fixed-total helper refused with `multiple_fixed_schedules`. If the model had left out that amount, the price would have been replaced with $18.00.
- Derived rows carry `amountSource: "manual"`. That field is a balance-engine label, not authorship. Manual authority must keep being decided from provenance, never from `amountSource`.

This confirms hypothesis steps 1–5 directly.

## 1. Evidence-consistency check (review point 1)

`amountKind` alone is not enough. ARC already has the right evidence at the merge boundary: after Phase 9F, every `text` citation's `excerpt` is **ARC-materialized source text** from anchor ids. The model cannot write it. A `visual` citation has no excerpt.

New pure module `src/lib/arc/ai/billing-evidence.ts`: `checkFixedBillingEvidence(term)`. It is lexical, uses a small fixed vocabulary and is not an NLP system. It reads only `term.citations[].excerpt`, split into sentences. It passes only if all three hold:

A. **Currency amount.** Some sentence contains a currency-denominated amount (`$`, `USD`, `US$`, or "dollars") equal in exact cents to `amountOrRateInput` (commas allowed). The matched amount must not be:
- immediately followed by `%` or "percent";
- a per-unit rate ("per|/" + a unit word such as sample, seat, user, unit, GB, API call, transaction);
- in a sentence that describes interest, late fees, penalties, service credits or overdue amounts ("interest", "overdue", "late", "penalty", "past due", "service credit").
A period suffix ("/mo", "/yr", "per month") on its own marks a **pricing basis**. It passes only if check B finds independent invoice-cadence evidence in the same citation. This keeps Genomix's real excerpt ("billing schedule annual advance ($245,000/yr net 30)") valid and refuses "$1,200 / mo".

B. **Invoice cadence.** A sentence has an invoicing word (invoice/invoiced/bill/billed/billing) together with a cadence expression that matches `frequency`:
- monthly: "monthly", "each/every month"
- quarterly
- annual: "annually", "annual", "yearly", "each year"
- semiannual
- one_time: "single invoice", "in full", "upon execution/signature"
A sentence containing "installment(s)" passes only if it also states that frequency explicitly (for example "monthly installments"). "Net N", "due within N days", and "/mo" pricing never count as cadence.

C. **Timing.** advance: "in advance", "prior to", "at the start/beginning". arrears: "in arrears", "at the end", "following". one_time: the execution or trigger phrase from B.

ABC outcomes:
- 1.5% interest: no `$1.5` amount in the text, and the sentence is about interest, so it refuses.
- $447,000 "net thirty day installments upon execution": the installment sentence has no stated frequency, so it refuses.
- $1,200 / mo with no invoice cadence: refuses.

If any existing legitimate fixture fails this vocabulary, I will stop and report it. The rules are not loosened silently.

Final eligibility for an AI-derived fixed schedule, all required:
1. `amountKind === "fixed_invoice_amount"`
2. review-state allowlist (section 2)
3. `checkFixedBillingEvidence` passes
4. the existing timing, frequency, service-period and divisibility checks in `deriveBillingSchedule`
5. no manual events, tombstones or ambiguous aliases (existing checks)

The same gate also guards `deriveUnambiguousFixedBillingTotal`. A refused term neither derives a total nor counts toward `multiple_fixed_schedules`.

No new citation schema is needed. The persisted representation already supports the check.

## 2. Positive review-state allowlist (review point 2)

`AI_FIXED_SCHEDULE_REVIEW_STATES = ["supported"]`. Eligibility is `ALLOWLIST.includes(state)`, so any unknown or future state fails closed.
- `inference` does **not** qualify. An AI-derived invoice is a source-evidenced fact, not a judgment the model concludes.
- `needs_review`, `source_conflict` and `needs_user_input` do not qualify.
- An "assumed" or routine-assumption item is a review-panel concept, not a term state, so it cannot qualify.

The one existing production fixture (Genomix annual advance) is `supported`. Any fixture that relies on `inference` for a derived schedule is updated only if its evidence supports `supported`; otherwise the expectation changes to refusal and I report it.

## 3. Progressive output preserved (review point 3)

The refusal raises the existing `billing_schedule_not_derivable` item (`blocking: true`, so it is red). What red means in the code:
- It sets `aiReviewCanFinalize = false`, which blocks **Finalize** only.
- It does not feed `analyzeWorkflow`, the five-step validation or the revenue engine.
- It creates no billing rows, so no projected collections exist to derive.

Expected ABC behavior after v7 (unit test on the merged draft plus the existing workpaper selectors):

| Workpaper | Result |
|---|---|
| ASC 606 Analysis | Unchanged: Step 1–5 conclusions, transaction price $447,000 (the model's full-term figure; nothing is billing-derived) |
| Revenue Schedule | Unchanged: produced by the revenue engine, which never reads billing events |
| Contract Balances | No invoice or collection rows. The existing notice "The Billing & Contract Balances workpaper is incomplete…" appears, with the outstanding item in the editor |
| Journal Entries | The existing notice "Journal entries are not available until the Billing & Contract Balances workpaper is complete." |
| Review & Finalize | Red items: the refused schedule plus the model's `needs_user_input` installment item. Finalize is blocked until the accountant enters billing events or resolves the items through the existing manual-red resolution |

Once the accountant enters the real invoices, balances and journals compute through the existing path.

## 4. Legacy → v7 stale rows (review point 4)

Today, a later run that omits an object keeps it (`ai_proposal_omitted`, "never removes canonical structure"). Under v7, the ABC `billing.overdue_interest` rows would therefore **survive**, whether the term is refused or not proposed at all. A narrow, exact retraction rule is needed:

- New optional provenance marker `derivation: "evidence_gated_v7"`, written on each AI-derived invoice and collection claimed by a v7 merge. It lives in the existing `object_provenance` JSON, so no migration is needed. The provenance parser accepts it, and legacy entries lack it.
- During a v7 merge, a **legacy AI-derived billing row** (object key exactly `billing.<term>#<n>` or its `#collection`, provenance present, no v7 marker) is **retracted** only if all hold:
  1. its field provenance is still `ai_generated_untouched`, and its object fingerprint equals ARC's last write (not user-modified);
  2. the v7 merge did not re-claim that exact key or its exact matched alias under an eligible schedule.
  
  Retraction removes the row and its dependent projected collection, and raises one yellow `ai_derivation_retracted` item: "ARC removed invoices an earlier analysis created for “…” because the contract evidence does not support that billing schedule. Enter the actual billing events if known."
- A user-edited legacy row is **kept** and gets a red item for accountant decision. It is never silently removed.
- Retraction is not a tombstone. A later eligible, evidence-supported proposal may create the schedule again. User tombstones are untouched.
- Matching uses only exact keys and exact signatures. There is no fuzzy matching, and `amountKind` stays out of decisive identity.
- Opening a saved draft without re-analysis runs no merge, so the persisted draft is untouched.

Required tests (new `billing-v7-transition.spec.ts`, reusing the merge fixtures):
1. A v6 result materializes 12 untouched `billing.overdue_interest` invoices and 12 collections. A v7 re-analysis of the same lineage refuses the term: all 24 rows are removed, one retraction item and one refusal item exist, and no other rows change.
2. Same as 1, but the v7 run omits the term entirely: the rows are retracted the same way.
3. One legacy invoice was edited by the accountant: that row and its collection are kept with a red item; the untouched rows are retracted.
4. v6 → v7 on Genomix (eligible annual advance): the same canonical ids are re-claimed, the marker is added, nothing is retracted or duplicated, and the tombstone and deletion suites stay green.
5. Reopening the saved v6 draft (load and parse only, no merge) keeps it byte-identical, including all 24 rows.
6. Manual events present: the retraction ignores rows without AI provenance.

## 5. Unchanged from rev 1
- **Schema v7 (`amountKind`):** required field, fixed categories.
- **Legacy results:** v5/v6 stay readable, and missing `amountKind` is read as `unknown`, so a reopened legacy run cannot create new schedules.
- **Prompt:** the prompt changes stay (defense in depth only).
- **Manual billing:** entries are unrestricted.
- **Fingerprints:** review fingerprints change once, on the first v7 run.
- **Projected collections:** reachable only from an invoice. Net 30 alone never produces a collection.
- **Refusal wording:** "ARC did not create invoices for “…” because the contract evidence does not establish a fixed invoice amount with a supported billing schedule (the amount appears to be a rate, pricing basis or unresolved term). Enter the actual billing events if known."

## 6. Files
- **Production:**
  - `src/lib/arc/ai/schema.ts`: v7, `amountKind`, legacy normalization.
  - `billing-evidence.ts`: new.
  - `adapter.ts`: eligibility and allowlist.
  - `merge.ts`: the gate at both call sites, the retraction pass, the provenance marker and `billingMaterial`.
  - the provenance parser: optional `derivation`.
  - `prompt.ts`: instructions and prompt version.
  - `review-state.ts`: the new `ai_derivation_retracted` reason code.
- **Tests:**
  - new `billing-evidence.spec.ts`, `billing-evidence-gate.spec.ts` (ABC fixture built from the stored excerpt text) and `billing-v7-transition.spec.ts`;
  - extended adapter, schema, legacy-v5, merge, lineage, deletion and r3-fingerprint specs;
  - fixtures moved to v7.
- **Not changed:** database, RLS, auth, configuration and 3D-P.

## 7. Regression matrix (additions to rev 1)
- **ABC:** a mislabeled `fixed_invoice_amount` "1.5" with state `supported` is refused by the evidence check.
- **Wrong citation:** a correct amount with a visual-only citation is refused.
- **Genomix:** "$245,000/yr" with billing-schedule cadence is accepted.
- **Pricing basis:** "$1,200 / mo" with no invoice cadence is refused.
- **Installments:** "installments" without a stated frequency is refused; "monthly installments of $10,000" is accepted.
- **Allowlist:** `inference` is refused, and an unknown state injected in a test is refused.
- **Legacy transitions:** tests 1–6 in section 4.
- **Workpapers:** the ABC table in section 3 holds.
- **Genomix hash:** the PDF SHA-256 is unchanged.

## 8. Risks / decisions for the owner
1. **Retraction vs. keep:** approve narrow retraction of **untouched legacy AI-derived billing rows** on v7 re-analysis. This is the only exception to "omitted AI objects are kept", and it applies to billing invoices and their collections only.
2. **`inference` excluded:** approve that `inference` never qualifies. Real contracts whose billing term the model marks `inference` will need manual invoices.
3. **Fixed vocabulary:** the evidence check will refuse some unusual but valid phrasings (fail closed). The accountant enters those invoices manually.
4. **Live run:** a live ABC validation run is still a separate owner gate and is not planned.
