import { describe, expect, it } from "vitest";

import {
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  derivePromiseDistinct,
  deriveStep1Conclusion,
  STEP1_CRITERIA,
} from "../types";
import { validateWorkflow } from "../validation";
import { answerAllStep1, scenarioADraft, scenarioBDraft } from "./fixtures";

describe("Step 1 conclusion (derived, never overridable)", () => {
  it("is qualified only when all five criteria are Yes", () => {
    expect(deriveStep1Conclusion(answerAllStep1(createEmptyDraft()).contract)).toBe("qualified");
  });

  it("is not_qualified when any criterion is No", () => {
    const draft = answerAllStep1(createEmptyDraft());
    draft.contract.criteria["collectibility_probable"] = {
      answer: false,
      rationale: "Customer credit review failed.",
    };
    expect(deriveStep1Conclusion(draft.contract)).toBe("not_qualified");
  });

  it("is incomplete when any criterion is unanswered", () => {
    const draft = answerAllStep1(createEmptyDraft());
    draft.contract.criteria[STEP1_CRITERIA[2]!.id] = { answer: null, rationale: "" };
    expect(deriveStep1Conclusion(draft.contract)).toBe("incomplete");
  });

  it("exposes no stored, editable conclusion field", () => {
    const draft = createEmptyDraft();
    expect(Object.keys(draft.contract)).not.toContain("conclusion");
    expect(Object.keys(draft.contract)).not.toContain("step1Conclusion");
  });
});

describe("promise distinctness (derived)", () => {
  const p = (a: boolean | null, b: boolean | null) => ({
    ...createPromiseDraft(1, "pr-1"),
    capableOfBeingDistinct: a,
    distinctWithinContractContext: b,
  });

  it("derives the conclusion from the two judgments", () => {
    expect(derivePromiseDistinct(p(true, true))).toBe(true);
    expect(derivePromiseDistinct(p(true, false))).toBe(false);
    expect(derivePromiseDistinct(p(false, true))).toBe(false);
    expect(derivePromiseDistinct(p(null, true))).toBeNull();
    expect(derivePromiseDistinct(p(true, null))).toBeNull();
  });

  it("blocks completion while a judgment is unanswered", () => {
    const draft = scenarioADraft();
    draft.promises[0]!.distinctWithinContractContext = null;
    const issues = validateWorkflow(draft).blocking;
    expect(issues.some((i) => i.id === "promise.judgments.answered")).toBe(true);
  });

  it("blocks completion when the distinctness rationale is missing", () => {
    const draft = scenarioADraft();
    draft.promises[0]!.distinctRationale = "  ";
    expect(validateWorkflow(draft).blocking.some((i) => i.id === "promise.rationale.present")).toBe(
      true,
    );
  });
});

