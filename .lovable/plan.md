# Package 3D-Q — Billing Evidence / Contract Balances Fail-Closed Correction (PLAN ONLY)

## 1. Verified root cause (code trace)

```text
AI v6 billingTerm { billingTiming, frequency, amountOrRateInput: "1.5", paymentTermsDays: 30, reviewState }
  -> schema.ts billingTermSchema: amountOrRateInput = bare decimal, no unit/type
  -> merge.ts billing loop (~L2870-3080): identity/alias, tombstone, manual-structure checks
  -> adapter.ts deriveBillingSchedule(): only checks timing in {advance, arrears},
     usableAmount() (> 0 decimal), service period, frequency divisibility
  -> 12 consideration events of amountInput "1.5"  ($1.50 each)
  -> deriveProjectedCollectionDate(invoiceDate, paymentTermsDays 30) -> projected cash rows
  -> Phase 3 engine faithfully rolls these forward
```

Confirmed from code:
- Step 1/3: `amountOrRateInput` is one untyped decimal. `usableAmount("1.5")` accepts it. Nothing records whether it is currency, %, per-unit or interest.
- Step 3: `deriveBillingSchedule` has no semantic discriminator; any positive decimal with advance/arrears timing becomes a fixed invoice.
- Merge does **not** gate on `term.reviewState`: a term marked `source_conflict`, `needs_user_input` or `needs_review` still creates invoices; reviewState only rides along on raised items.
- Step 5: projected collections are created per derived invoice, so they are already downstream-only — the defect is purely upstream (bad invoices in, bad cash out).
- Step 2 (model mapping 1.5% to a term) is inference: the stored ABC run was not inspected. Optional read-only check of the owner's saved run payload before implementing (no AI run).

Additional finding (same root cause, second consumer): `deriveUnambiguousFixedBillingTotal` (merge.ts ~L1971) uses the same untyped value and **overrides the model's transaction price** when exactly one advance/arrears term has an amount. A lone "1.5 monthly" term would set price to $18.00. The owner saw a reasonable price, which suggests the run had another amount-bearing term (-> `multiple_fixed_schedules`, fallback to $447,000). Either way this path must use the same gate, or a future run can corrupt Step 3.

## 2. Semantic weaknesses
- Amount/rate typing: one field carries invoice amounts, per-unit rates ($1.35/sample), percentages and interest.
- Pricing basis vs cadence: `frequency` is the only cadence field; "$1,200 / mo" can be reported as `monthly` with no separate evidence that invoices are monthly.
- Net 30 vs cadence: prompt never says payment terms are not frequency.
- reviewState ignored for schedule creation.
- Transaction-price override shares the weakness (above).

## 3. Proposed architecture (narrowest)
Add one required field to `billingTermSchema`: `amountKind` enum
`fixed_invoice_amount | pricing_basis_only | per_unit_rate | percentage_rate | formula | unknown`.
(Pricing basis vs cadence is covered by `pricing_basis_only`; no second cadence field needed.)

Deterministic gate `isAiFixedScheduleEligible(term)` in adapter.ts, used by both the merge billing loop and `deriveUnambiguousFixedBillingTotal`. Eligible only if all:
- `amountKind === "fixed_invoice_amount"`;
- timing in {advance, arrears}; frequency supported (existing checks);
- `term.reviewState` not in {`source_conflict`, `needs_user_input`, `needs_review`} (accepted states only: the existing "supported/inference" states);
- `paymentTermsDays` is never read by the gate (Net 30 cannot imply cadence);
- existing service-period and divisibility checks.

Otherwise: no AI events, therefore no projected collections, and one blocking review item (existing `raise`). `deriveBillingSchedule` itself stays unchanged (still used for manual-free derivation math); the gate sits in front of it.

## 4. AI schema / version impact
- Current: `arc.ai.schema.v6`, legacy `v5`. New: `arc.ai.schema.v7` with `amountKind`; v6 becomes the legacy-readable version alongside v5 (existing dispatch in `parseAnyAiContractAnalysis`).
- v5/v6 persisted results stay readable/displayable. Deterministic normalization: legacy terms get `amountKind = "unknown"`.
- Consequence: a reopened legacy run can no longer create **new** AI-derived invoices or override the transaction price from billing; already-materialized draft rows are untouched (they are draft data, not re-derived). Re-analysis with v7 re-derives normally.

