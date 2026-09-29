/**
 * Package 3F.2 — explicit-invoice review-state robustness (prompt v16).
 *
 * The Meridian fixture reproduces the stored production billing term of run
 * 96972afe (BHS-2026-1184) with its exact materialized excerpts. The fix is
 * prompt-only: the deterministic gate is NOT widened, which the guard
 * variants below pin. Deterministic only: no provider, network or database.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createEmptyDraft,
  isProjectedCollection,
  validateContractBalanceDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { aiExplicitInvoiceEligibility, checkExplicitInvoiceEvidence } from "../billing-evidence";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { AI_PROMPT_VERSION } from "../prompt";
import type { AiContractAnalysis, AiExplicitInvoice } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];

const M1 =
  "Blue Harbor will invoice Customer $84,000 on November 15, 2026, and that invoice is due December 15, 2026.\n";
const M2 =
  "Blue Harbor will invoice Customer $42,000 on January 1, 2027, and that invoice is due January 31, 2027.\n";
const M3 =
  "Blue Harbor will invoice Customer $42,000 on July 1, 2027, and that invoice is due July 31, 2027.\n";
const COMPLETE =
  "These three invoices constitute the complete billing schedule for the fixed consideration under this Agreement. The installment\nschedule applies to the order as a whole and does not assign any installment to a particular service or performance obligation.\nInvoicing does not change the timing or nature of Blue Harbor's service obligations.\n4. Implementation Delivery and Customer Acceptance\n";

function cite(excerpt: string) {
  const base = genomixR1Analysis().billingTerms[0]!.citations[0]!;
  return { ...base, pageStart: 2, pageEnd: 2, evidenceMode: "text" as const, excerpt };
}

function inv(date: string, amount: string, excerpt: string): AiExplicitInvoice {
  return {
    invoiceDateInput: date,
    amountInput: amount,
    coveragePeriodText: null,
    citations: [cite(excerpt)],
  };
}

const meridianInvoices = () => [
  inv("2026-11-15", "84000", M1),
  inv("2027-01-01", "42000", M2),
  inv("2027-07-01", "42000", M3),
];

/** The exact stored Meridian term; only reviewState varies between cases. */
function meridianTerm(reviewState: string): Term {
  return {
    semanticKey: "billing-fixed-contract-installments",
    description:
      "Three expressly dated fixed contract-level invoices totaling the agreement's fixed consideration. The schedule applies to the order as a whole and does not assign an installment to an individual service or performance obligation.",
    billingTiming: "advance",
    frequency: "unknown",
    invoiceTrigger:
      "Invoices are issued on the three stated calendar dates; no recurring cadence or obligation-specific trigger is stated.",
    amountOrRateInput: null,
    paymentTermsDays: 30,
    dueDateRule:
      "Each invoice is due on its expressly stated calendar due date, which is 30 days after the corresponding invoice date.",
    citations: [cite(M1 + M2 + M3), cite(COMPLETE)],
    reviewState,
    amountKind: "fixed_invoice_amount",
    explicitInvoices: meridianInvoices(),
    targetPerformanceObligationKey: null,
    billingBasisTotalInput: null,
    installmentCount: null,
    equalInstallments: null,
    invoiceTriggerKind: "none",
  } as Term;
}

function meridian(reviewState: string): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = "168000";
  analysis.billingTerms = [meridianTerm(reviewState)];
  return analysis;
}

