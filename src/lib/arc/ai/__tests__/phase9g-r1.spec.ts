/**
 * Phase 9G-R Task R1 — accounting correctness & internal consistency.
 *
 * Deterministic only: synthetic analyses, no provider, no live model.
 */

import { describe, expect, it } from "vitest";

import { validateWorkflow } from "@/lib/asc606-workflow/validation";
import { buildPhase1Input } from "@/lib/asc606-workflow/adapter";
import { scenarioADraft } from "@/lib/asc606-workflow/__tests__/fixtures";
import {
  createEmptyDraft,
  createVcComponentDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { deriveUnambiguousFixedBillingTotal } from "../adapter";
import { deriveCanonicalId } from "../identity";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { AI_OUTPUT_SCHEMA_VERSION, aiContractAnalysisSchema } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_CONTRACT_REFERENCE, R1_RUN_ID, R1_SAAS_PO_KEY } from "./r1-fixtures";

const SAAS_PO_ID = deriveCanonicalId("performance_obligation", R1_SAAS_PO_KEY);
const SLA_VC_ID = deriveCanonicalId("variable_component", "vc:sla-service-credit");

function merge(currentDraft: WorkflowDraft = createEmptyDraft()) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState: createEmptyAiAnalysisState(),
    analysis: genomixR1Analysis(),
    runId: R1_RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

const PERIOD = { start: "2026-11-01", end: "2028-10-31" } as const;

function term(
  overrides: Partial<{
    billingTiming: "advance" | "arrears" | "milestone" | "on_usage" | "unknown";
    frequency:
      "one_time" | "monthly" | "quarterly" | "semiannual" | "annual" | "on_event" | "unknown";
    amountOrRateInput: string | null;
    semanticKey: string;
  }> = {},
) {
  return {
    semanticKey: "billing:fixed",
    billingTiming: "advance" as const,
    frequency: "annual" as const,
    amountOrRateInput: "120000",
    ...overrides,
  };
}

describe("R1 — schema and prompt versions", () => {
  it("pins the AI output schema to v4", () => {
    expect(AI_OUTPUT_SCHEMA_VERSION).toBe("arc.ai.schema.v4");
  });

  it("accepts the Genomix benchmark analysis under the strict v4 schema", () => {
    expect(() => aiContractAnalysisSchema.parse(genomixR1Analysis())).not.toThrow();
  });

  it("rejects a variable-consideration component missing the allocation proposal", () => {
    const analysis = genomixR1Analysis() as unknown as {
      transactionPrice: { variableConsiderationComponents: Array<Record<string, unknown>> };
    };
    delete analysis.transactionPrice.variableConsiderationComponents[0]![
      "allocationTreatmentProposal"
    ];
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(false);
  });

  it("rejects a malformed allocation enum", () => {
    const analysis = genomixR1Analysis();
    (
      analysis.transactionPrice.variableConsiderationComponents[0] as unknown as Record<
        string,
        unknown
      >
    )["allocationTreatmentProposal"] = "specific_contract";
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(false);
  });

  it("rejects a contract reference that is not the accepted fact shape", () => {
    const analysis = genomixR1Analysis();
    (analysis.contractAssessment as unknown as Record<string, unknown>)["contractReference"] =
      R1_CONTRACT_REFERENCE;
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(false);
  });
});

describe("R1 — deterministic fixed billing derivation", () => {
  it("returns the annual total for a one-year term", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [term()],
      servicePeriod: { start: "2027-01-01", end: "2027-12-31" },
    });
    expect(result).toMatchObject({ ok: true, totalInput: "120000.00", eventCount: 1 });
  });

  it("multiplies an annual amount across a two-year term", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [term()],
      servicePeriod: { start: "2027-01-01", end: "2028-12-31" },
    });
    expect(result).toMatchObject({ ok: true, totalInput: "240000.00", eventCount: 2 });
  });

  it("derives four quarterly billings", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [term({ frequency: "quarterly", amountOrRateInput: "30000" })],
      servicePeriod: { start: "2027-01-01", end: "2027-12-31" },
    });
    expect(result).toMatchObject({ ok: true, totalInput: "120000.00", eventCount: 4 });
  });

  it("derives twelve monthly billings", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [term({ frequency: "monthly", amountOrRateInput: "10000" })],
      servicePeriod: { start: "2027-01-01", end: "2027-12-31" },
    });
    expect(result).toMatchObject({ ok: true, totalInput: "120000.00", eventCount: 12 });
  });

  it("ignores a usage term standing beside the fixed term", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [
        term(),
        term({
          semanticKey: "billing:usage",
          billingTiming: "on_usage",
          amountOrRateInput: "1.35",
        }),
      ],
      servicePeriod: { start: "2027-01-01", end: "2027-12-31" },
    });
    expect(result).toMatchObject({ ok: true, totalInput: "120000.00" });
  });

  it("refuses a milestone-only arrangement", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [term({ billingTiming: "milestone", frequency: "on_event" })],
      servicePeriod: { start: "2027-01-01", end: "2027-12-31" },
    });
    expect(result).toEqual({ ok: false, reason: "no_unambiguous_fixed_schedule" });
  });

  it("refuses two independently schedulable fixed terms rather than guessing", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [
        term(),
        term({ semanticKey: "billing:setup", frequency: "one_time", amountOrRateInput: "20000" }),
      ],
      servicePeriod: { start: "2027-01-01", end: "2027-12-31" },
    });
    expect(result).toEqual({ ok: false, reason: "multiple_fixed_schedules" });
  });

  it("refuses without a canonical service period", () => {
    const result = deriveUnambiguousFixedBillingTotal({
      billingTerms: [term()],
      servicePeriod: null,
    });
    expect(result).toEqual({ ok: false, reason: "no_service_period" });
  });
});

