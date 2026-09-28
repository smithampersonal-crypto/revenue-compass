# Package 3D-Q.1 — Explicit Billing Events (PLAN ONLY)

## 1. Traced failure (runtime code, not tests)
```text
Terra (schema v7 billingTerms) -> schema.ts normalize -> merge.ts billing loop (~L2900)
  -> aiFixedScheduleEligibility (billing-evidence.ts)   <-- all three Redwood streams rejected here
  -> deriveBillingSchedule (adapter.ts)                 <-- training date would also be wrong here
  -> considerationEvents -> Contract Balances
```
The failure happens at the **evidence gate**, in `checkFixedBillingEvidence`. That check needs one sentence that states the matching amount, an invoicing **cadence** and an **advance/arrears timing phrase**. Here is how each Redwood stream fares (read from the uploaded PDF text):

| Stream | Terra's likely v7 term | Gate result | Why |
|---|---|---|---|
| Implementation $24,000 | one_time / advance | `no_timing_evidence` | "in full" satisfies one_time cadence, but "on January 1, 2027" is neither an advance phrase nor an execution phrase |
| Subscription 4 x $30,000 | quarterly / advance | `no_invoice_cadence` | "billed quarterly in advance." has no amount. Each "$30,000 on <date>" sentence has no cadence word. Cohesion correctly refuses to combine them. |
| Training $6,000 | one_time / advance or arrears | `no_timing_evidence` | Same as implementation |

Each refusal raises a blocking `billing_schedule_not_derivable` review item, so zero events are created. Cohesion and the 3D-Q rate exclusions work as designed. The missing capability is a representation for dated invoices.

## 2. Root-cause answers
- **Q1 — Can schema v7 hold an invoice date?** No. The v7 billing term has semanticKey, description, billingTiming, frequency, invoiceTrigger, amountOrRateInput, paymentTermsDays, dueDateRule, citations, reviewState and amountKind. None of these holds a date. A date could appear only as prose in `invoiceTrigger`, and ARC never parses model prose into facts.
- **Q2 — What does prompt v11 ask for?** Recurring rules only. It says "state the billing mechanics … billingTiming, frequency and the exact per-period amount", and "supported only when the cited text states the invoiced amount, the invoicing cadence and the billing timing". Nothing asks for explicit invoice dates or enumerated schedules.
- **Q3 — What does the current output contain?** Given Q1, at most three rule-shaped terms with no dates. No captured Redwood output exists in the repo. As a read-only step at implementation start, I'll check the saved review items from the owner's Redwood run for the recorded refusal `value`. This needs no AI run.
- **Q4 — Where is the positive case rejected?** `billing-evidence.ts` `checkFixedBillingEvidence`: every AI-derived event needs amount + cadence + timing in one sentence (`hasCadence`, then `hasTiming`). One-time invoices without an advance/execution phrase fail on timing.
- **Q5 — How are one-time dates derived?** `adapter.ts` `deriveBillingSchedule` sets a one_time date to the contract service start (advance) or service end (arrears), via `deriveContractServicePeriod`. That gives Jan 1 for implementation by coincidence. Training would get Jan 1 or Dec 31, never Apr 15, so it cannot be supported safely.
- **Q6 — Can ARC hold enumerated schedules?** No. A billing term expands by rule only (period ordinal 1..n from start + frequency). There is no way to represent six independently dated rows.

## 3. Design — add an explicit-invoice path (the recurring gate is not loosened)
**Schema v8 (additive).** Each billing term gets `explicitInvoices`: an array of at most 24 items `{ invoiceDateInput: "YYYY-MM-DD", amountInput: decimal, coveragePeriodText: nullable short text, citations: <existing ARC citation type> }`. Each invoice is verified only against its own citations, never the term's shared citation bag, with an empty array allowed. Payment terms stay on the term (`paymentTermsDays`). Nothing else changes.

**Prompt v12 (smallest change).** Two instructions:
1. When the contract states a dated invoice ("invoice $X on <date>"), list each one in `explicitInvoices` and cite the sentence or table row that states it.
2. Do not create a separate rule term for a stream whose invoices are already listed.

The v11 amountKind, rate and Net 30 rules stay verbatim.

**New gate `checkExplicitInvoiceEvidence` (billing-evidence.ts), all conditions per invoice:**
- The term already passes `amountKind === "fixed_invoice_amount"` and `reviewState === "supported"`. These are reused unchanged.
- One evidence unit in an ARC-materialized **text** citation contains, together:
  - an invoicing word;
  - a currency amount exactly equal to `amountInput`, run through the existing `amountVerdict` (so %, per-unit and interest/late-fee/penalty context are still refused);
  - a full calendar date literal ("April 15, 2027", "2027-04-15", "4/15/2027") that parses exactly to `invoiceDateInput`.
- Nothing is composed across evidence units. A missing, mismatched or ambiguous date fails closed. No date is ever inferred.
- The evidence unit is a sentence. Splitting uses the existing rule, except month abbreviations ("Jan.", "Mar.") no longer split a sentence. This change applies only to the new path; the 3D-Q path keeps its splitter byte-identical.

**Table rows.** Out of scope for 3D-Q.1. Narrative evidence only; the billing summary table is corroborative source text, not an eligibility path.

**Derivation.** When a term has any explicit invoices:
- All of them must pass the gate. If any fails, the whole term is refused with one blocking item; there are no partial schedules.
- Events are created directly: sorted by date then amount, period = ordinal, `invoiceDate = unconditionalRightDate = invoiceDateInput`, amount as stated.
- Cadence, timing and service period are not consulted.
- If `explicitInvoices` is empty, the existing rule path runs exactly as today.