function run(analysis: AiContractAnalysis) {
  return mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis,
    runId: R1_RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

const events = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents
    .map((row) => `${row.invoiceDate}|${Number(row.amountInput)}`)
    .sort();

/* ============================================================ Meridian */

describe("3F.2 Meridian — supported explicit dated invoices", () => {
  it("each stored invoice independently passes ARC's evidence check", () => {
    for (const invoice of meridianInvoices()) {
      expect(checkExplicitInvoiceEvidence(invoice)).toEqual({ ok: true });
    }
  });

  it("creates exactly three contract-level events totalling $168,000, no PO", () => {
    const { draft, issues } = run(meridian("supported"));
    expect(events(draft)).toEqual(["2026-11-15|84000", "2027-01-01|42000", "2027-07-01|42000"]);
    const total = draft.contractBalances.considerationEvents.reduce(
      (sum, row) => sum + Number(row.amountInput),
      0,
    );
    expect(total).toBe(168000);
    for (const row of draft.contractBalances.considerationEvents) {
      expect(row.unconditionalRightDate).toBe(row.invoiceDate);
      expect(
        (row as unknown as Record<string, unknown>)["performanceObligationId"] ?? null,
      ).toBeNull();
    }
    expect(issues.some((i) => i.reasonCode === "billing_schedule_not_derivable")).toBe(false);
    expect(validateContractBalanceDraft(draft).issues.map((i) => i.id)).not.toContain(
      "billing.events.exists",
    );
  });

  it("projects collections only, on the contractual due dates", () => {
    const { draft } = run(meridian("supported"));
    const collections = draft.contractBalances.cashCollections;
    for (const collection of collections) {
      expect(isProjectedCollection(collection)).toBe(true);
    }
    expect(collections.map((c) => `${c.collectionDate}|${Number(c.amountInput)}`).sort()).toEqual([
      "2026-12-15|84000",
      "2027-01-31|42000",
      "2027-07-31|42000",
    ]);
  });

  it("Step 3 stays $168,000; billing corroborates without conflict", () => {
    const { draft, issues } = run(meridian("supported"));
    expect(Number(draft.transactionPriceInput)).toBe(168000);
    expect(issues.some((i) => i.reasonCode === "source_conflict")).toBe(false);
  });

  it("leaves every recognition date unchanged", () => {
    const withBilling = run(meridian("supported")).draft;
    const none = genomixR1Analysis();
    none.transactionPrice.fixedConsiderationInput = "168000";
    none.billingTerms = [];
    const dates = (draft: WorkflowDraft) =>
      draft.performanceObligations.map((po) => [po.id, po.recognitionDate]);
    expect(dates(withBilling)).toEqual(dates(run(none).draft));
  });
});

/* =============================================================== guard */

describe("3F.2 the deterministic gate is not widened", () => {
  it.each(["inference", "needs_review", "needs_user_input", "source_conflict"])(
    "%s is still refused and creates no billing events",
    (reviewState) => {
      expect(aiExplicitInvoiceEligibility(meridianTerm(reviewState) as never)).toEqual({
        ok: false,
        reason: "billing_term_not_source_supported",
      });
      expect(run(meridian(reviewState)).draft.contractBalances.considerationEvents).toHaveLength(0);
    },
  );
});

/* ============================================================== prompt */

describe("3F.2 prompt v16 policy", () => {
  const source = readFileSync("src/lib/arc/ai/prompt.ts", "utf8");

  it("is v16", () => {
    expect(AI_PROMPT_VERSION).toBe("arc.ai.prompt.v17");
  });

  it("makes explicit dated invoices an exception to the cadence requirement", () => {
    expect(source).toContain(
      "there are two exceptions to the cadence requirement: explicit dated-invoice billing",
    );
    expect(source).toContain("which needs no recurring cadence");
    expect(source).toContain(
      "frequency unknown or on_event does not by itself make it an inference",
    );
  });

  it("requires exact amount + exact date per invoice AND schedule completeness", () => {
    expect(source).toContain("states its exact invoiced amount and (3) its exact invoice date");
    expect(source).toContain(
      "the evidence establishes that the listed invoices constitute the complete fixed billing schedule",
    );
  });

  it("does not promote a merely partial list (completeness unknown)", () => {
    expect(source).toContain(
      "never use supported merely because each listed invoice has an amount and a date",
    );
    expect(source).toContain(
      "when the evidence does not establish whether further fixed invoices exist",
    );
    expect(source).toContain("when only part of a schedule is cited");
  });

  it("keeps conflicts and missing facts non-supported", () => {
    expect(source).toContain("conflicting invoice sources remain source_conflict");
    expect(source).toContain("a missing material billing fact remains needs_user_input");
    expect(source).toContain(
      "when commercial terms conflict with each other (for example a unit price, quantity and stated total that do not reconcile) use reviewState source_conflict",
    );
  });

  it("leaves the general billing rule and the table→visual rule in place", () => {
    expect(source).toContain(
      "use reviewState supported for a billing term only when the cited text itself states the invoiced currency amount, the invoicing cadence and the billing timing",
    );
    expect(source).toContain(
      'If the fact depends on table, grid or layout relationships rather than running prose, use evidenceMode "visual"',
    );
    expect(source).toContain("This exception applies to no other table-derived fact.");
  });
});
