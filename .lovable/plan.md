# Package 3F.2 — Explicit-invoice review-state robustness (PLAN ONLY)

No implementation, AI run, publish, migration, dependency change or database change. Every finding below comes from read-only queries and a throwaway local test that was deleted afterward.

## A. Stored Meridian billing data

Run `96972afe-48f0-4431-97db-8708f6126faa` (succeeded, 2026-09-29 06:30 UTC, prompt v15 / schema v9). It has one billing term:

- semanticKey `billing-fixed-contract-installments`
- description: "Three expressly dated fixed contract-level invoices totaling the agreement's fixed consideration…"
- **amountKind `fixed_invoice_amount`**
- **reviewState `inference`**
- billingTiming `advance`, frequency `unknown`, invoiceTriggerKind `none`
- paymentTermsDays 30. dueDateRule: "each invoice is due on its expressly stated calendar due date, which is 30 days after the corresponding invoice date"
- targetPerformanceObligationKey `null`
- Term citations (both text, page 2): (1) the three narrative "Blue Harbor will invoice…" sentences; (2) "These three invoices constitute the complete billing schedule…"

explicitInvoices. All are text-mode, page 2, with one citation each:

| # | invoiceDate | amount | coverage | materialized excerpt |
|---|---|---|---|---|
| 0 | 2026-11-15 | 84000 | null | "Blue Harbor will invoice Customer $84,000 on November 15, 2026, and that invoice is due December 15, 2026." |
| 1 | 2027-01-01 | 42000 | null | "…$42,000 on January 1, 2027, …due January 31, 2027." |
| 2 | 2027-07-01 | 42000 | null | "…$42,000 on July 1, 2027, …due July 31, 2027." |

The stored result stores materialized excerpts only, not anchor IDs. Anchors are resolved to text before the result is saved. Terra cited the narrative sentences, not the table.

## B. Exact deterministic rejection path

1. `isExplicitInvoiceCandidate(term)` → **true** (fixed_invoice_amount, 3 invoices)
2. `aiExplicitInvoiceEligibility(term)` → **`{ ok: false, reason: "billing_term_not_source_supported" }`**
3. The rejection comes from the term-level reviewState gate (`AI_FIXED_SCHEDULE_REVIEW_STATES` excludes `inference`).
4. **The rejection happens before any invoice evidence is checked.**

## C. Per-invoice evidence verdicts

`checkExplicitInvoiceEvidence()` returns **ok: true** for invoices 0, 1 and 2, each on its own narrative sentence. As a control, the same term with only `reviewState: "supported"` returns ok, with exactly the three expected events (2026-11-15 $84,000; 2027-01-01 $42,000; 2027-07-01 $42,000). The only thing blocking it is the term-level reviewState gate.

## D. Meridian vs Aster

| | Aster (7b04f1e9, v15) | Aster original (15a40c78, v14 → 3F.1 path) | Meridian (96972afe, v15) |
|---|---|---|---|
| amountKind | unknown | unknown | fixed_invoice_amount |
| reviewState | supported | supported | **inference** |
| invoices | 3 | 3 | 3 |
| citation modes | text ×3 | visual ×3 (table-text path after 3F.1) | text ×3 |
| per-invoice evidence | pass | pass via table text | pass ×3 |
| overall | eligible | eligible | **refused** |

The smallest meaningful difference is one field: Terra labelled Meridian's term `inference` instead of `supported`. The evidence is equally strong in both.

## E. Prompt-v15 ambiguity assessment

Yes, the prompt is ambiguous. Line 188 says a billing term may be `supported` "only when the cited text itself states the invoiced currency amount, **the invoicing cadence** and the billing timing". It names one exception (equal installments), but not explicit dated invoices. Line 190 says a dated-invoice stream "**may** use reviewState supported" when each invoice's own citation states its amount and exact date. That rule is permissive, it isn't listed as an exception to line 188, and it sits after the "only when" rule. Line 197 also steers ordinary readings to `inference`.

Meridian has no recurring cadence: Terra set frequency `unknown` and wrote "no recurring cadence … is stated". So a careful reading of line 188 leads to "not supported" → `inference`. That is exactly what happened. Aster's `on_event` frequency probably let the cadence test feel satisfied.

## F. Options

