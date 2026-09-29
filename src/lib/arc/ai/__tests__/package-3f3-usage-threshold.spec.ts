/**
 * Package 3F.3 — contractual usage threshold + exact sub-cent rate
 * (schema v10 / prompt v17).
 *
 * The Stonebridge fixture reproduces the stored production usage component of
 * run d84b4159 (SCI-2026-2219) with its exact materialized excerpts, lifted to
 * v10 by adding the structured included quantity. Deterministic only: no
 * provider, network or database.
 */
import { describe, expect, it } from "vitest";

import { buildGuidancePack } from "@/lib/arc/guidance/retrieval";

import { buildProgressiveInput } from "@/lib/asc606-workflow/r3-adapter";
import { parseUsdToCents } from "@/lib/asc606-workflow/money-input";
import { createEmptyDraft, isProjectedCollection, type WorkflowDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import { AI_PROMPT_VERSION, buildAiInstructions } from "../prompt";
import {
  AI_OUTPUT_SCHEMA_VERSION,
  LEGACY_V9_AI_OUTPUT_SCHEMA_VERSION,
  parseAiContractAnalysis,
  parsePersistedAiContractAnalysis,
  type AiContractAnalysis,
  type AiExplicitInvoice,
} from "../schema";
import { checkIncludedQuantityEvidence, normalizeUsageRate } from "../usage-evidence";
import { asV10Output } from "./analysis-fixture";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID, R1_SAAS_PO_KEY } from "./r1-fixtures";

type Vc = AiContractAnalysis["transactionPrice"]["variableConsiderationComponents"][number];
type Term = AiContractAnalysis["billingTerms"][number];

/* ------------------------------------------------ exact stored excerpts */

const USAGE_1 =
  "The hosted subscription includes up to 2,000,000 API processing events in each calendar month. For API processing events\nabove that included quantity in a calendar month, Customer will pay $0.004 per excess event. Actual excess events are\nmeasured after the end of each calendar month and any resulting usage charge is invoiced monthly in arrears on the fifteenth\n";
const USAGE_2 =
  "day of the following month, with Net 30 payment terms.\nNo minimum overage quantity or minimum overage charge is committed. At contract inception, the parties do not know whether\nCustomer will exceed the included monthly quantity or, if it does, the number of excess events that will occur.\n5. Service Availability and Credits\n";
const SLA_1 =
  "If monthly availability is below 99.9% but at least 99.0%, Customer may request a service credit equal to 5% of the monthly\nsubscription fee for the affected month. If monthly availability is below 99.0%, Customer may request a service credit equal to\n10% of the monthly subscription fee for the affected month. Total service credits for a month will not exceed 15% of that\nmonth's subscription fee.\n";
const B1 =
  "Stonebridge will invoice Customer $70,000 on December 1, 2026, and that invoice is due December 31, 2026.\n";
const B2 =
  "Stonebridge will invoice Customer $58,000 on April 1, 2027, and that invoice is due May 1, 2027.\n";
const B3 =
  "Stonebridge will invoice Customer $58,000 on August 1, 2027, and that invoice is due August 31, 2027.\n";
const COMPLETE =
  "These three invoices constitute the complete billing schedule for the $186,000 of fixed committed fees. The installments apply\nto the order as a whole and are not designated to any individual service. Variable usage charges, service-level credits, taxes,\nand any permitted interest on overdue amounts are accounted for separately under the sections below.\n4. Usage-Based Processing Charges\n";

function cite(excerpt: string, page = 2) {
  const base = genomixR1Analysis().billingTerms[0]!.citations[0]!;
  return { ...base, pageStart: page, pageEnd: page, evidenceMode: "text" as const, excerpt };
}