describe("workflow validation", () => {
  it("passes for a complete draft", () => {
    expect(validateWorkflow(scenarioADraft()).blocking).toEqual([]);
    expect(validateWorkflow(scenarioBDraft()).blocking).toEqual([]);
  });

  it("requires contract metadata", () => {
    const draft = scenarioADraft();
    draft.contract.customerName = "";
    draft.contract.contractNumber = "";
    const ids = validateWorkflow(draft).blocking.map((i) => i.id);
    expect(ids).toContain("contract.customer_name.present");
    expect(ids).toContain("contract.number.present");
  });

  it("requires a rationale for each answered Step 1 criterion", () => {
    const draft = scenarioADraft();
    draft.contract.criteria[STEP1_CRITERIA[0]!.id] = { answer: true, rationale: "" };
    expect(
      validateWorkflow(draft).blocking.some((i) => i.id === "contract.criteria.rationale"),
    ).toBe(true);
  });

  it("requires at least one promise", () => {
    const draft = scenarioADraft();
    draft.promises = [];
    expect(validateWorkflow(draft).blocking.some((i) => i.id === "promise.exists")).toBe(true);
  });

  it("blocks an unassigned promise and an empty performance obligation", () => {
    const draft = scenarioADraft();
    draft.promises[0]!.performanceObligationId = null;
    const ids = validateWorkflow(draft).blocking.map((i) => i.id);
    expect(ids).toContain("promise.assigned");
    expect(ids).toContain("po.has_promise");
  });

  it("requires PO name, classification and classification rationale", () => {
    const draft = scenarioADraft();
    draft.performanceObligations[0]!.name = "";
    draft.performanceObligations[0]!.classification = null;
    draft.performanceObligations[0]!.classificationRationale = "";
    const ids = validateWorkflow(draft).blocking.map((i) => i.id);
    expect(ids).toContain("po.name.present");
    expect(ids).toContain("po.classification.present");
    expect(ids).toContain("po.classification.rationale");
  });

  it("requires single_distinct to hold exactly one promise concluded distinct", () => {
    const draft = scenarioADraft();
    draft.promises[0]!.distinctWithinContractContext = false;
    expect(
      validateWorkflow(draft).blocking.some((i) => i.id === "po.single_distinct.valid"),
    ).toBe(true);

    const two = scenarioBDraft();
    two.promises[1]!.performanceObligationId = "po-saas";
    const ids = validateWorkflow(two).blocking.map((i) => i.id);
    expect(ids).toContain("po.single_distinct.valid");
    expect(ids).toContain("po.has_promise");
  });

  it("requires a bundle to hold at least two promises and warns when all are distinct", () => {
    const draft = scenarioBDraft();
    draft.performanceObligations[0]!.classification = "bundle_not_distinct";
    expect(validateWorkflow(draft).blocking.some((i) => i.id === "po.bundle.min_promises")).toBe(
      true,
    );

    const bundled = scenarioBDraft();
    bundled.promises[1]!.performanceObligationId = "po-saas";
    bundled.performanceObligations = [
      { ...bundled.performanceObligations[0]!, classification: "bundle_not_distinct" },
    ];
    const outcome = validateWorkflow(bundled);
    expect(outcome.blocking.some((i) => i.id === "po.bundle.min_promises")).toBe(false);
    expect(outcome.warnings.some((i) => i.id === "po.bundle.all_distinct")).toBe(true);
  });

  it("leaves the series classification to the accountant but requires rationale", () => {
    const draft = scenarioADraft();
    draft.performanceObligations[0]!.classification = "series";
    expect(validateWorkflow(draft).blocking).toEqual([]);
    draft.performanceObligations[0]!.classificationRationale = "";
    expect(
      validateWorkflow(draft).blocking.some((i) => i.id === "po.classification.rationale"),
    ).toBe(true);
  });

  it("validates transaction price, SSP and recognition inputs", () => {
    const draft = scenarioADraft();
    draft.transactionPriceInput = "1.005";
    draft.performanceObligations[0]!.sspInput = "0";
    draft.performanceObligations[0]!.sspBasis = "";
    draft.performanceObligations[0]!.serviceEnd = "2026-12-31";
    draft.performanceObligations[0]!.recognitionRationale = "";
    const ids = validateWorkflow(draft).blocking.map((i) => i.id);
    expect(ids).toContain("contract.transaction_price.valid");
    expect(ids).toContain("po.ssp.positive");
    expect(ids).toContain("po.ssp_basis.present");
    expect(ids).toContain("po.service_dates.sequence");
    expect(ids).toContain("po.recognition_rationale.present");
  });

  it("requires a recognition method and its dates", () => {
    const draft = scenarioADraft();
    draft.performanceObligations[0]!.recognitionMethod = null;
    expect(
      validateWorkflow(draft).blocking.some((i) => i.id === "po.recognition_method.present"),
    ).toBe(true);

    const pit = scenarioBDraft();
    pit.performanceObligations[1]!.recognitionDate = "";
    expect(
      validateWorkflow(pit).blocking.some((i) => i.id === "po.recognition_date.present"),
    ).toBe(true);
  });

  it("requires unique PO ids and sequences", () => {
    const draft = scenarioBDraft();
    draft.performanceObligations[1] = {
      ...draft.performanceObligations[1]!,
      id: "po-saas",
      seq: 1,
    };
    const ids = validateWorkflow(draft).blocking.map((i) => i.id);
    expect(ids).toContain("po.id.unique");
    expect(ids).toContain("po.sequence.unique");
  });

  it("requires at least one performance obligation", () => {
    const draft = createEmptyDraft();
    expect(validateWorkflow(draft).blocking.some((i) => i.id === "po.exists")).toBe(true);
    expect(createPoDraft(1, "x").sspInput).toBe("");
  });
});