describe("R1 — Genomix full-term fixed consideration", () => {
  it("derives 490,000.00 from two annual billings of 245,000", () => {
    const { draft } = merge();
    expect(draft.transactionPriceInput).toBe("490000.00");
  });

  it("keeps the billing events reconciled with the transaction price", () => {
    const { draft } = merge();
    const events = draft.contractBalances.considerationEvents;
    expect(events.map((row) => [row.invoiceDate, row.amountInput])).toEqual([
      ["2026-11-01", "245000"],
      ["2027-11-01", "245000"],
    ]);
  });

  it("never writes a note that contradicts the canonical amount", () => {
    const { draft } = merge();
    expect(draft.transactionPriceNotes).not.toContain("245,000 per year");
    expect(draft.transactionPriceNotes.toLowerCase()).toContain("annual");
  });

  it("preserves an accountant's own transaction price and raises exactly one item", () => {
    const manual: WorkflowDraft = { ...createEmptyDraft(), transactionPriceInput: "400000.00" };
    const { draft, issues } = merge(manual);
    expect(draft.transactionPriceInput).toBe("400000.00");
    const mismatches = issues.filter((item) => item.targetKey === "transactionPrice.input");
    expect(mismatches).toHaveLength(1);
  });
});

describe("R1 — contract reference", () => {
  it("populates the contract number from the analysis when blank", () => {
    const { draft, issues } = merge();
    expect(draft.contract.contractNumber).toBe(R1_CONTRACT_REFERENCE);
    expect(issues.some((item) => item.targetKey === "contract.contractNumber")).toBe(false);
  });

  it("preserves an accountant-entered reference", () => {
    const manual = createEmptyDraft();
    manual.contract = { ...manual.contract, contractNumber: "MY-REF-1" };
    expect(merge(manual).draft.contract.contractNumber).toBe("MY-REF-1");
  });

  it("does not block deterministic accounting when absent", () => {
    const draft = scenarioADraft();
    draft.contract = { ...draft.contract, contractNumber: "" };
    expect(validateWorkflow(draft).issues.some((i) => i.id === "contract.number.present")).toBe(
      false,
    );
    expect(buildPhase1Input(draft).ok).toBe(true);
  });
});

describe("R1 — variable-consideration allocation", () => {
  it("allocates the SLA credit specifically to the canonical SaaS obligation", () => {
    const { draft } = merge();
    const credit = draft.variableConsiderationComponents.find((row) => row.id === SLA_VC_ID);
    expect(credit).toBeDefined();
    expect(credit!.effect).toBe("decrease");
    expect(credit!.allocationTreatment).toBe("specific_po");
    expect(credit!.targetPoId).toBe(SAAS_PO_ID);
    expect(credit!.relatesSpecifically).toBe(true);
    expect(credit!.consistentWithAllocationObjective).toBe(true);
    expect(credit!.allocationRationale).toContain("recurring platform");
  });

  it("never writes a semantic key into the canonical target", () => {
    const { draft } = merge();
    for (const row of draft.variableConsiderationComponents) {
      expect(row.targetPoId === null || row.targetPoId === SAAS_PO_ID).toBe(true);
    }
  });

  it("fails closed when the proposed target cannot be mapped", () => {
    const analysis = genomixR1Analysis();
    analysis.transactionPrice.variableConsiderationComponents[1]!.targetPerformanceObligationKey =
      "po:does-not-exist";
    const { draft, issues } = mergeAiAnalysis({
      currentDraft: createEmptyDraft(),
      currentAiState: createEmptyAiAnalysisState(),
      analysis,
      runId: R1_RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    const credit = draft.variableConsiderationComponents.find((row) => row.id === SLA_VC_ID);
    expect(credit!.targetPoId).toBeNull();
    expect(credit!.allocationTreatment).not.toBe("specific_po");
    expect(
      issues.some(
        (item) =>
          item.reasonCode === "unsafe_semantic_relationship" && item.targetKey.includes(SLA_VC_ID),
      ),
    ).toBe(true);
  });

  it("preserves an accountant's own allocation treatment", () => {
    const manual = createEmptyDraft();
    manual.hasVariableConsideration = true;
    manual.variableConsiderationComponents = [
      {
        ...createVcComponentDraft(1, SLA_VC_ID, "estimated"),
        description: "Availability service credit",
        effect: "decrease",
        allocationTreatment: "general",
        allocationRationale: "Accountant conclusion.",
      },
    ];
    const { draft } = merge(manual);
    const credit = draft.variableConsiderationComponents.find((row) => row.id === SLA_VC_ID);
    expect(credit!.allocationTreatment).toBe("general");
    expect(credit!.allocationRationale).toBe("Accountant conclusion.");
  });

  it("keeps the usage component recognized as usage occurs", () => {
    const { draft } = merge();
    const usage = draft.variableConsiderationComponents.find(
      (row) => row.id === deriveCanonicalId("variable_component", "vc:sample-overage"),
    );
    expect(usage!.treatment).toBe("usage_as_incurred");
    expect(usage!.meters[0]!.rateAmountInput).toBe("1.35");
  });
});

describe("R1 — Genomix acceptance fixture", () => {
  it("produces the whole expected canonical result in one merge", () => {
    const { draft, issues } = merge();
    expect(draft.contract.contractNumber).toBe(R1_CONTRACT_REFERENCE);
    expect(draft.transactionPriceInput).toBe("490000.00");
    expect(draft.hasVariableConsideration).toBe(true);
    expect(draft.variableConsiderationComponents).toHaveLength(2);
    expect(issues.some((item) => /manually entered/i.test(item.reason))).toBe(false);
  });
});