function usage(overrides: Partial<Vc> = {}): Vc {
  return {
    semanticKey: "vc_usage_overage",
    description:
      "Usage-based overage charge of USD 0.004 for each API processing event above the 2,000,000-event monthly included quantity.",
    type: "usage",
    contractualRateOrAmountInput: "0.004",
    unitDescription: "per excess API processing event",
    billingFrequency: "monthly",
    trigger:
      "Actual monthly API processing events exceed 2,000,000; excess events are measured after month-end.",
    estimationMethodProposal: "not_estimable",
    constraintAssessment:
      "There is no minimum overage commitment; treat qualifying usage as incurred rather than estimate future usage.",
    initialEstimateBasis: "not_applicable_usage_as_incurred",
    initialEstimatedAmountInput: null,
    initialIncludedAmountInput: null,
    initialEstimateRationale: "Consideration depends on actual excess events.",
    allocationTreatmentProposal: "specific_series_period",
    targetPerformanceObligationKey: R1_SAAS_PO_KEY,
    relatesSpecifically: "yes",
    consistentWithAllocationObjective: "yes",
    allocationRationale: "The per-event charge relates to the monthly hosted service.",
    citations: [cite(USAGE_1), cite(USAGE_2)],
    guidanceIds: [],
    reviewState: "inference",
    includedQuantityInput: "2000000",
    ...overrides,
  } as Vc;
}

function sla(): Vc {
  return {
    ...usage(),
    semanticKey: "vc_sla_service_credit",
    description: "Potential monthly hosted-service credit of 5% or 10% of the monthly fee.",
    type: "service_credit",
    contractualRateOrAmountInput: null,
    unitDescription: "percentage of the affected month's subscription fee",
    estimationMethodProposal: "most_likely_amount",
    initialEstimateBasis: "zero_no_expected_trigger",
    initialEstimatedAmountInput: "0",
    initialIncludedAmountInput: "0",
    citations: [cite(SLA_1)],
    includedQuantityInput: null,
  } as Vc;
}

function inv(date: string, amount: string, excerpt: string): AiExplicitInvoice {
  return {
    invoiceDateInput: date,
    amountInput: amount,
    coveragePeriodText: null,
    citations: [cite(excerpt)],
  };
}

function fixedTerm(): Term {
  return {
    semanticKey: "billing-fixed-installments",
    description: "Three expressly dated fixed contract-level invoices totaling $186,000.",
    billingTiming: "advance",
    frequency: "unknown",
    invoiceTrigger: "Invoices are issued on the three stated calendar dates.",
    amountOrRateInput: null,
    paymentTermsDays: 30,
    dueDateRule: "Each invoice is due 30 days after its invoice date.",
    citations: [cite(B1 + B2 + B3), cite(COMPLETE)],
    reviewState: "supported",
    amountKind: "fixed_invoice_amount",
    explicitInvoices: [
      inv("2026-12-01", "70000", B1),
      inv("2027-04-01", "58000", B2),
      inv("2027-08-01", "58000", B3),
    ],
    targetPerformanceObligationKey: null,
    billingBasisTotalInput: null,
    installmentCount: null,
    equalInstallments: null,
    invoiceTriggerKind: "none",
  } as Term;
}

function stonebridge(component: Vc = usage()): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = "186000";
  analysis.transactionPrice.variableConsiderationComponents = [component, sla()];
  analysis.billingTerms = [fixedTerm()];
  return analysis;
}

