# Package 3F — Contract-level explicit invoices (PLAN ONLY)

No code changed, no AI run, no publish, no migration, no dependency change. Investigation was read-only (source code + the stored production run record).

## A. Root cause

Aster run: `3b81b345-295d-4ad3-9ae0-2b071f6ea193` (workspace `650921af…`, prompt v14, schema v9, succeeded, source `Aster_Peak_Cobalt_Ridge_SaaS_Agreement_Revised.pdf` only).

Runtime path: Terra v9 result → `billingTerms[0]` → `merge.ts` billing loop (line ~3197, explicit-invoice branch) → `aiExplicitInvoiceEligibility` (`billing-evidence.ts` ~445) → refused → `raise(billing_schedule_not_derivable, blocking)` → `continue` → zero consideration events → Contract Balances "Enter at least one billing event."

Exact rejection point: the very first check in `aiExplicitInvoiceEligibility`:

```text
if (amountKind !== "fixed_invoice_amount") -> refuse "amount_not_fixed_invoice"
```

Terra returned `amountKind: "unknown"`. The per-invoice evidence checks never ran. PO linkage, dates, duplicates and the Step 3 comparison played no part.

Second effect: because `amountKind` is `unknown`, the term is also left out of the Step 3 corroboration set (`fixedTypedTerms`, merge.ts ~2101). The billing total was never compared with Step 3.

## B. What Terra actually returned (one billing term)

- semanticKey `fixed_consideration_dated_invoices`; description "Three expressly dated invoices comprising the complete billing schedule…"
- amountKind **unknown**; reviewState **supported**; billingTiming milestone; frequency on_event
- amountOrRateInput null; paymentTermsDays 30; dueDateRule "each invoice due on its stated calendar due date; also Net 30"
- targetPerformanceObligationKey **null**; billingBasisTotalInput / installmentCount / equalInstallments null; invoiceTriggerKind none
- explicitInvoices (all three extracted correctly):
  - 2026-10-01 · 74000 · cites "Aster Peak will invoice Customer $74,000 on October 1, 2026, and the invoice is due October 31, 2026."
  - 2026-11-01 · 37000 · cites "…will invoice Customer $37,000 on November 1, 2026…"
  - 2027-02-01 · 37000 · cites "…will invoice Customer $37,000 on February 1, 2027, and the invoice is due March 3, 2027."
- Term citations: one visual citation (p.2) and one text citation (p.2 closing sentences).
- Stored review item: `billing_schedule_not_derivable` on `billing:fixed_consideration_dated_invoices`. The schedule did not disappear silently. The item's wording, though, says the citation "does not state its invoiced amount and exact invoice date together". That is wrong for this refusal reason and misleads the reviewer.

Dry-reading the three citations against the existing per-invoice evidence rules (amount match, invoicing word, date introduced by "on"): all three would pass.

## C. Architecture assessment

- **D (PO linkage):** only the v9 installment and trigger paths (`deriveV9Events`) require a linked PO. The explicit-invoice branch never reads `targetPerformanceObligationKey`.
- **E (contract-level stream):** yes. A v9 term with `explicitInvoices` and a null PO key is already a genuine contract-level stream. It has stable identity through `billing-identity.ts` (semantic key + date/amount), and the `explicit_invoice_v8` derivation-mode firewall already applies.
- **Balance engine:** `analyzeContractBalances` / `buildMonthlyRollforward` use only event amount, unconditional-right date, invoice date, and collections vs. revenue by month. There is no PO field. Contract asset/liability comes from cumulative revenue vs. cumulative rights, at contract level.
- **Result:** no redesign, no schema change and no migration are needed. None of the stop conditions apply.

## D. Smallest implementation

1. `src/lib/arc/ai/billing-evidence.ts` — `aiExplicitInvoiceEligibility`:
   - Accept `amountKind` of `fixed_invoice_amount` **or** `unknown`, but only when the term has one or more explicit invoices **and** every invoice passes its own evidence check (exact amount, invoicing word and introduced exact date in the same sentence; rate-like amounts refused).
   - `pricing_basis_only`, `usage_rate`, `percentage` and every other kind stay refused. The reviewState rule is unchanged.
   - Rationale: the model's label is a proposal. Here ARC's own sentence-level reading proves each amount is a fixed invoiced amount, and that proof is stronger than the label.