**Deduplication and precedence (within one billing-stream identity only).**
- Scope is the existing billing-term semantic key / identity lineage. No global (date, amount) identity and no fuzzy matching.
- If a term carries explicit invoices, they outrank its rule: the rule-derived schedule is suppressed only when the explicit invoices exactly cover the (date, amount) pairs the rule would derive. A partial overlap blocks as conflicting evidence. When the rule cannot be derived at all, the explicit invoices stand alone.
- Exact duplicate explicit invoices within one term produce a single event.
- Across different billing-term identities, the same date and amount are allowed and never conflict or suppress each other.

**Collections.** Unchanged. The existing accepted projected-collection path records only the contractual due date (invoice date + Net 30) as a projection. No actual cash is ever recorded. Invoice date, unconditional-right date, due date and actual collection stay distinct.

**Transaction price is untouched.** Line ~1995 (`deriveUnambiguousFixedBillingTotal` input) keeps using only the existing 3D-Q gate. Explicit-invoice terms never feed the billing-derived transaction-price total. No change to allocation, recognition, performance obligations, schedules, modifications or journal math (journals change only downstream of the new billing inputs).

## 4. Identity, Safe Re-analysis, legacy
- **Term identity:** `billingTermIdentity` is unchanged, so v7-to-v8 re-analysis reconciles the same lineage. Event keys still use `billingEventSemanticKey(termKey, period)`. Event and collection tombstones, deletion identity and lineage re-keying work unchanged.
- **Mode switch guard:** an incumbent AI schedule may switch between rule-derived and explicit events on re-analysis, changing its period dates. In that case ARC creates nothing and raises a blocking `unsafe_semantic_relationship`-style item. Existing canonical invoices are never silently re-dated or re-keyed. The structural firewall and authorized retractions are not bypassed.
- **Manual events** still win (`manual_structure_preserved`), and every tombstone is respected.
- **Review fingerprints:** the billing `material` gains the explicit invoice list, so a changed list re-opens review. Fingerprints of existing v5/v6/v7 items are unchanged, because the material is added only when the list is non-empty.
- **Legacy:** v5/v6/v7 results normalize to `explicitInvoices: []` and behave byte-identically. Loading, reopening and autosave never run the merge, so old drafts gain no rows. New rows appear only after a deliberate Analyze/Reanalyze.
- **Persistence:** none needed. Events use the existing `considerationEvents` fields, the AI result is stored as JSON, and no migration pins schema/prompt version strings (checked). No DB, RLS or auth change.

## 5. Files
- `src/lib/arc/ai/schema.ts` — v8 schema, `explicitInvoices`, legacy normalization, bounds
- `src/lib/arc/ai/prompt.ts` — v12, two instructions
- `src/lib/arc/ai/billing-evidence.ts` — `checkExplicitInvoiceEvidence`, date parser, abbreviation-safe splitter; the existing check stays byte-identical
- `src/lib/arc/ai/adapter.ts` — `deriveExplicitBillingEvents` (pure)
- `src/lib/arc/ai/merge.ts` — branch in the billing loop, cross-term precedence, mode-switch guard
- `src/lib/arc/ai/safe-reanalysis.ts` — include explicit invoices in the billing facts compare
- `scripts/audit-bundle.sh` — no change expected
- Tests (new): `billing-evidence-explicit.spec.ts`, `merge-explicit-billing.spec.ts`, and a Redwood fixture built from the uploaded PDF's text (synthetic, stored as text only)
- `roadmap.md` — 3D-Q.1 section

## 6. Tests
- **Positive:** P1 implementation $24,000 on 2027-01-01. P2 training $6,000 on 2027-04-15 (date not from the service period). P3 four quarterly $30,000 events. P5 full Redwood merge: exactly six events totalling $150,000, the Contract Balances block cleared, and the revenue schedule deep-equal to the pre-patch result.
- **Negative (all current 3D-Q regressions kept verbatim, plus):**
  - N1 "1.5% per month on overdue balances"
  - N2 "5% of usage"
  - N3 "$12 per unit"
  - N4 "Annual platform price is $120,000"
  - N5 split license/support sentences
  - N6 "invoiced after implementation" with no date
  - date mismatch
  - date in a different sentence from the amount
  - `inference` review state
  - non-fixed amountKind
- **Precedence and identity:**
  - Within one term: rule + four explicit rows gives 4 events, not 8. Partial overlap blocks. An exact duplicate explicit invoice gives 1 event.
  - Across streams: Implementation Jan 1 $10,000 and Training Jan 1 $10,000 give 2 events and no conflict. An explicit invoice on stream A does not suppress a rule invoice on stream B.
  - Per-invoice provenance: a Q1 citation cannot satisfy Q2's invoice.
- **Rule path intact:** monthly/quarterly/annual in advance and upon-signing fixtures unchanged. The Horizon and Genomix deterministic results are unchanged.
- **Identity:** v7 legacy result gives zero new rows. Re-analysis from rule to explicit on an incumbent is blocked. Tombstoned explicit event stays deleted. Collections are only projected due dates.
- Then full `bun run verify` and the frozen-state checks.

## 7. Scope confirmations
No AI run during implementation, and no publish until approved. A live check on Redwood needs one owner-approved guest run after publishing. No change to accounting engines, auth, RLS, database or UI. Frozen `.env`, `^2.15.0` / 2.15.0 and the Genomix hash stay as they are.

## 8. Owner decisions
Approved: schema v8, prompt v12, table-only evidence out of scope, same-stream-only precedence.
