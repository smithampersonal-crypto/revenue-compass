/**
 * Package 3D-Q.2 — Step 3 independence and two derivable billing rules.
 *
 * Deterministic only: synthetic data, no provider, no network, no database.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { deriveInstallmentSchedule, resolveTriggerDate } from "../adapter";
import { aiInstallmentEligibility, aiTriggerEligibility } from "../billing-evidence";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { derivableRuleSignature } from "../safe-reanalysis";
import type { AiContractAnalysis } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];
const PO = "po:saas-platform"; // linked service: 2026-11-01 – 2028-10-31

function cite(excerpt: string) {
  const base = genomixR1Analysis().billingTerms[0]!.citations[0]!;
  return { ...base, evidenceMode: "text" as const, excerpt };
}

const INSTALLMENT_TEXT =
  "Customer will be invoiced the total fee of $490,000 in eight equal quarterly installments, payable in advance beginning on the Effective Date.";

function installmentTerm(overrides: Partial<Term> = {}, text = INSTALLMENT_TEXT): Term {
  return {
    semanticKey: "billing:installments",
    description: "Subscription fee in equal quarterly installments.",
    billingTiming: "advance",
    frequency: "quarterly",
    invoiceTrigger: "Quarterly in advance.",
    amountOrRateInput: null,
    paymentTermsDays: 30,
    dueDateRule: "Net 30.",
    citations: [cite(text)],
    reviewState: "supported",
    amountKind: "fixed_invoice_amount",
    explicitInvoices: [],
    targetPerformanceObligationKey: PO,
    billingBasisTotalInput: "490000",
    installmentCount: 8,
    equalInstallments: true,
    invoiceTriggerKind: "commencement",
    ...overrides,
  } as Term;
}

function triggerTerm(overrides: Partial<Term> = {}, text?: string): Term {
  return {
    semanticKey: "billing:completion",
    description: "Completion invoice.",
    billingTiming: "milestone",
    frequency: "one_time",
    invoiceTrigger: "Upon completion.",
    amountOrRateInput: "15000",
    paymentTermsDays: 30,
    dueDateRule: "Net 30.",
    citations: [
      cite(text ?? "Customer will be invoiced $15,000 upon completion of the platform services."),
    ],
    reviewState: "supported",
    amountKind: "fixed_invoice_amount",
    explicitInvoices: [],
    targetPerformanceObligationKey: PO,
    billingBasisTotalInput: null,
    installmentCount: null,
    equalInstallments: null,
    invoiceTriggerKind: "completion_of_linked_obligation",
    ...overrides,
  } as Term;
}

function analysisWith(terms: Term[], fixed: string) {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = fixed;
  analysis.billingTerms = terms;
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

const events = (analysis: AiContractAnalysis) =>
  run(analysis)
    .draft.contractBalances.considerationEvents.map(
      (row) => `${row.invoiceDate}|${Number(row.amountInput)}`,
    )
    .sort();

/* ================================================ interval-boundary rule */

describe("equal-installment arithmetic (inclusive end dates)", () => {
  it("Jan 1–Dec 31 with four quarterly installments gives Jan 1 / Apr 1 / Jul 1 / Oct 1", () => {
    const result = deriveInstallmentSchedule({
      billingTiming: "advance",
      frequency: "quarterly",
      totalInput: "120000",
      installmentCount: 4,
      serviceStart: "2027-01-01" as never,
      serviceEnd: "2027-12-31" as never,
    });
    expect(result.ok && result.events.map((e) => `${e.invoiceDate}|${e.amountInput}`)).toEqual([
      "2027-01-01|30000.00",
      "2027-04-01|30000.00",
      "2027-07-01|30000.00",
      "2027-10-01|30000.00",
    ]);
  });

  it("fails closed when the count and cadence cannot cover the service period", () => {
    const result = deriveInstallmentSchedule({
      billingTiming: "advance",
      frequency: "quarterly",
      totalInput: "90000",
      installmentCount: 3,
      serviceStart: "2027-01-01" as never,
      serviceEnd: "2027-12-31" as never,
    });
    expect(result).toEqual({ ok: false, reason: "term_not_covered" });
  });

  it("never rounds a cent remainder", () => {
    const result = deriveInstallmentSchedule({
      billingTiming: "advance",
      frequency: "quarterly",
      totalInput: "100000.01",
      installmentCount: 4,
      serviceStart: "2027-01-01" as never,
      serviceEnd: "2027-12-31" as never,
    });
    expect(result).toEqual({ ok: false, reason: "not_exact_cents" });
  });
});

describe("trigger dates come only from the linked obligation", () => {
  const overTime = {
    recognitionMethod: "over_time_ratable",
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionDate: "",
  };
  it("resolves commencement and completion", () => {
    expect(resolveTriggerDate("commencement", overTime)).toEqual({ ok: true, date: "2027-01-01" });
    expect(resolveTriggerDate("completion_of_linked_obligation", overTime)).toEqual({
      ok: true,
      date: "2027-12-31",
    });
    expect(
      resolveTriggerDate("completion_of_linked_obligation", {
        ...overTime,
        recognitionMethod: "point_in_time",
        recognitionDate: "2027-04-15",
      }),
    ).toEqual({ ok: true, date: "2027-04-15" });
  });
  it("fails closed without a date", () => {
    expect(resolveTriggerDate("commencement", { ...overTime, serviceStart: "" }).ok).toBe(false);
    expect(resolveTriggerDate("none", overTime).ok).toBe(false);
  });
});

