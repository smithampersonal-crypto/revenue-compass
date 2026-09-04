/** Phase 5A remediation — Step 2 integrity, monetary-range and presentation. */

import { describe, expect, it } from "vitest";

import { MAX_CENTS, formatCents } from "@/lib/asc606";

import { analyzeWorkflow } from "../analysis";
import { poPresentation, promiseAnalysisRow } from "../presentation";
import {
  createMaterialRightPoDraft,
  createPoDraft,
  createPromiseDraft,
  type WorkflowDraft,
} from "../types";
import { validateWorkflow } from "../validation";
import { scenarioADraft } from "./fixtures";

function optionDraft(): WorkflowDraft {
  const base = scenarioADraft();
  const right = {
    ...createMaterialRightPoDraft(2, "po-option"),
    name: "Discounted renewal option",
    underlyingGoodOrServiceName: "Renewal subscription year 2",
    benefitAmountInput: "24,000.00",
    exerciseProbabilityInput: "80",
    sspBasis: "Incremental discount versus standalone renewal pricing.",
  };
  const promise = {
    ...createPromiseDraft(2, "pr-option"),
    kind: "customer_option" as const,
    description: "Option to renew year 2 at a 20% discount",
    conveysMaterialRight: true,
    materialRightRationale: "Incremental to discounts typically offered.",
    performanceObligationId: right.id,
  };
  return {
    ...base,
    promises: [...base.promises, promise],
    performanceObligations: [...base.performanceObligations, right],
  };
}

const ids = (draft: WorkflowDraft) => validateWorkflow(draft).blocking.map((f: { id: string }) => f.id);

describe("Step 2 material-right integrity", () => {
  it("accepts exactly one qualifying customer option on a material right", () => {
    expect(ids(optionDraft())).toEqual([]);
  });

  it("blocks a material right that contains no promise", () => {
    const draft = optionDraft();
    const promises = draft.promises.map((p) =>
      p.id === "pr-option" ? { ...p, performanceObligationId: null } : p,
    );
    expect(ids({ ...draft, promises })).toContain("po.material_right.single_promise");
  });

  it("blocks a material right that contains more than one promise", () => {
    const draft = optionDraft();
    const promises = draft.promises.map((p) =>
      p.id === "pr-saas" ? { ...p, performanceObligationId: "po-option" } : p,
    );
    expect(ids({ ...draft, promises })).toContain("po.material_right.single_promise");
  });

  it("blocks a material right whose only promise is not a qualifying option", () => {
    const draft = optionDraft();
    const promises = draft.promises.map((p) =>
      p.id === "pr-option" ? { ...p, kind: "good_or_service" as const } : p,
    );
    expect(ids({ ...draft, promises })).toContain("po.material_right.qualifying_option");
  });

  it("blocks a qualifying option assigned to a standard performance obligation", () => {
    const draft = optionDraft();
    const standard = { ...createPoDraft(3, "po-extra"), name: "Extra" };
    const promises = draft.promises.map((p) =>
      p.id === "pr-option" ? { ...p, performanceObligationId: "po-extra" } : p,
    );
    expect(
      ids({ ...draft, promises, performanceObligations: [...draft.performanceObligations, standard] }),
    ).toContain("promise.material_right.po_kind");
  });
});

describe("a customer option conveying no material right", () => {
  const draft: WorkflowDraft = (() => {
    const base = scenarioADraft();
    const promise = {
      ...createPromiseDraft(2, "pr-option"),
      kind: "customer_option" as const,
      description: "Option to renew at list price",
      conveysMaterialRight: false,
      materialRightRationale: "Priced at standalone selling price; no incremental discount.",
      performanceObligationId: null,
    };
    return { ...base, promises: [...base.promises, promise] };
  })();

  it("is never required to be assigned to a performance obligation", () => {
    expect(ids(draft)).toEqual([]);
  });

  it("may not be assigned to a performance obligation", () => {
    const promises = draft.promises.map((p) =>
      p.id === "pr-option" ? { ...p, performanceObligationId: "po-saas" } : p,
    );
    expect(ids({ ...draft, promises })).toContain(
      "promise.option.no_material_right.unassigned",
    );
  });

  it("never enters allocation", () => {
    const result = analyzeWorkflow(draft);
    expect(result.finalized).toBe(true);
    expect(result.allocation?.map((row) => row.poId)).toEqual(["po-saas"]);
  });
});

describe("monetary-range validation with material rights", () => {
  it("blocks when the derived material-right SSP pushes the aggregate out of range", () => {
    const draft = optionDraft();
    const performanceObligations = draft.performanceObligations.map((po) =>
      po.id === "po-saas"
        ? { ...po, sspInput: formatCents(MAX_CENTS).replace("$", "") }
        : { ...po, benefitAmountInput: "1,000,000.00" },
    );
    expect(ids({ ...draft, performanceObligations })).toContain(
      "allocation.total_ssp.supported_range",
    );
  });

  it("blocks when lifecycle consideration exceeds the supported range", () => {
    const draft = optionDraft();
    const performanceObligations = draft.performanceObligations.map((po) =>
      po.kind === "material_right"
        ? {
            ...po,
            materialRightStatus: "exercised" as const,
            exerciseDate: "2027-12-01",
            exerciseConsiderationInput: formatCents(MAX_CENTS).replace("$", ""),
            recognitionMethod: "point_in_time" as const,
            recognitionDate: "2028-01-01",
            recognitionRationale: "Delivered at a point in time.",
          }
        : po,
    );
    expect(ids({ ...draft, performanceObligations })).toContain(
      "lifecycle.consideration.supported_range",
    );
  });
});

describe("accountant-facing presentation view-models", () => {
  const draft = optionDraft();

  it("never labels a customer option's distinctness as incomplete", () => {
    const row = promiseAnalysisRow(draft.promises.find((p) => p.id === "pr-option")!);
    expect(row.promiseType).toBe("Customer option");
    expect(row.showsDistinctness).toBe(false);
    expect(row.derivedConclusion).toBeNull();
    expect(row.materialRightConclusion).toBe("Yes");
  });

  it("keeps ordinary distinctness presentation for goods and services", () => {
    const row = promiseAnalysisRow(draft.promises.find((p) => p.id === "pr-saas")!);
    expect(row.derivedConclusion).toBe("Distinct");
    expect(row.materialRightConclusion).toBeNull();
  });

  it("never shows 'Not selected' for inapplicable material-right fields", () => {
    const view = poPresentation(draft.performanceObligations.find((po) => po.id === "po-option")!);
    expect(view.isMaterialRight).toBe(true);
    expect(view.classificationLabel).not.toContain("Not selected");
    expect(view.sspLabel).toContain("material-right SSP");
    expect(view.recognitionLabel).toContain("Lifecycle");
  });
});
