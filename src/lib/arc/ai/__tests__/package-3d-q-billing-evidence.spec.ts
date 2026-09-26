/**
 * Package 3D-Q — AI billing-derivation safety boundary.
 *
 * Deterministic only: synthetic analyses, no provider, no live model, no
 * database. Proves that ARC creates AI-derived invoices only when its own
 * reading of the cited source text supports a fixed invoice amount, cadence
 * and timing; that rates, pricing bases, Net terms and ambiguous installments
 * never become invoices; that the transaction price is not overridden by a
 * refused term; and that untouched legacy (pre-v7) rows are retracted while
 * edited and manual rows are preserved.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  aiFixedScheduleEligibility,
  checkFixedBillingEvidence,
  type FixedBillingEvidenceInput,
} from "../billing-evidence";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import type { AiContractAnalysis } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

const GENOMIX_EXACT =
  "order ref of-2026-syn-7718 (exec v2) effective term nov 1, 2026 – oct 31, 2028 (24 months) billing schedule annual advance ($245,000/yr net 30) account ae claire sterling (c.sterling@synthesisbio.com) sku / platform";

function evidence(
  excerpt: string,
  overrides: Partial<FixedBillingEvidenceInput> = {},
): FixedBillingEvidenceInput {
  return {
    billingTiming: "advance",
    frequency: "annual",
    amountOrRateInput: "245000",
    citations: [{ evidenceMode: "text", excerpt }],
    ...overrides,
  };
}

/* ======================================================= lexical evidence */