/* ============================================================ evidence */

describe("installment and trigger evidence", () => {
  it("accepts one cohesive sentence", () => {
    expect(aiInstallmentEligibility(installmentTerm()).ok).toBe(true);
    expect(aiTriggerEligibility(triggerTerm()).ok).toBe(true);
  });

  it("blocks installments when the advance / commencement timing is absent", () => {
    const text =
      "Customer will be invoiced the total fee of $490,000 in eight equal quarterly installments.";
    expect(aiInstallmentEligibility(installmentTerm({ invoiceTriggerKind: "none" }, text))).toEqual(
      {
        ok: false,
        reason: "no_timing_evidence",
      },
    );
  });

  it("blocks a commencement trigger the citation does not state", () => {
    const text =
      "Customer will be invoiced the total fee of $490,000 in eight equal quarterly installments in advance.";
    expect(aiInstallmentEligibility(installmentTerm({}, text)).ok).toBe(false);
  });

  it("never composes facts across sentences", () => {
    const text =
      "The total fee is $490,000. Customer will be invoiced in eight equal quarterly installments in advance beginning on the Effective Date.";
    expect(aiInstallmentEligibility(installmentTerm({}, text)).ok).toBe(false);
  });

  it("blocks a wrong count, a missing 'equal' and a completion trigger phrase that is absent", () => {
    expect(aiInstallmentEligibility(installmentTerm({ installmentCount: 4 })).ok).toBe(false);
    expect(
      aiInstallmentEligibility(installmentTerm({}, INSTALLMENT_TEXT.replace("equal ", ""))).ok,
    ).toBe(false);
    expect(
      aiTriggerEligibility(
        triggerTerm({}, "Customer will be invoiced $15,000 for the platform services."),
      ).ok,
    ).toBe(false);
  });
});

/* =============================================================== merge */

describe("merge — derivable billing rules", () => {
  it("derives eight equal quarterly installments from the linked obligation", () => {
    const analysis = analysisWith([installmentTerm()], "490000");
    const out = events(analysis);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("2026-11-01|61250");
    expect(out[7]).toBe("2028-08-01|61250");
    const { aiState, draft } = run(analysis);
    expect(Object.values(aiState.objectProvenance).map((p) => p.derivation)).toContain(
      "installment_v9",
    );
    for (const cash of draft.contractBalances.cashCollections) {
      expect(cash).not.toHaveProperty("status", "actual");
    }
  });

  it("derives a completion-triggered invoice on the linked obligation's end date", () => {
    expect(events(analysisWith([triggerTerm()], "15000"))).toEqual(["2028-10-31|15000"]);
  });

  it("blocks an unknown or missing obligation reference", () => {
    for (const key of ["po:does-not-exist", null]) {
      const analysis = analysisWith(
        [installmentTerm({ targetPerformanceObligationKey: key })],
        "490000",
      );
      const { draft, issues } = run(analysis);
      expect(draft.contractBalances.considerationEvents).toHaveLength(0);
      expect(issues.some((i) => i.reasonCode === "billing_schedule_not_derivable")).toBe(true);
    }
  });

  it("blocks an ambiguous obligation reference", () => {
    const analysis = analysisWith([installmentTerm()], "490000");
    analysis.performanceObligations.push(structuredClone(analysis.performanceObligations[0]!));
    const { draft } = run(analysis);
    expect(draft.contractBalances.considerationEvents).toHaveLength(0);
  });

  it("never replaces Step 3 with a disagreeing complete billing total", () => {
    const { draft, issues } = run(analysisWith([installmentTerm()], "245000"));
    expect(draft.transactionPriceInput).toBe("245000");
    const conflicts = issues.filter(
      (i) => i.reasonCode === "source_conflict" && i.section === "step_3",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.severity).toBe("red");
  });

  it("raises no conflict when the billing total agrees", () => {
    const { issues } = run(analysisWith([installmentTerm()], "490000"));
    expect(issues.some((i) => i.reasonCode === "source_conflict" && i.section === "step_3")).toBe(
      false,
    );
  });
});

/* ======================================================== re-analysis */

describe("safe re-analysis signature", () => {
  it("changes with structural facts only", () => {
    const base = derivableRuleSignature(installmentTerm());
    expect(base).not.toBeNull();
    expect(derivableRuleSignature(installmentTerm({ description: "Reworded." }))).toBe(base);
    expect(derivableRuleSignature(installmentTerm({ installmentCount: 4 }))).not.toBe(base);
    expect(derivableRuleSignature(installmentTerm({ billingBasisTotalInput: "480000" }))).not.toBe(
      base,
    );
    expect(
      derivableRuleSignature(installmentTerm({ targetPerformanceObligationKey: "po:other" })),
    ).not.toBe(base);
    expect(derivableRuleSignature(triggerTerm({ invoiceTriggerKind: "none" }))).toBeNull();
  });
});
