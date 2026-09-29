# Package 3F.1 — Table billing + generic Additional Topics review (PLAN ONLY)

This is a plan only. Nothing was implemented, no AI was run, nothing was published, and there is no migration or dependency change. The investigation was read-only: I read the stored run record and ran ARC's own local PDF text extraction and anchoring on the stored original Aster PDF, using a temporary script that has since been removed.

## A. Original Aster live-run billing data

Run `15a40c78-b794-4b03-86f6-4d1390b136ab` (2026-09-29 05:33 UTC, prompt v14, schema v9, succeeded). Source: `Aster_Peak_Cobalt_Ridge_SaaS_Agreement.pdf` (doc `ef99ff6a…`). An earlier original-Aster run, `e6610a76…`, exists and is superseded by this one.

- Billing term: `billing_fixed_dated_invoices`; amountKind **unknown**; reviewState **supported**; targetPerformanceObligationKey null; paymentTermsDays 30.
- Term citations:
  - text on p.1 (header block, "Net 30 from invoice date")
  - visual on p.2 (no excerpt)
- explicitInvoices. Each invoice has exactly **one citation: `evidenceMode: "visual"`, `excerpt: null`, page 2**, with no text excerpt and no anchors.
  - 2026-10-01 · 74000
  - 2026-11-01 · 37000
  - 2027-02-01 · 37000
- Stored review item `rev-c369d040eca7d1f6`, target `billing:billing_fixed_dated_invoices`. Copy: "…at least one invoice's own contract citation does not state its invoiced amount and exact invoice date together…".

## B. Exact rejection path

1. `aiExplicitInvoiceEligibility`: after 3F, unknown + invoices counts as a candidate, and the reviewState check passes.
2. The first invoice (invoiceIndex 0) goes to `checkExplicitInvoiceEvidence`.
3. `explicitEvidenceUnits` skips every non-text citation (billing-evidence.ts ~341). That leaves zero units, so it returns **`no_text_evidence`**.
4. The term is refused with `explicit_invoice_evidence_missing`, and the refusal copy above is raised.

Both halves of the suspected mismatch are confirmed:
- Prompt v14 (prompt.ts lines 90 and 146) tells the model to cite tables as visual.
- The deterministic check only accepts text.

This is the exact cause. Visual citations will stay non-authoritative.

## C. Actual page-2 anchorability (ARC's own extractor + anchors)

```text
P0002-S0008  "excluded and will be invoiced separately where required.\n3. Billing Schedule\nInvoice Date Billing Event Amount Due Date\n"
P0002-S0009  "October 1, 2026 Execution of Agreement $74,000 October 31, 2026\nNovember 1, 2026 Platform go-live $37,000 December 1, 2026\n"
P0002-S0010  "February 1, 2027 Third installment $37,000 March 3, 2027\nInvoices are payable in U.S. "
```

- The header and every row each come out as a single line, in the correct column order.
- Row 1 and row 2 fit in S0008–S0009 (2 anchors). Row 3 fits in S0008–S0010 (3 anchors, contiguous).
- All three rows can therefore be cited under the existing 1–3 contiguous-anchor text contract. The anchor contract and the materializer need no change.

## D. Recommended safe table-evidence design

Add a second pattern, `tableRowEvidence`, in `checkExplicitInvoiceEvidence`. It runs only when the narrative pattern fails, and only on verified **text** citations. The narrative pattern itself is unchanged.

1. Split each text excerpt into **lines**; table rows are recognised line by line.
2. **Header line.** The line must hold the column labels as whole phrases (case-insensitive), in left-to-right order:
   - `Invoice Date` exactly once
   - `Amount` exactly once
   - optionally `Due Date` and other plain labels

   Record the order of the columns that hold a date (Invoice Date, Due Date, …) and the position of Amount among the currency columns. If there is no Invoice Date or no Amount label, the header is invalid.
3. **Row line.** It must come after the header in the same citation, with no second header in between. Parse the dates in left-to-right order (named, ISO and US formats) and the currency amounts in left-to-right order. The row counts only if:
   - its date count equals the header's date-column count, and
   - its currency-amount count equals 1, and the header has exactly one Amount-type column.
4. **Semantics.** The invoice date is the date at the Invoice Date column's position among the date columns. So the Due Date can never be taken as the invoice date, even though both dates appear in the row.
5. **Pass.** The invoice-date column equals `invoiceDateInput` **and** the amount equals `amountInput` exactly (the existing `exactCents`).
6. **Fail closed** on any of:
   - a missing header, or a missing Invoice Date or Amount label
   - date or amount count mismatch (a misaligned or ambiguous row)
   - more than one matching row with different values
   - a rate-like line (the existing `amountVerdict` rate/percent/per-unit rules)
   - interest, penalty, late-fee or formula words on the row or header line
7. The new reason codes stay internal. The refusal copy is unchanged apart from making the "no text evidence" wording honest, e.g. "is supported only by a page image, which ARC cannot verify locally". The review ID and fingerprint inputs are unchanged.

Visual-only invoices keep failing: the term stays refused, the Step 3 completeness denominator still includes it, and the review item remains. This matches 3F.

## E. Prompt-version decision

**A bump to v15 is required.** The deterministic gate can only use text citations, and v14 explicitly tells the model to cite tables visually. Without the change, the model will keep returning visual-only invoice citations.