**A. Prompt-only correction (v16).** Add explicit dated invoices to line 188's exception list, and change line 190 from "may" to "use supported when…, and there is no conflict or missing material billing fact". Frequency `unknown` or `on_event` does not count as a missing cadence for such a stream.
- Risk: it is still probabilistic, and a later run could mislabel again. It changes no deterministic authority. Meridian needs a fresh re-run to benefit.

**B. Deterministic acceptance of `inference` explicit-invoice terms.** Let `inference` through only when every invoice independently passes `checkExplicitInvoiceEvidence`. Other non-supported states stay refused. Taking the three authorities separately:
- *Event creation:* safe. Each event is proven by ARC from its own sentence; the model's label adds no fact.
- *Schedule completeness:* weaker. `inference` may mean the model doubts that the list is complete. Treating it as complete without an ARC-verified completeness statement grants authority the evidence doesn't prove.
- *Step 3 corroboration:* same concern. An unproven complete total could corroborate, or raise a blocking conflict against, Step 3.
- Risk: it creates a half-authority mode. The events would exist, but completeness would stay open, so Balances would work while corroboration stays silent. That adds new semantics to 3F's completeness denominator and review copy.

**C. Smaller alternative: an ARC-verified completeness sentence upgrades an `inference` term.** Accept `inference` only when every invoice passes AND a term citation contains an ARC-verified statement that the listed invoices are the complete billing schedule, with the count matching the number of invoices. This is extra deterministic proof. It is not needed now, but it is the right follow-up if A proves insufficient.

## G. Recommendation

**Option A: prompt-only v16.** It fixes the proven root cause (a contradictory instruction), keeps the reviewState gate and every evidence rule exactly as they are, and matches ARC's principle: AI interprets, ARC proves, accountant judges. Option B/C stays documented as a fallback, and would need owner approval if a v16 re-run of Meridian still returns `inference`.

## H. Files that would change

- `src/lib/arc/ai/prompt.ts`: version → `arc.ai.prompt.v16`; rewrite lines 188/190 as above
- Prompt-version pins: `prompt-version-authority.spec.ts`, `package-3d-q1-explicit-invoices.spec.ts`, `phase9g-r2.spec.ts`, `production-boundary-instructions.spec.ts`, `package-3f1-table-invoices.spec.ts`
- New `src/lib/arc/ai/__tests__/package-3f2-meridian-review-state.spec.ts`

No changes to `billing-evidence.ts`, `merge.ts`, schema, UI or the database.

## I. Failing tests first

1. Prompt policy pins that fail on v15: the explicit-invoice exception appears in the "only when" rule; the "use supported when" wording; frequency unknown/on_event is not a missing cadence; the fail-closed carve-outs (conflict, needs_user_input) are still present.
2. Meridian fixture (the exact stored excerpts, with `supported`): exactly the 3 events, $168,000 in total; due/projected dates 2026-12-15, 2027-01-31, 2027-07-31; no PO; Step 3 stays $168,000 and is corroborated with no conflict; no actual cash; implementation recognition date unchanged; `billing.events.exists` blocker gone.
3. Guard: the same fixture with `inference`, `needs_review`, `needs_user_input` or `source_conflict` is still refused with `billing_term_not_source_supported` and creates no events. This pins that the gate is unchanged.

## J. Regression plan

Original Aster table-only (3 / $148,000 / table path / unresolved acceptance), revised Aster prose, Redwood's six invoices, Horizon $153,000, Genomix unchanged. From 3F: completeness denominator, no partial schedules, no Step 3 replacement, identity/Safe Re-analysis, manual precedence, tombstones, mode-switch firewall. From 3F.1: visual-only refusal, strict table semantics, generic Additional Topics. Then full `bun run verify`, all 26 SQL files plus the contention driver, frozen-file and canonical-hash checks, and a ZIP.

## K. Version decision

Prompt v15 → **v16**. Schema stays v9. No engine or output-schema version change.

## L. Stop conditions

- Stop if any test requires changing `billing-evidence.ts` or `merge.ts` authority.
- Stop if a regression fixture changes outcome.
- Stop if the work would need a migration or dependency.
- After acceptance and publish, a live Meridian v16 re-run is the owner's call. If it still returns `inference`, stop and bring back Option C for approval rather than widening the gate.

Out of scope: significant financing, noncash review noise, Series classification, implementation acceptance/recognition date, general Review & Finalize UX.
