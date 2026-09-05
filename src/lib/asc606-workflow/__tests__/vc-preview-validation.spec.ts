/**
 * Phase 5B final control remediation: the Step 4 allocation-only preview must
 * apply the same inception variable-consideration validation as the full
 * authoritative analysis. All companies and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { previewVcAllocation } from "@/lib/asc606-variable-consideration";
import { MAX_CENTS } from "@/lib/asc606";
import { analyzeWorkflow, previewAllocation } from "../analysis";
import { previewVcMeasurement } from "../vc-measurement";
import type { VcComponentDraft, WorkflowDraft } from "../types";
import { case7Draft, payAsYouGoDraft } from "./vc-fixtures";

function patchComponent(
  draft: WorkflowDraft,
  values: (component: VcComponentDraft) => VcComponentDraft,
): WorkflowDraft {
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((c) =>
      c.treatment === "estimated" ? values(c) : c,
    ),
  };
}

describe("Case 7 Step 4 allocation without Step 5", () => {
  it("produces the approved layered allocation", () => {
    const preview = previewAllocation(case7Draft());
    expect(preview.variable).not.toBeNull();
    expect(preview.variable!.generalPoolCents).toBe(46_000_000);
    const base = Object.fromEntries(preview.variable!.base!.map((r) => [r.name, r.allocatedCents]));
    expect(base["Implementation"]).toBe(5_520_000);
    expect(base["SaaS subscription"]).toBe(40_480_000);
    expect(preview.variable!.specific[0]!.amountCents).toBe(3_000_000);
    const final = Object.fromEntries(
      preview.variable!.finalAllocations!.map((r) => [r.name, r.amountCents]),
    );
    expect(final["Implementation"]).toBe(8_520_000);
    expect(final["SaaS subscription"]).toBe(40_480_000);
    expect(preview.variable!.initialTransactionPriceCents).toBe(49_000_000);
  });

  it("shows the system-calculated estimate and derived conclusion in Step 3", () => {
    const component = case7Draft().variableConsiderationComponents[0]!;
    const measurement = previewVcMeasurement(component);
    expect(measurement.unconstrainedCents).toBe(3_000_000);
    expect(measurement.includedCents).toBe(3_000_000);
    expect(measurement.conclusion).toBe("fully_included");
    expect(measurement.issues).toEqual([]);
  });
});

describe("inception validity agrees between the full analysis and the Step 4 preview", () => {
  it("blocks an included amount greater than the unconstrained estimate", () => {
    const draft = patchComponent(case7Draft(), (c) => ({
      ...c,
      inception: { ...c.inception, includedInput: "40,000.00" },
    }));
    expect(analyzeWorkflow(draft).finalized).toBe(false);
    const preview = previewAllocation(draft);
    expect(preview.rows).toBeNull();
    expect(preview.variable?.finalAllocations ?? null).toBeNull();
    expect(preview.issues.join(" ")).toMatch(/exceed/i);
  });

  it("blocks a most-likely component with no selected outcome", () => {
    const draft = patchComponent(case7Draft(), (c) => ({
      ...c,
      inception: {
        ...c.inception,
        outcomes: c.inception.outcomes.map((o) => ({ ...o, isMostLikely: false })),
      },
    }));
    expect(analyzeWorkflow(draft).finalized).toBe(false);
    const preview = previewAllocation(draft);
    expect(preview.rows).toBeNull();
    expect(preview.issues.join(" ")).toMatch(/most-likely/i);
  });

  it("blocks expected-value probabilities that do not total 100%", () => {
    const draft = patchComponent(case7Draft(), (c) => ({
      ...c,
      estimationMethod: "expected_value",
      inception: {
        ...c.inception,
        outcomes: [
          { ...c.inception.outcomes[0]!, probabilityInput: "95", isMostLikely: false },
        ],
      },
    }));
    expect(analyzeWorkflow(draft).finalized).toBe(false);
    expect(previewAllocation(draft).rows).toBeNull();
  });

  it("accepts expected-value probabilities that total exactly 100%", () => {
    const draft = patchComponent(case7Draft(), (c) => ({
      ...c,
      estimationMethod: "expected_value",
      inception: {
        ...c.inception,
        outcomes: [{ ...c.inception.outcomes[0]!, probabilityInput: "100", isMostLikely: false }],
      },
    }));
    const preview = previewAllocation(draft);
    expect(preview.variable!.initialTransactionPriceCents).toBe(49_000_000);
  });

  it("blocks a blank constraint rationale", () => {
    const draft = patchComponent(case7Draft(), (c) => ({
      ...c,
      inception: { ...c.inception, constraintRationale: "   " },
    }));
    expect(analyzeWorkflow(draft).finalized).toBe(false);
    expect(previewAllocation(draft).rows).toBeNull();
  });

  it("blocks a missing inception effective date", () => {
    const draft = patchComponent(case7Draft(), (c) => ({
      ...c,
      inception: { ...c.inception, effectiveDate: "" },
    }));
    expect(analyzeWorkflow(draft).finalized).toBe(false);
    expect(previewAllocation(draft).rows).toBeNull();
  });
});

describe("variable consideration selected with no components", () => {
  it("blocks Step 4 instead of falling back to the fixed-only allocation", () => {
    const draft: WorkflowDraft = {
      ...case7Draft(),
      hasVariableConsideration: true,
      variableConsiderationComponents: [],
    };
    expect(analyzeWorkflow(draft).finalized).toBe(false);
    const preview = previewAllocation(draft);
    expect(preview.rows).toBeNull();
    expect(preview.totalAllocatedCents).toBeNull();
    expect(preview.issues.join(" ")).toMatch(/at least one variable-consideration component/i);
  });
});

describe("usage-only contracts", () => {
  it("allocates the inception transaction price without any future usage actuals", () => {
    const draft = payAsYouGoDraft();
    const stripped = {
      ...draft,
      variableConsiderationComponents: draft.variableConsiderationComponents.map((c) => ({
        ...c,
        usagePeriods: [],
      })),
    };
    const preview = previewAllocation(stripped);
    expect(preview.variable!.initialTransactionPriceCents).toBe(0);
    expect(preview.issues).toEqual([]);
  });
});

describe("supported monetary range at the allocation boundary", () => {
  it("returns a blocking issue instead of throwing", () => {
    expect(() => {
      const preview = previewVcAllocation({
        fixedConsiderationCents: MAX_CENTS,
        allocatables: [{ id: "po-1", seq: 1, name: "SaaS", sspCents: 1_000_000 }],
        components: [
          {
            componentId: "vc-1",
            description: "Bonus",
            effect: "increase",
            estimationMethod: "most_likely_amount",
            allocationTreatment: "general",
            targetPoId: null,
            allocationRationale: "Documented.",
            inception: {
              id: "vc-1-inception",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [{ id: "o1", seq: 1, amountCents: MAX_CENTS, isMostLikely: true }],
              includedCents: MAX_CENTS,
              constraintRationale: "Documented.",
            },
          },
        ],
      });
      expect(preview.finalAllocations).toBeNull();
      expect(preview.issues.length).toBeGreaterThan(0);
    }).not.toThrow();
  });
});
