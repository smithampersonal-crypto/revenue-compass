/**
 * Package 3D-Q.2 live acceptance patch — installment amount-kind semantics and
 * Step 3 billing completeness. Deterministic only.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { aiInstallmentEligibility } from "../billing-evidence";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import type { AiContractAnalysis } from "../schema";
import { cedarTest03Analysis } from "./cedar-test03-fixture";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];

function run(analysis: AiContractAnalysis) {
  return mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis,
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

function withSubscription(patch: Partial<Term>): AiContractAnalysis {
  const analysis = cedarTest03Analysis();
  analysis.billingTerms = analysis.billingTerms.map((term) =>
    term.semanticKey === "billing:subscription" ? ({ ...term, ...patch } as Term) : term,
  );
  return analysis;
}

const subscription = (a: AiContractAnalysis) =>
  a.billingTerms.find((t) => t.semanticKey === "billing:subscription")!;
const stepThreeConflicts = (issues: ReturnType<typeof run>["issues"]) =>
  issues.filter((i) => i.reasonCode === "source_conflict" && i.section === "step_3");
const eventTotal = (draft: ReturnType<typeof run>["draft"]) =>
  draft.contractBalances.considerationEvents.reduce((s, r) => s + Number(r.amountInput), 0);

describe("installment amount-kind semantics", () => {
  it("accepts pricing_basis_only with complete installment facts and derives four invoices", () => {
    const analysis = cedarTest03Analysis();
    expect(subscription(analysis).amountKind).toBe("pricing_basis_only");
    expect(aiInstallmentEligibility(subscription(analysis))).toEqual({
      ok: true,
      timing: "advance",
    });
    const { draft } = run(analysis);
    const quarterly = draft.contractBalances.considerationEvents.filter(
      (r) => Number(r.amountInput) === 30000,
    );
    expect(quarterly).toHaveLength(4);
  });

  it("keeps fixed_invoice_amount installment terms accepted for compatibility", () => {
    const term = { ...subscription(cedarTest03Analysis()), amountKind: "fixed_invoice_amount" };
    expect(aiInstallmentEligibility(term as Term).ok).toBe(true);
  });

  it.each(["per_unit_rate", "percentage_rate", "formula", "unknown"] as const)(
    "blocks a %s installment proposal",
    (kind) => {
      const analysis = withSubscription({ amountKind: kind });
      expect(aiInstallmentEligibility(subscription(analysis))).toEqual({
        ok: false,
        reason: "amount_not_fixed_invoice",
      });
      const { draft } = run(analysis);
      expect(
        draft.contractBalances.considerationEvents.filter((r) => Number(r.amountInput) === 30000),
      ).toHaveLength(0);
    },
  );

  it("pricing_basis_only without complete installment facts creates no schedule and does not count", () => {
    const analysis = withSubscription({
      installmentCount: null,
      equalInstallments: null,
      billingBasisTotalInput: null,
    });
    const { draft, issues } = run(analysis);
    expect(
      draft.contractBalances.considerationEvents.filter((r) => Number(r.amountInput) === 30000),
    ).toHaveLength(0);
    // Remaining fixed streams ($24,000 + $6,000) are complete among themselves
    // but the pricing-basis term never joins them; no $30,000 figure replaces Step 3.
    expect(Number(draft.transactionPriceInput)).toBe(150000);
    for (const conflict of stepThreeConflicts(issues)) {
      expect(conflict.material).not.toHaveProperty("billingTotalInput", "150000.00");
    }
  });
});

describe("Step 3 billing corroboration includes the installment stream", () => {
  it("totals $24,000 + $120,000 + $6,000 = $150,000 with no conflict", () => {
    const { draft, issues } = run(cedarTest03Analysis());
    expect(eventTotal(draft)).toBe(150000);
    expect(stepThreeConflicts(issues)).toEqual([]);
    expect(Number(draft.transactionPriceInput)).toBe(150000);
  });

  it("a non-derivable installment stream makes billing incomplete, never a $30,000 total", () => {
    // Structurally complete but the evidence cannot support it (no timing basis).
    const analysis = withSubscription({
      billingTiming: "unknown",
      invoiceTriggerKind: "none",
      citations: subscription(cedarTest03Analysis()).citations.map((c) => ({
        ...c,
        excerpt: "The $120,000 hosted subscription fee will be invoiced in four equal quarterly installments.",
      })),
    });
    const { draft, issues } = run(analysis);
    expect(Number(draft.transactionPriceInput)).toBe(150000);
    expect(stepThreeConflicts(issues)).toEqual([]);
    expect(
      issues.some((i) => JSON.stringify(i.material ?? {}).includes("30000")),
    ).toBe(false);
  });
});