describe("checkFixedBillingEvidence", () => {
  it("accepts the exact accepted Genomix wording", () => {
    expect(checkFixedBillingEvidence(evidence(GENOMIX_EXACT))).toEqual({ ok: true });
  });

  it("rejects the ABC overdue-interest term mislabelled as a fixed monthly invoice", () => {
    const abc = evidence(
      "The Customer shall pay $447,000 in installments, net thirty (30) days from invoice. Overdue amounts accrue interest at 1.5% per month.",
      { amountOrRateInput: "1.50", frequency: "monthly" },
    );
    const result = checkFixedBillingEvidence(abc);
    expect(result.ok).toBe(false);
  });

  it("rejects Net 30 alone as billing evidence", () => {
    expect(checkFixedBillingEvidence(evidence("Net 30")).ok).toBe(false);
  });

  it("rejects a /mo pricing basis without an invoicing cadence", () => {
    const result = checkFixedBillingEvidence(
      evidence("Platform access is priced at $10,000/mo.", {
        amountOrRateInput: "10000",
        frequency: "monthly",
      }),
    );
    expect(result).toEqual({ ok: false, reason: "no_invoice_cadence" });
  });

  it("treats generic per-X and /X amounts as rates", () => {
    for (const excerpt of [
      "Overage is invoiced quarterly in arrears at $1.35/sample.",
      "Overage is invoiced quarterly in arrears at $1.35 per sample.",
    ]) {
      expect(
        checkFixedBillingEvidence(
          evidence(excerpt, {
            amountOrRateInput: "1.35",
            frequency: "quarterly",
            billingTiming: "arrears",
          }),
        ),
      ).toEqual({ ok: false, reason: "rate_like_amount" });
    }
  });

  it("rejects percentages and late-fee context", () => {
    expect(
      checkFixedBillingEvidence(
        evidence("Late payments are invoiced monthly in arrears at $50 late fee.", {
          amountOrRateInput: "50",
          frequency: "monthly",
          billingTiming: "arrears",
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects ambiguous installments as a one-time invoice", () => {
    expect(
      checkFixedBillingEvidence(
        evidence("$60,000 is invoiced in installments upon signing.", {
          amountOrRateInput: "60000",
          frequency: "one_time",
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts explicit monthly, one-time and annual invoice wording", () => {
    expect(
      checkFixedBillingEvidence(
        evidence("The $12,500 platform fee is invoiced monthly in advance.", {
          amountOrRateInput: "12500",
          frequency: "monthly",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      checkFixedBillingEvidence(
        evidence("The one-time $50,000 implementation fee is invoiced upon signing.", {
          amountOrRateInput: "50000",
          frequency: "one_time",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      checkFixedBillingEvidence(
        evidence("The $245,000 subscription fee is billed annually in advance."),
      ),
    ).toEqual({ ok: true });
  });

  it("requires the cited amount to equal the proposed amount", () => {
    expect(
      checkFixedBillingEvidence(evidence(GENOMIX_EXACT, { amountOrRateInput: "150000" })),
    ).toEqual({ ok: false, reason: "no_currency_amount" });
  });

  it("requires timing evidence matching the proposal", () => {
    expect(
      checkFixedBillingEvidence(evidence(GENOMIX_EXACT, { billingTiming: "arrears" })),
    ).toEqual({ ok: false, reason: "no_timing_evidence" });
  });

  it("ignores visual citations", () => {
    expect(
      checkFixedBillingEvidence({
        ...evidence(GENOMIX_EXACT),
        citations: [{ evidenceMode: "visual", excerpt: GENOMIX_EXACT }],
      }),
    ).toEqual({ ok: false, reason: "no_text_evidence" });
  });
});

describe("aiFixedScheduleEligibility", () => {
  const base = { ...evidence(GENOMIX_EXACT), reviewState: "supported" };

  it("accepts only supported fixed invoice amounts", () => {
    expect(aiFixedScheduleEligibility({ ...base, amountKind: "fixed_invoice_amount" })).toEqual({
      ok: true,
    });
  });

  it("refuses every non-fixed amount kind, including legacy unknown", () => {
    for (const amountKind of [
      "pricing_basis_only",
      "per_unit_rate",
      "percentage_rate",
      "formula",
      "unknown",
      undefined,
    ]) {
      expect(aiFixedScheduleEligibility({ ...base, amountKind })).toEqual({
        ok: false,
        reason: "amount_not_fixed_invoice",
      });
    }
  });

  it("refuses every review state other than supported", () => {
    for (const reviewState of [
      "inference",
      "needs_review",
      "source_conflict",
      "needs_user_input",
    ]) {
      expect(
        aiFixedScheduleEligibility({ ...base, amountKind: "fixed_invoice_amount", reviewState }),
      ).toEqual({ ok: false, reason: "billing_term_not_source_supported" });
    }
  });
});

/* ================================================================= merge */

function run(analysis: AiContractAnalysis, draft?: WorkflowDraft, state?: AiAnalysisState) {
  return mergeAiAnalysis({
    currentDraft: draft ?? createEmptyDraft(),
    currentAiState: state ?? createEmptyAiAnalysisState(),
    analysis,
    runId: R1_RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

function withAnnualKind(kind: AiContractAnalysis["billingTerms"][number]["amountKind"]) {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = "490000";
  analysis.billingTerms = analysis.billingTerms.map((term) =>
    term.semanticKey === "billing:annual-advance" ? { ...term, amountKind: kind } : term,
  );
  return analysis;
}

describe("merge — AI invoices require the evidence gate", () => {
  it("derives the Genomix annual schedule and its total", () => {
    const { draft } = run(withAnnualKind("fixed_invoice_amount"));
    expect(draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(draft.contractBalances.cashCollections).toHaveLength(2);
    expect(draft.transactionPriceInput).toBe("490000.00");
  });

  it("creates no invoices or collections for a refused term and keeps the model price", () => {
    const { draft, issues } = run(withAnnualKind("pricing_basis_only"));
    expect(draft.contractBalances.considerationEvents).toHaveLength(0);
    expect(draft.contractBalances.cashCollections).toHaveLength(0);
    expect(draft.transactionPriceInput).toBe("490000");
    expect(
      issues.some(
        (issue) =>
          issue.reasonCode === "billing_schedule_not_derivable" &&
          issue.targetKey === "billing:billing:annual-advance",
      ),
    ).toBe(true);
  });

  it("never turns the $1.35 usage rate into an invoice", () => {
    const { draft } = run(withAnnualKind("fixed_invoice_amount"));
    const amounts = draft.contractBalances.considerationEvents.map((row) => row.amountInput);
    expect(amounts).not.toContain("1.35");
  });
});

describe("merge — legacy billing retraction", () => {
  /** Run 1 as if persisted before v7: strip the derivation marker. */
  function legacyFirstRun() {
    const first = run(withAnnualKind("fixed_invoice_amount"));
    const objectProvenance = Object.fromEntries(
      Object.entries(first.aiState.objectProvenance).map(([key, value]) => {
        const { derivation: _derivation, ...rest } = value;
        return [key, rest];
      }),
    );
    return { ...first, aiState: { ...first.aiState, objectProvenance } };
  }

  it("retracts untouched legacy invoices and collections the gate now refuses", () => {
    const first = legacyFirstRun();
    expect(first.draft.contractBalances.considerationEvents).toHaveLength(2);
    const second = run(withAnnualKind("pricing_basis_only"), first.draft, first.aiState);
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(0);
    expect(second.draft.contractBalances.cashCollections).toHaveLength(0);
    expect(second.issues.some((issue) => issue.reasonCode === "ai_derivation_retracted")).toBe(
      true,
    );
  });

  it("keeps an edited legacy invoice and raises a blocking item", () => {
    const first = legacyFirstRun();
    const [edited, ...rest] = first.draft.contractBalances.considerationEvents;
    const draft: WorkflowDraft = {
      ...first.draft,
      contractBalances: {
        ...first.draft.contractBalances,
        considerationEvents: [{ ...edited!, amountInput: "200000" }, ...rest],
      },
    };
    const second = run(withAnnualKind("pricing_basis_only"), draft, first.aiState);
    const ids = second.draft.contractBalances.considerationEvents.map((row) => row.id);
    expect(ids).toContain(edited!.id);
    const retained = second.issues.find(
      (issue) => issue.reasonCode === "legacy_billing_row_retained",
    );
    expect(retained?.severity).toBe("red");
  });

  it("never removes an accountant's manual invoice", () => {
    const first = legacyFirstRun();
    const manual = {
      ...first.draft.contractBalances.considerationEvents[0]!,
      id: "ce-manual-accountant-1",
      amountInput: "5000",
    };
    const draft: WorkflowDraft = {
      ...first.draft,
      contractBalances: {
        ...first.draft.contractBalances,
        considerationEvents: [...first.draft.contractBalances.considerationEvents, manual],
      },
    };
    const second = run(withAnnualKind("pricing_basis_only"), draft, first.aiState);
    expect(second.draft.contractBalances.considerationEvents.map((row) => row.id)).toContain(
      "ce-manual-accountant-1",
    );
  });

  it("does not retract rows created under the v7 gate", () => {
    const first = run(withAnnualKind("fixed_invoice_amount"));
    const second = run(withAnnualKind("fixed_invoice_amount"), first.draft, first.aiState);
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(second.issues.some((issue) => issue.reasonCode === "ai_derivation_retracted")).toBe(
      false,
    );
  });
});