Narrow v15 carve-out, next to lines 90 and 146:
> Exception: for an explicit dated invoice shown in a billing table, when the header line and that invoice's row are text-anchorable within 1–3 contiguous anchors, cite them with evidenceMode "text" covering the header line and the row. Otherwise use visual; ARC will then leave the invoice unresolved.

All other table guidance stays visual. Schema v9 is unchanged.

A live AI rerun of the original Aster would be needed to confirm the model follows this. That rerun is out of scope and only happens with owner approval.

## F. Generic Additional Topics root cause (confirmed)

The four generic items in this run are all filed under section `additional_topics`:

| Item | Target key |
|---|---|
| customer acceptance | `additionalTopic:customer_acceptance` |
| licenses | `additionalTopic:licenses` |
| warranties | `additionalTopic:warranties` |
| billing refusal | `billing:billing_fixed_dated_invoices` |

How the empty section happens:
- `sectionElementIdFor` (review-presentation.ts ~331) sends any additional_topics target that is not `modification:` or `vc:` to `additional-topics`.
- The badge count is keyed to that ID, and `AdditionalTopics.tsx:53` shows it on the heading ("4 AI REVIEW").
- `AdditionalTopics` renders only the Modifications accordion, plus VC and Material Rights when they apply. It never renders generic items.
- As a result, "Go to section" lands on a heading with no matching content.

## G. UX option A vs B — recommendation: A

- **A (recommended):** a compact read-only "AI review topics" list inside Additional Topics Applied, placed under the heading and above Contract Modifications.
  - Each row shows the topic label, the existing presented reason, and the state (Needs review / Resolved / Affirmed). A "Review in Review & Finalize" link goes to that item.
  - No editable control. Resolution stays solely in Review & Finalize.
  - The badge count then matches what is visible, and "Go to section" lands on real content.
  - Size: one small presentational component (~60 lines) that reuses the existing review DTO and presenter, plus one prop. Risk is low, because the existing accordions and exact-field navigation are untouched.
- **B:** stop counting generic items on this heading and hide "Go to section" for them.
  - Slightly smaller (~20 lines), but it touches the shared navigation and count logic, which carries more regression risk.
  - It also hides advisory conclusions from the analysis page, which is less honest for recruiters.

The billing refusal item stays under additional_topics, so under A it is listed there too. That is correct: Contract Balances already shows its own "Enter at least one billing event" message.

## H. Files that would change

- `src/lib/arc/ai/billing-evidence.ts` — the table-row pattern and its helpers.
- `src/lib/arc/ai/merge.ts` — refusal wording for the visual-only / no-text-evidence case only.
- `src/lib/arc/ai/prompt.ts` — v15 carve-out and `PROMPT_VERSION` bump, plus existing version-pin tests.
- `src/components/arc/AdditionalTopics.tsx` and a new `src/components/arc/AiReviewTopicsList.tsx` — read-only list.
- The page that renders `AdditionalTopics` (analysis route) — passes the generic review items through.
- Tests (below). No schema, SQL, persistence or engine files change.

## I. Failing tests first

New `package-3f1-table-invoices.spec.ts`:
- **Original Aster table fixture** (the exact S0008–S0010 texts above as text citations):
  - 3 events: 2026-10-01 $74,000; 2026-11-01 $37,000; 2027-02-01 $37,000
  - total $148,000, no PO, Step 3 corroborated only
  - balances unblocked, no actual cash, implementation recognition date unresolved
- **Negative cases:**
  - due date proposed as the invoice date (e.g. 2026-10-31)
  - wrong amount
  - no Invoice Date header
  - no Amount header
  - a row with a missing or extra date
  - two amounts in one row
  - row without a header
  - visual-only citation, which keeps the whole term refused and completeness incomplete
  - rate, percentage, interest or late-fee row
- **Revised prose Aster** (the existing 3F fixture) still passes.
- **Prompt:** v15 carve-out text present; general table→visual guidance still present.

UI spec: generic items appear as read-only rows under Additional Topics, and the count equals the visible rows. Modification and VC subtopic navigation are unchanged, exact-field navigation is unchanged, and the rows contain no inputs.

## J. Regression coverage

- All 3F tests:
  - unknown terms must prove every invoice
  - a failed candidate keeps billing incomplete
  - no Step 3 replacement
  - identity / Safe Re-analysis, manual precedence, tombstones, mode-switch firewall
- Other regressions:
  - Redwood/Test 03 (six events, $150k, allocation)
  - Horizon $153k
  - Genomix outputs and hash
  - legacy v5–v8 results load unchanged
  - Review & Finalize resolution and finalization unchanged
- Full `bun run verify`; all 26 SQL test files plus the contention driver run once.

## K. Risks / stop conditions

- Stop if any header/row case would need guessing (for example, wrapped rows split across lines, or merged cells). Those cases stay fail-closed; the parser will not be loosened.
- Stop if any existing negative evidence test starts passing.
- The prompt change is only effective after a real AI run. Until then, production Aster still fails closed, which is safe.
- The Step 5 implementation recognition date stays unresolved. It will not be set to October 30.

## L. Confirmation

No implementation, no AI run, no publish, no migration, no dependency change. Waiting for owner approval.