## 5. Prompt changes (defense in depth only)
Add explicit rules + short examples: fixed invoice amount ("$10,000 invoiced monthly") vs pricing basis ("$1,200 per month", cadence unstated) vs per-unit rate ("$1.35 per sample") vs percentage/interest ("1.5% per month on overdue balances" -> not a billing term amount; never currency); Net 30 is a due-date term, not frequency; do not divide a total into installments unless the contract states count/amount; ambiguous installments -> `unknown` + `needs_user_input`; conflicting commercial terms -> `source_conflict`. Bump prompt version per existing authority. Not relied on: the gate refuses regardless of model output.

## 6. Merge/adapter changes
- adapter.ts: add `amountKind` to `BillingScheduleInput`/`FixedBillingTermInput`, add eligibility function returning a refusal reason (`amount_not_fixed_invoice`, `billing_term_under_review`).
- merge.ts billing loop: call the gate after tombstone/manual checks, before `deriveBillingSchedule`; refusal raises the existing `billing_schedule_not_derivable` item (blocking) with new reason text. Projected collections unchanged (only reachable from an event).
- merge.ts transaction price: `deriveUnambiguousFixedBillingTotal` filters on the gate, so non-fixed terms neither derive nor count toward `multiple_fixed_schedules`. The model's $447,000 fallback is preserved.
- `usage` mechanics (VC/usage engines) untouched; `on_usage` + `per_unit_rate` continues through existing usage paths.

## 7. Identity / re-analysis impact
- `amountKind` is NOT added to `billingTermIdentityFacts` decisive keys or signatures: identity stays timing + frequency; no lineage re-keying, no tombstone changes, no fuzzy matching.
- `billingMaterial()` gains `amountKind`, so review fingerprints for billing items change once on first v7 run (items reappear as new for review — intended and fail-safe). Verified against r3-review-fingerprints and billing lineage/deletion specs.
- Legacy tombstone upgrade path unchanged.

## 8. Manual entry
Gate applies only to AI-derived schedules. Manual consideration events (any amount, e.g. $1.50 monthly) are unrestricted; existing `manual_structure_preserved` behavior unchanged.

## 9. Files
Production: `src/lib/arc/ai/schema.ts` (v7, field, legacy normalization), `adapter.ts` (gate), `merge.ts` (two call sites, material), `prompt.ts` (instructions, version), fixtures builders referencing billing terms. Tests: new `src/lib/arc/ai/__tests__/billing-evidence-gate.spec.ts` + ABC fixture (synthetic structured output, no PDF); extend `adapter.spec.ts`, `schema.spec.ts`, `legacy-v5-compatibility.spec.ts`, `merge.spec.ts`; update fixtures (genomix-fixtures, r1/r2/merge-fixtures, production-runs) to v7 with correct `amountKind`. No DB/RLS/auth/config changes.

## 10. Regression matrix
ABC overdue 1.5%/month (as `percentage_rate` and as mislabeled `fixed_invoice_amount` + `source_conflict`) -> no events/collections, blocking item; Net 30 only -> no cadence, no collections; $1,200/mo `pricing_basis_only` -> no events; $447,000 ambiguous installments `unknown`/`needs_user_input` -> no events, item raised, price $447,000 kept; license row conflict `source_conflict` -> no schedule; $10,000 monthly arrears x12 -> 12 events + Net-30 projections; $120,000 annual advance -> schedule; $1.35 per sample `per_unit_rate`/`on_usage` -> no fixed invoice, usage mechanics intact; manual events -> preserved; lone non-fixed term no longer overrides transaction price; legacy v5/v6 load, display, no new derivation; lineage/tombstone/Safe Re-analysis suites green; Genomix fixtures green and PDF SHA-256 unchanged.

## 11. Review UX
Existing AI review panel, `billing_schedule_not_derivable` (blocking, "additional_topics"). Reason text: "ARC did not create invoices for “…” because the contract evidence does not establish a fixed invoice amount with a supported billing schedule (the amount appears to be a rate, pricing basis or unresolved term). Enter the actual billing events if known." No new UI.

## 12. Scope
No accounting-engine, DB, RLS, auth, security, config or 3D-P changes; no AI run; no publish; no 3E. Frozen .env / ^2.15.0 / 2.15.0 preserved.

## 13. Open questions
1. Approve schema v7 (vs. a smaller heuristic-only gate on v6 — not recommended: v6 has no reliable signal).
2. Approve that legacy runs lose AI-derived schedule/price creation on re-merge (fail closed).
3. Optional: read-only inspection of the owner's stored ABC run to confirm step 2 before coding.
4. One live ABC validation run after acceptance — separate owner gate, not planned.
