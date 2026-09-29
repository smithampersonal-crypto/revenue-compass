# Package 3F.3 — Contractual usage threshold (PLAN ONLY)

No implementation, AI run, publish, migration or dependency change. Findings come from read-only queries, source reading and one throwaway local parse check (deleted).

## A. Stored Stonebridge usage data

Run `d84b4159-0204-4003-b00e-015af36c0500` (succeeded, 2026-09-29 07:15 UTC, schema v9). Usage component as stored:

- semanticKey `vc_usage_overage`, type `usage`
- description: "Usage-based overage charge of USD 0.004 for each API processing event above the 2,000,000-event monthly included quantity."
- contractualRateOrAmountInput **"0.004"**
- unitDescription "per excess API processing event above 2,000,000 events in a calendar month"
- billingFrequency "monthly"; trigger "Actual monthly API processing events exceed 2,000,000; …"
- initialEstimateBasis `not_applicable_usage_as_incurred`, estimates null
- allocation `specific_series_period`, target `po_hosted_saas_series`, relatesSpecifically yes, consistent yes
- reviewState `inference`
- citations (text, p.2): the "includes up to 2,000,000 … $0.004 per excess event …" sentence, and "No minimum overage quantity or minimum overage charge is committed…"

There is no structured included-quantity field in the output. The 2,000,000 appears only inside prose (description, unit, trigger). Schema v9 has nowhere to put it.

## B. Static root cause — points A–F confirmed, plus one more serious link

- A. `VcMeterDraft.includedQuantityInput` exists (workflow types). Confirmed.
- B. Persistence schema keeps `includedQuantityInput`. Confirmed.
- C. The R3 adapter reads it. A blank value becomes "no threshold", not zero. An invalid value blocks with `usage.meter.included_quantity`. Confirmed.
- D. Edit reconciliation and fingerprints include `includedQuantityInput` in `VC_METER_FIELDS`. Confirmed. Gap: the display-field set in `review-presentation.ts` lists only name/rate/rateQuantity/unit, so an AI review row for the threshold would have no readable label.
- E. `variableComponentSchema` has no threshold field. Confirmed.
- F. Merge fills in name, rateAmountInput, rateQuantityInput="1" and unit, and never includedQuantityInput. Confirmed.

**G. An extra link, and the real cause of the "invalid rate" message.** Merge copies `0.004` into `rateAmountInput` with `rateQuantityInput = "1"`. The adapter reads the rate with `parseUsdToCents`, which rejects anything past two decimal places ("Enter no more than two decimal places"). So the rate turns into `UNUSABLE` → `usage.meter.rate` blocker → the engine error "usage meter … has an invalid rate". **A blank threshold on its own does not cause this message.** If we fixed only the threshold, Stonebridge would still fail the same way. The domain already stores meters as exact ratios ("never a fractional-cent unit price"), so the lossless form of $0.004 per event is `rateAmountInput "4.00"` / `rateQuantityInput "1000"`.

## C. Exact missing representation

1. A nullable structured threshold on the usage proposal. It maps 1:1 onto the existing canonical `includedQuantityInput`.
2. Lossless conversion of a sub-cent per-unit contractual rate into the existing ratio fields. This needs no new field.

## D. Recommended smallest architecture

1. **Schema:** add `includedQuantityInput: nonNegativeIntegerInput | null` to `variableComponentSchema`. The name matches the canonical meter field, so there's no second vocabulary. It must be null for every non-`usage` type (a schema refine or a merge fail-closed check).
2. **Prompt v17:** fill it only when the cited text states the included allowance for that exact usage stream, as a literal quantity. Otherwise null: no threshold stated, ambiguous, belongs to another stream, a minimum commitment, a forecast or expected volume, or anything that needs calculating. The same citation must contain the number.
3. **Merge (usage only):** add `includedQuantityInput` to the existing `meterFields` loop, so it gets the same mergeScalar provenance, unclaimed/edited protection, field key `vc:<id>.meter.includedQuantityInput`, citations and reviewState. Fail closed (skip plus review item) if:
   - the value isn't a non-negative whole number; or
   - the digits (with or without thousands separators) don't appear in one of the component's own materialized citation excerpts. ARC checks this; the description prose is never authority.
   No usage period, actual, revenue or invoice is created.
4. **Rate normalization (needs owner approval, see K):** in merge, turn a decimal per-unit rate with more than 2 decimals into an exact ratio. Scale by 10^k until the amount is whole cents: 0.004/1 → 4.00/1000. It's exact decimal arithmetic with no rounding. If it isn't exact, or it goes over bounds, leave it and let the current blocker stand. Rates with 2 decimals or fewer stay exactly as they are today (rateQuantity "1"), so existing fixtures don't change.
5. Add `includedQuantityInput` to the review-presentation meter display fields and label it "Included quantity".