2. `src/lib/arc/ai/merge.ts` — the Step 3 corroboration set (`fixedTypedTerms`) also includes an `unknown`-kind term whose explicit invoices pass that same check. The billing total can then corroborate Step 3, or raise the existing blocking `source_conflict`. It still never replaces Step 3. A refused term still makes the schedule incomplete, so an incomplete schedule has no authority.
3. `merge.ts` refusal copy (explicit branch): reason-specific wording for `amount_not_fixed_invoice` and `billing_term_not_source_supported`. All other reasons keep the current sentence. The review ID and fingerprint inputs stay unchanged (they use section, target, reason code and value).
4. Contract-level label: no UI change. The billing rows already carry no PO. I would add "Contract-level billing" only if you want it (see Decisions).
5. **Schema:** stays at v9 (the shape already fits). **Prompt:** stays at v14 by default. Optional one-line addition as v15: "a dated invoice with a stated currency amount is fixed_invoice_amount, and a contract-level schedule keeps targetPerformanceObligationKey null". The fix does not depend on it.
6. **Identity / Safe Re-analysis:** unchanged mechanisms.
   - An unchanged rerun keeps the same semantic key and the same date/amount event IDs, so no duplicates.
   - A changed date or amount follows the existing lineage rules and fails closed.
   - Switches between explicit invoices and rule/installment/trigger modes already raise blocking `billing_derivation_mode_changed`.
   - Tombstones, manual-row precedence and the structural firewall are untouched.
7. **Nothing else changes:** Step 2, Step 4 and Step 5, the revenue schedule, variable consideration, financing, modifications, journals (beyond downstream effects of valid events), auth, quotas, AI orchestration and storage.

## E. Accounting / data flow

- Each accepted invoice becomes one consideration event with invoice date = unconditional-right date = the stated date. Due dates come from the existing Net 30 rule: 2026-10-31, 2026-12-01 and 2027-03-03, matching the contract.
- The rollforward compares cumulative rights with cumulative recognized revenue, per contract. That produces contract asset or contract liability, plus billed and unbilled AR from invoice vs. month-end.
- Allocation (Step 4: $120k/$20k/$8k by SSP) and billing (50/25/25 installments) stay independent. No invoice is split across or assigned to a PO.
- No actual cash receipts are created. Any collections shown come only from the existing projected-collection logic, with its existing "not evidence of cash" disclosure. I will confirm whether Aster produces projected rows at all and report it.
- Step 3: $148,000 comes from Step 3 fixed consideration. The $148,000 billing total only corroborates it. A mismatch would raise the existing blocking conflict.
- The implementation recognition date stays unresolved (acceptance date unknown). Nothing in this change touches recognition.

## F. Tests (failing first)

- **Unit** (`billing-evidence`): an unknown-kind term with 3 passing invoices is accepted. Refused: unknown kind with one failing invoice (whole term), unknown kind with no invoices, pricing_basis_only, rate/percent/per-unit amounts, missing date, no invoicing word, mismatched date, unsupported reviewState.
- **Merge:** the Aster fixture (synthetic excerpts matching the contract text) produces exactly 3 events ($74k/$37k/$37k, dates above, no PO) with the review item cleared. $148k corroborates Step 3 with no conflict. A $150k Step 3 triggers a blocking `source_conflict` with neither figure replaced. An accountant-entered Step 3 is never overwritten. Existing manual events still win.
- **Identity:** an unchanged rerun gives no duplicates and the same IDs. A changed amount fails closed. Explicit↔rule/installment mode switches stay blocked. Tombstoned invoices are not recreated.
- **Balance integration:** Aster events feed `analyzeContractBalances`, which is unblocked and reconciled, with no actual cash.
- **Regressions:**
  - Redwood/Test 03: 3 POs, $150k, allocation $28,125/$112,500/$9,375, exactly six events, balances unblocked, collections projected only.
  - Horizon: $153k, source document unchanged.
  - Genomix: outputs unchanged, hash unchanged.
  - Aster recognition date remains unresolved.
  - Legacy v5–v8 results load unchanged, with no structure created on load or autosave.
- **Full:** `bun run verify` (baseline 234 files / 2,908 tests; the count will go up). SQL suites are unaffected, but I will run them once as a check.

## G. Risks / stop conditions

- **Risk:** treating `unknown` as acceptable is safe only because every invoice is checked against its own sentence. I will stop if any existing negative test starts passing.
- **Risk:** the first Aster run (the original PDF) may differ. I will read it too and report it, without changing the plan unless it shows a different root cause.
- None of the stop conditions are triggered: no allocation redesign, no PO assignment, no fuzzy matching, billing gets no Step 3 authority, no persistence change.

## H. Scope confirmation

Plan only. No implementation, AI run, publish, migration, dependency change or roadmap edit. Once 3F is accepted, archive `60a4df5a…4d55` becomes historical.

## Decisions for the owner

1. Prompt: keep v14 (recommended), or add the one-line v15 wording as well.
2. Show a small "Contract-level billing" label on these rows: no (recommended, no UI change), or yes.