function run(
  analysis: AiContractAnalysis,
  currentDraft: WorkflowDraft = createEmptyDraft(),
  currentAiState: AiAnalysisState = createEmptyAiAnalysisState(),
  runId = R1_RUN_ID,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

/** v10 components always carry the field (null when unresolved). */
const evidence = (component: Vc) =>
  checkIncludedQuantityEvidence({
    includedQuantityInput: component.includedQuantityInput ?? null,
    contractualRateOrAmountInput: component.contractualRateOrAmountInput,
    citations: component.citations,
  });

const VC_ID_PATTERN = /overage/;
const usageRow = (draft: WorkflowDraft) =>
  draft.variableConsiderationComponents.find((row) => VC_ID_PATTERN.test(row.id))!;
const events = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents
    .map((row) => `${row.invoiceDate}|${Number(row.amountInput)}`)
    .sort();

/* ============================================================ versions */

describe("3F.3 versions", () => {
  it("pins schema v10 / prompt v17 and keeps v9 readable without a threshold", () => {
    expect(AI_OUTPUT_SCHEMA_VERSION).toBe("arc.ai.schema.v10");
    expect(AI_PROMPT_VERSION).toBe("arc.ai.prompt.v17");
    expect(parseAiContractAnalysis(stonebridge()).ok).toBe(true);

    const legacy = structuredClone(stonebridge()) as unknown as Record<string, unknown>;
    legacy["schemaVersion"] = LEGACY_V9_AI_OUTPUT_SCHEMA_VERSION;
    const tp = legacy["transactionPrice"] as {
      variableConsiderationComponents: Record<string, unknown>[];
    };
    for (const c of tp.variableConsiderationComponents) delete c["includedQuantityInput"];
    expect(parseAiContractAnalysis(legacy).ok).toBe(false);
    const parsed = parsePersistedAiContractAnalysis(legacy, LEGACY_V9_AI_OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const vc = parsed.analysis.transactionPrice.variableConsiderationComponents[0]!;
    expect(vc).not.toHaveProperty("includedQuantityInput");
  });

  it("the v10 field is required, a whole-number string, and usage-only", () => {
    const missing = structuredClone(stonebridge()) as unknown as {
      transactionPrice: { variableConsiderationComponents: Record<string, unknown>[] };
    };
    delete missing.transactionPrice.variableConsiderationComponents[0]!["includedQuantityInput"];
    expect(parseAiContractAnalysis(missing).ok).toBe(false);
    for (const bad of ["2,000,000", "2000000.5", "-1", "2e6", " 1"]) {
      expect(parseAiContractAnalysis(stonebridge(usage({ includedQuantityInput: bad }))).ok).toBe(
        false,
      );
    }
    const credit = stonebridge();
    credit.transactionPrice.variableConsiderationComponents[1]!.includedQuantityInput = "10";
    expect(parseAiContractAnalysis(credit).ok).toBe(false);
  });

  it("prompt v17 carries the threshold rules and keeps the v16 invoice rules", () => {
    const text = buildAiInstructions({
      guidance: buildGuidancePack({ normalizedEvidenceText: "saas usage overage" }),
      sources: [],
      arcContextFacts: {},
    });
    expect(text).toContain("includedQuantityInput");
    expect(text).toContain(
      'Use "0" only when the cited text establishes that every unit is charged from the first unit',
    );
    expect(text).toContain(
      "Never put a minimum commitment, minimum purchase, forecast, expected, target or historical volume",
    );
    expect(text).toContain("never calculate or infer it, and never invent actual usage");
    expect(text).toContain("never round it");
  });
});

/* ====================================================== normalization */

describe("3F.3 exact sub-cent rate normalization", () => {
  it.each([
    ["1.35", "1.35", "1"],
    ["12.00", "12.00", "1"],
    ["12", "12", "1"],
    ["0.03", "0.03", "1"],
    ["0.004", "0.04", "10"],
    ["0.0005", "0.05", "100"],
    ["0.0040", "0.04", "10"],
    ["1.3500", "1.35", "1"],
    ["0.000001", "0.01", "10000"],
    ["2.125", "21.25", "10"],
  ])("%s -> %s / %s", (raw, amount, quantity) => {
    expect(normalizeUsageRate(raw)).toEqual({
      ok: true,
      rateAmountInput: amount,
      rateQuantityInput: quantity,
    });
    // The numerator is always a valid accountant-facing whole-cent amount.
    expect(parseUsdToCents(amount).ok).toBe(true);
  });

  it("is exact: numerator / denominator reproduces the contractual rate with no rounding", () => {
    for (const raw of ["0.004", "0.0005", "2.125", "0.000001", "123456.789012"]) {
      const result = normalizeUsageRate(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const [w, f = ""] = result.rateAmountInput.split(".");
      const centsValue = BigInt(w! + f.padEnd(2, "0"));
      const denominator = BigInt(result.rateQuantityInput);
      // rate x 10^6 == cents x 10^4 / denominator exactly
      const [rw, rf = ""] = raw.split(".");
      const rateMicros = BigInt(rw! + rf.padEnd(6, "0"));
      expect(centsValue * 10000n).toBe(rateMicros * denominator);
    }
  });

  it("fails closed on invalid, non-positive or unrepresentable rates", () => {
    expect(normalizeUsageRate(null).ok).toBe(false);
    expect(normalizeUsageRate("0").ok).toBe(false);
    expect(normalizeUsageRate("0.000").ok).toBe(false);
    expect(normalizeUsageRate("-0.004").ok).toBe(false);
    expect(normalizeUsageRate("0.0000001").ok).toBe(false);
    expect(normalizeUsageRate("5%").ok).toBe(false);
    expect(normalizeUsageRate("1e-3").ok).toBe(false);
    expect(normalizeUsageRate("999999999999999.999999")).toEqual({
      ok: false,
      reason: "rate_out_of_bounds",
    });
  });
});

/* ======================================================= Stonebridge */

describe("3F.3 Stonebridge — threshold and exact rate reach the canonical meter", () => {
  it("ARC verifies the 2,000,000 included quantity from the component's own text", () => {
    expect(evidence(usage())).toEqual({
      ok: true,
      includedQuantityInput: "2000000",
    });
  });

  it("creates the exact meter with no usage period, actuals, revenue or usage invoice", () => {
    const { draft } = run(stonebridge());
    const row = usageRow(draft);
    expect(row.treatment).toBe("usage_as_incurred");
    expect(row.meters).toHaveLength(1);
    const meter = row.meters[0]!;
    expect(meter.rateAmountInput).toBe("0.04");
    expect(meter.rateQuantityInput).toBe("10");
    expect(meter.unit).toBe("excess API processing event");
    expect(meter.includedQuantityInput).toBe("2000000");
    expect(row.usagePeriods).toHaveLength(0);
    expect(row.realizedEvents ?? []).toHaveLength(0);
    // Fixed billing is exactly the three contract invoices: no usage, SLA or interest invoice.
    expect(events(draft)).toEqual(["2026-12-01|70000", "2027-04-01|58000", "2027-08-01|58000"]);
    expect(Number(draft.transactionPriceInput)).toBe(186000);
    // Only projected collections; no actual cash receipt is fabricated.
    expect(draft.contractBalances.cashCollections.every((row) => isProjectedCollection(row))).toBe(
      true,
    );
  });

  it("the progressive adapter raises no rate or threshold blocker for this meter", () => {
    const { draft } = run(stonebridge());
    const meterId = usageRow(draft).meters[0]!.id;
    const result = buildProgressiveInput(draft);
    const meterCodes = result.blocked.filter((fact) => fact.ownerId === meterId).map((f) => f.code);
    expect(meterCodes).not.toContain("usage.meter.rate");
    expect(meterCodes).not.toContain("usage.meter.included_quantity");
  });

  it("the legacy v9 shape of the same run still produces the old unusable 0.004 / 1 meter", () => {
    const legacy = stonebridge(usage({ includedQuantityInput: undefined }));
    delete (legacy.transactionPrice.variableConsiderationComponents[0] as Record<string, unknown>)[
      "includedQuantityInput"
    ];
    const { draft } = run(legacy);
    const meter = usageRow(draft).meters[0]!;
    expect(meter.rateAmountInput).toBe("0.004");
    expect(meter.rateQuantityInput).toBe("1");
    expect(meter.includedQuantityInput ?? "").toBe("");
  });

  it("the service credit stays outside usage and fixed billing", () => {
    const { draft } = run(stonebridge());
    const credit = draft.variableConsiderationComponents.find((row) => /sla/.test(row.id))!;
    expect(credit.treatment).toBe("estimated");
    expect(credit.meters).toHaveLength(0);
  });
});

/* ========================================================= negatives */

describe("3F.3 threshold negatives — all fail closed", () => {
  const refused = (component: Vc) => {
    const { draft, issues } = run(stonebridge(component));
    const row = usageRow(draft);
    expect(row.meters).toHaveLength(0);
    const item = issues.find((i) => i.targetKey === `vc:${row.id}.meter.includedQuantityInput`);
    expect(item).toBeDefined();
    expect(item!.state).toBe("red");
    return item!;
  };

  it("null threshold never becomes zero and creates no priced meter", () => {
    refused(usage({ includedQuantityInput: null }));
  });

  it("no threshold stated in the source", () => {
    const noThreshold = "Customer will pay $0.004 per API processing event.";
    expect(evidence(usage({ citations: [cite(noThreshold)] })).ok).toBe(false);
    refused(usage({ citations: [cite(noThreshold)] }));
  });

  it("ambiguous: two different allowance quantities", () => {
    const text =
      "The subscription includes up to 2,000,000 API processing events per month. Enterprise tier includes up to 5,000,000 API processing events per month. Customer will pay $0.004 per excess event.";
    expect(evidence(usage({ citations: [cite(text)] }))).toEqual({
      ok: false,
      reason: "included_quantity_ambiguous",
    });
  });

  it("another component's threshold is never borrowed", () => {
    const storageOnly = "Customer will pay $0.004 per excess event.";
    const other = "The storage plan includes up to 2,000,000 gigabytes per month.";
    const component = usage({ citations: [cite(storageOnly)] });
    expect(evidence(component).ok).toBe(false);
    // Even when the other component's citation sits elsewhere in the analysis.
    const analysis = stonebridge(component);
    analysis.transactionPrice.variableConsiderationComponents[1]!.citations = [cite(other)];
    const { draft } = run(analysis);
    expect(usageRow(draft).meters).toHaveLength(0);
  });

  it.each([
    [
      "minimum commitment",
      "Customer commits to a minimum of 2,000,000 API processing events per month and will pay $0.004 per event.",
    ],
    [
      "minimum purchase",
      "The order includes a minimum purchase of 2,000,000 API processing events; Customer will pay $0.004 per event.",
    ],
    [
      "forecast",
      "Customer's forecast includes up to 2,000,000 API processing events per month. Customer will pay $0.004 per excess event.",
    ],
    [
      "expected volume",
      "Customer expects usage up to 2,000,000 API processing events per month. Customer will pay $0.004 per excess event.",
    ],
    [
      "historical volume",
      "Historical usage included up to 2,000,000 API processing events per month. Customer will pay $0.004 per excess event.",
    ],
  ])("%s is not an included quantity", (_label, text) => {
    expect(evidence(usage({ citations: [cite(text)] })).ok).toBe(false);
  });

  it("digits found only in the generated description / trigger are not authority", () => {
    const text =
      "Customer will pay $0.004 per excess API processing event above the included quantity.";
    const component = usage({ citations: [cite(text)] });
    expect(component.description).toContain("2,000,000");
    expect(evidence(component).ok).toBe(false);
  });

  it("visual citations never evidence a threshold", () => {
    const visual = { ...cite(USAGE_1), evidenceMode: "visual" as const };
    expect(evidence(usage({ citations: [visual] })).ok).toBe(false);
  });

  it("non-integer and negative thresholds are refused", () => {
    expect(evidence(usage({ includedQuantityInput: "2000000.5" })).ok).toBe(false);
    expect(evidence(usage({ includedQuantityInput: "-2000000" })).ok).toBe(false);
  });

  it("a claimed zero threshold without source support is refused", () => {
    expect(evidence(usage({ includedQuantityInput: "0" }))).toEqual({
      ok: false,
      reason: "zero_threshold_not_evidenced",
    });
    refused(usage({ includedQuantityInput: "0" }));
  });

  it("zero is accepted only for an unqualified every-unit charge", () => {
    const text = "Customer will pay $0.004 per API processing event.";
    const component = usage({ includedQuantityInput: "0", citations: [cite(text)] });
    expect(evidence(component)).toEqual({
      ok: true,
      includedQuantityInput: "0",
    });
    const { draft } = run(stonebridge(component));
    expect(usageRow(draft).meters[0]!.includedQuantityInput).toBe("0");
  });

  it("an unrepresentable rate creates no meter and raises a rate item", () => {
    const { draft, issues } = run(
      stonebridge(usage({ contractualRateOrAmountInput: "0.0000001" })),
    );
    const row = usageRow(draft);
    expect(row.meters).toHaveLength(0);
    expect(
      issues.some((i) => i.targetKey.startsWith(`vc:${row.id}.meter.`) && i.state === "red"),
    ).toBe(true);
  });
});

/* ======================================================= re-analysis */

describe("3F.3 Safe Re-analysis", () => {
  const RUN_2 = "22222222-2222-4222-8222-222222222222";

  it("unchanged threshold keeps the same meter identity without duplicates", () => {
    const first = run(stonebridge());
    const second = run(stonebridge(), first.draft, first.aiState, RUN_2);
    const a = usageRow(first.draft);
    const b = usageRow(second.draft);
    expect(b.id).toBe(a.id);
    expect(b.meters).toHaveLength(1);
    expect(b.meters[0]!.id).toBe(a.meters[0]!.id);
    expect(b.meters[0]!.includedQuantityInput).toBe("2000000");
  });

  it("a changed source threshold refreshes an untouched AI meter", () => {
    const first = run(stonebridge());
    const changed = USAGE_1.replace("2,000,000", "3,000,000");
    const next = stonebridge(
      usage({ includedQuantityInput: "3000000", citations: [cite(changed), cite(USAGE_2)] }),
    );
    const second = run(next, first.draft, first.aiState, RUN_2);
    expect(usageRow(second.draft).meters[0]!.includedQuantityInput).toBe("3000000");
  });

  it("an accountant-edited threshold is preserved with a review item", () => {
    const first = run(stonebridge());
    const edited: WorkflowDraft = {
      ...first.draft,
      variableConsiderationComponents: first.draft.variableConsiderationComponents.map((row) => ({
        ...row,
        meters: row.meters.map((meter) => ({ ...meter, includedQuantityInput: "2500000" })),
      })),
    };
    const changed = USAGE_1.replace("2,000,000", "3,000,000");
    const next = stonebridge(
      usage({ includedQuantityInput: "3000000", citations: [cite(changed), cite(USAGE_2)] }),
    );
    const second = run(next, edited, first.aiState, RUN_2);
    const row = usageRow(second.draft);
    expect(row.meters[0]!.includedQuantityInput).toBe("2500000");
    expect(
      second.issues.some((i) => i.targetKey === `vc:${row.id}.meter.includedQuantityInput`),
    ).toBe(true);
  });

  it("a later unresolved threshold never patches an existing meter", () => {
    const first = run(stonebridge());
    const second = run(
      stonebridge(usage({ includedQuantityInput: null })),
      first.draft,
      first.aiState,
      RUN_2,
    );
    const meter = usageRow(second.draft).meters[0]!;
    expect(meter.includedQuantityInput).toBe("2000000");
    expect(meter.rateAmountInput).toBe("0.04");
  });
});

/* ============================== acceptance patch: legacy blank threshold */

describe("3F.3 acceptance — legacy AI meter with a blank threshold fails closed", () => {
  const RUN_2 = "33333333-3333-4333-8333-333333333333";

  function legacyRun() {
    const legacy = stonebridge(usage({ contractualRateOrAmountInput: "1.35" }));
    delete (legacy.transactionPrice.variableConsiderationComponents[0] as Record<string, unknown>)[
      "includedQuantityInput"
    ];
    return run(legacy);
  }
  const v10Null = () =>
    stonebridge(usage({ contractualRateOrAmountInput: "1.35", includedQuantityInput: null }));

  function withUsage(draft: WorkflowDraft): WorkflowDraft {
    return {
      ...draft,
      variableConsiderationComponents: draft.variableConsiderationComponents.map((row) =>
        VC_ID_PATTERN.test(row.id)
          ? {
              ...row,
              usagePeriods: [
                {
                  id: `${row.id}-p-2027-02`,
                  month: "2027-02",
                  quantities: { [row.meters[0]!.id]: "500" },
                },
              ],
            }
          : row,
      ),
    };
  }

  it("starts from the legacy shape: priced 1.35 / 1 meter, blank threshold, AI-owned", () => {
    const first = legacyRun();
    const row = usageRow(first.draft);
    const meter = row.meters[0]!;
    expect(meter.rateAmountInput).toBe("1.35");
    expect(meter.rateQuantityInput).toBe("1");
    expect((meter.includedQuantityInput ?? "").trim()).toBe("");
    expect(first.aiState.fieldProvenance[`vc:${row.id}.meter.rateAmountInput`]!.state).toBe(
      "ai_generated_untouched",
    );
  });

  it("v10 null disables the stale AI pricing and raises the blocking threshold item", () => {
    const first = legacyRun();
    const second = run(v10Null(), first.draft, first.aiState, RUN_2);
    const row = usageRow(second.draft);
    expect(
      second.draft.variableConsiderationComponents.filter((r) => VC_ID_PATTERN.test(r.id)),
    ).toHaveLength(1);
    expect(row.id).toBe(usageRow(first.draft).id);
    expect(row.meters).toHaveLength(1);
    const meter = row.meters[0]!;
    expect(meter.rateAmountInput).toBe("");
    expect(meter.rateQuantityInput).toBe("");
    expect(meter.includedQuantityInput ?? "").toBe("");
    expect(meter.includedQuantityInput).not.toBe("0");
    const item = second.issues.find(
      (i) => i.targetKey === `vc:${row.id}.meter.includedQuantityInput`,
    );
    expect(item?.state).toBe("red");

    const result = buildProgressiveInput(withUsage(second.draft));
    const codes = result.blocked.filter((f) => f.ownerId === meter.id).map((f) => f.code);
    expect(codes).toContain("usage.meter.rate");
  });

  it("without the patch the same usage would have been priced from unit one (hazard proof)", () => {
    const first = legacyRun();
    const result = buildProgressiveInput(withUsage(first.draft));
    const meterId = usageRow(first.draft).meters[0]!.id;
    expect(result.blocked.filter((f) => f.ownerId === meterId)).toHaveLength(0);
  });

  it("an accountant-edited rate on the legacy meter is preserved", () => {
    const first = legacyRun();
    const edited: WorkflowDraft = {
      ...first.draft,
      variableConsiderationComponents: first.draft.variableConsiderationComponents.map((row) =>
        VC_ID_PATTERN.test(row.id)
          ? { ...row, meters: row.meters.map((m) => ({ ...m, rateAmountInput: "1.40" })) }
          : row,
      ),
    };
    const second = run(v10Null(), edited, first.aiState, RUN_2);
    const row = usageRow(second.draft);
    expect(row.meters[0]!.rateAmountInput).toBe("1.40");
    expect(row.meters[0]!.rateQuantityInput).toBe("1");
    expect(
      second.issues.some(
        (i) => i.targetKey === `vc:${row.id}.meter.includedQuantityInput` && i.state === "red",
      ),
    ).toBe(true);
  });

  it("a manual meter the accountant created is never disabled", () => {
    const base = run(stonebridge(usage({ includedQuantityInput: null })));
    const row0 = usageRow(base.draft);
    expect(row0.meters).toHaveLength(0);
    const manual: WorkflowDraft = {
      ...base.draft,
      variableConsiderationComponents: base.draft.variableConsiderationComponents.map((row) =>
        row.id === row0.id
          ? {
              ...row,
              meters: [
                {
                  id: `${row.id}-m1`,
                  seq: 1,
                  name: "Manual meter",
                  unit: "event",
                  rateAmountInput: "1.35",
                  rateQuantityInput: "1",
                  includedQuantityInput: "",
                },
              ],
            }
          : row,
      ),
    } as WorkflowDraft;
    const second = run(v10Null(), manual, base.aiState, RUN_2);
    const meter = usageRow(second.draft).meters[0]!;
    expect(meter.rateAmountInput).toBe("1.35");
    expect(meter.rateQuantityInput).toBe("1");
  });
});