## E. Version decision

- The strict response schema changes, so this is **schema v9 → v10**. v9 is added to the legacy-version list, following the v5–v8 pattern.
- The new instruction means **prompt v16 → v17**.
- Engine, persistence snapshot and database: no change. No migration.

## F. Legacy compatibility

- Stored v9 and older results still parse under their own legacy schemas. The field is absent, and the merge reads it as null.
- Opening or autosaving a legacy analysis re-runs no merge, so no threshold is invented. The stored Stonebridge v9 result stays without a threshold.
- Rate normalization runs only during a merge (Analyze/Reanalyze). Existing canonical meters holding "0.004" are not rewritten on load. They keep the current blocker until the accountant edits them or re-analyzes.

## G. Safe Re-analysis effect

- The threshold uses the existing meter field key and mergeScalar path, so it gets the same rules as every other meter field.
  - Unchanged value: same identity, no duplicate.
  - Changed source value on an untouched field: refreshed with provenance.
  - Accountant-edited value: kept, and a proposed difference raises the existing review item.
  - Tombstoned or deleted meter or component: stays protected, because `meter()` is undefined and nothing is recreated.
- `includedQuantityInput` is already in the fingerprint and edit-reconciliation projections, so it needs no identity change and no fuzzy matching.
- Rate normalization changes the proposed values for a sub-cent rate. On re-analysis of a meter that's still untouched and holds "0.004"/"1", the normal refresh applies. If it was edited, it's preserved with a review item.

## H. Files that would change

- `src/lib/arc/ai/schema.ts`: v10, the field, the usage-only constraint, v9 in the legacy list
- `src/lib/arc/ai/prompt.ts`: v17 and the threshold rules
- `src/lib/arc/ai/merge.ts`: the threshold meter field, the citation check, rate normalization (if approved)
- `src/lib/arc/ai/review-presentation.ts`: the meter display field
- Version pins in the existing prompt/schema spec files, plus analysis fixtures that assert the schema version
- New `src/lib/arc/ai/__tests__/package-3f3-usage-threshold.spec.ts`

No changes to billing-evidence, r3-adapter, the progressive engine, persistence, UI steps or the database.

## I. Failing tests first

Stonebridge positive, built from the exact stored excerpts:
- The meter gets rate 4.00/1000 and unit "excess API processing event" (0.004 → 4.00/1000 is pinned separately), with included quantity 2000000.
- No usage periods, actuals or usage revenue.
- The adapter produces no `usage.meter.rate` blocker and no "invalid rate" error. The component reaches the usage-pending state.
- Fixed billing is exactly 70k/58k/58k, and Step 3 stays $186,000.
- SLA percentages and 1.0% interest stay out of fixed billing, and no cash is invented.

Negatives:
- No threshold in the source → null.
- Ambiguous threshold → skipped with a review item.
- A threshold from another component's citation → not borrowed.
- A minimum commitment → not accepted.
- A forecast volume → not accepted.
- A number found only in the description → refused.
- A non-usage type carrying the field → rejected.
- A non-integer or negative value → rejected.
- A non-exact rate → unchanged and still blocked.

Re-analysis: unchanged value, changed source value, accountant edit kept, tombstoned meter not recreated, a legacy v9 result loads without a threshold.

Versions: pins for v10/v17 and v9 legacy parsing.

## J. Regression plan

Aster (table and prose, $148,000), Meridian ($168,000), Redwood (six invoices), Horizon ($153,000), Genomix unchanged. All 3F–3F.2 suites, plus existing usage/R3 tests to confirm rates with 2 decimals or fewer are unchanged. Then full `bun run verify`, 26 SQL files plus the contention driver, protected-file and PDF-hash checks, and a ZIP.

## K. Risks and stop conditions

- **Decision needed:** point G (rate normalization) is outside the brief's "threshold only" scope, but without it Stonebridge still fails with the same message. Without approval, 3F.3 ships the threshold alone, and the acceptance criterion in section 10 cannot be met.
- Stop if any change reaches the r3-adapter, the progressive engine, allocation, billing evidence or Series logic.
- Stop if a regression fixture changes outcome.
- Stop if a migration or dependency is needed.
- The model can still leave the threshold null. That fails safe: the meter charges from the first unit, and the accountant can enter the threshold.
- Series warning, financing/noncash review noise and Additional Topics: unchanged.

Confirmed: no implementation, no AI run, no publish, no migration, no dependency change.
