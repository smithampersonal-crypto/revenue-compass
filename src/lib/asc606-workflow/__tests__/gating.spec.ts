import { describe, expect, it } from "vitest";

import { formatCents, MAX_CENTS, type Phase1Analysis } from "@/lib/asc606";
import { analyzeWorkflow, previewAllocation } from "../analysis";
import { STEP1_CRITERIA } from "../types";
import { validateWorkflow } from "../validation";
import { deriveStep1Conclusion } from "../types";
import { scenarioADraft, scenarioBDraft } from "./fixtures";

describe("Finding 1 — Step 1 qualification gates the Step 4 allocation preview", () => {
  it("Test 1 — a No answer blocks the allocation preview", () => {
    const draft = scenarioADraft();
    draft.contract.criteria["collectibility_probable"] = {
      answer: false,
      rationale: "Collection is not probable.",
    };
    expect(deriveStep1Conclusion(draft.contract)).toBe("not_qualified");

    const preview = previewAllocation(draft);
    expect(preview.rows).toBeNull();
    expect(preview.totalAllocatedCents).toBeNull();
    expect(preview.issues.join(" ")).toMatch(/step 1/i);

    expect(analyzeWorkflow(draft).finalized).toBe(false);
  });

  it("Test 2 — an unanswered criterion blocks the allocation preview", () => {
    const draft = scenarioADraft();
    draft.contract.criteria[STEP1_CRITERIA[1]!.id] = { answer: null, rationale: "" };
    expect(deriveStep1Conclusion(draft.contract)).toBe("incomplete");

    const preview = previewAllocation(draft);
    expect(preview.rows).toBeNull();
    expect(preview.issues.length).toBeGreaterThan(0);
  });

  it("Test 3 — a qualified Step 1 still permits the allocation preview", () => {
    const preview = previewAllocation(scenarioADraft());
    expect(preview.rows!.map((r) => formatCents(r.allocatedCents))).toEqual(["$120,000.00"]);
  });
});

describe("Finding 2 — aggregate SSP supported range", () => {
  const overflowDraft = () => {
    const draft = scenarioBDraft();
    const half = String(Math.floor(MAX_CENTS / 100 / 2) + 1);
    draft.performanceObligations[0]!.sspInput = half;
    draft.performanceObligations[1]!.sspInput = half;
    return draft;
  };

  it("Test 4 — blocks before any engine analysis", () => {
    const draft = overflowDraft();
    const blocking = validateWorkflow(draft).blocking;
    expect(blocking.some((i) => i.id === "allocation.total_ssp.supported_range")).toBe(true);
    expect(blocking.some((i) => i.id === "allocation.total_ssp.supported_range" && i.step === "4")).toBe(
      true,
    );

    const preview = previewAllocation(draft);
    expect(preview.rows).toBeNull();

    const result = analyzeWorkflow(draft);
    expect(result.finalized).toBe(false);
    expect(result.analysis).toBeNull();
  });
});

describe("Finding 3 — engine blocking validation can never finalize", () => {
  it("Test 5 — finalized is false and the engine validation is exposed", () => {
    const stub = (): Phase1Analysis => ({
      validation: {
        status: "attention",
        results: [],
        blockingFailures: [
          {
            id: "engine.test.blocking",
            category: "allocation",
            severity: "blocking",
            message: "Injected blocking engine validation failure.",
            passed: false,
          },
        ],
      },
      allocation: null,
      revenueSchedule: null,
      totals: { transactionPriceCents: 0, allocatedCents: null, revenueCents: null },
      reconciliation: {
        allocationDifferenceCents: null,
        revenueDifferenceCents: null,
        reconciled: null,
      },
    });

    const result = analyzeWorkflow(scenarioADraft(), { analyze: stub });
    expect(result.finalized).toBe(false);
    expect(result.analysis).toBeNull();
    expect(result.engineValidation!.blockingFailures.map((f) => f.id)).toContain(
      "engine.test.blocking",
    );
  });

  it("still finalizes a clean scenario", () => {
    const result = analyzeWorkflow(scenarioADraft());
    expect(result.finalized).toBe(true);
    expect(result.engineValidation!.blockingFailures).toEqual([]);
  });
});

describe("Finding 4 — promise identity integrity", () => {
  it("Test 6 — empty or whitespace-only promise id blocks", () => {
    const draft = scenarioADraft();
    draft.promises[0] = { ...draft.promises[0]!, id: "   " };
    draft.performanceObligations[0]!.classification = "single_distinct";
    expect(validateWorkflow(draft).blocking.some((i) => i.id === "promise.id.empty")).toBe(true);
  });

  it("Test 7 — duplicate promise ids block", () => {
    const draft = scenarioBDraft();
    draft.promises[1] = { ...draft.promises[1]!, id: "pr-saas" };
    expect(validateWorkflow(draft).blocking.some((i) => i.id === "promise.id.unique")).toBe(true);
  });

  it("Test 8 — non-positive or non-whole promise sequences block", () => {
    for (const seq of [0, -1, 1.5]) {
      const draft = scenarioADraft();
      draft.promises[0] = { ...draft.promises[0]!, seq };
      expect(validateWorkflow(draft).blocking.some((i) => i.id === "promise.seq.valid")).toBe(true);
    }
  });

  it("Test 9 — duplicate promise sequences block", () => {
    const draft = scenarioBDraft();
    draft.promises[1] = { ...draft.promises[1]!, seq: 1 };
    expect(validateWorkflow(draft).blocking.some((i) => i.id === "promise.seq.unique")).toBe(true);
  });
});

describe("Finding 5 — Step 2B bundle warning is available to the Step 2B UI", () => {
  it("Test 10 — warns without blocking", () => {
    const draft = scenarioBDraft();
    draft.promises[1] = { ...draft.promises[1]!, performanceObligationId: "po-saas" };
    draft.performanceObligations = [
      { ...draft.performanceObligations[0]!, classification: "bundle_not_distinct" },
    ];
    const outcome = validateWorkflow(draft);
    const warning = outcome.warnings.find((w) => w.id === "po.bundle.all_distinct");
    expect(warning).toBeDefined();
    expect(warning!.step).toBe("2b");
    expect(outcome.warningsByStep["2b"].map((w) => w.id)).toContain("po.bundle.all_distinct");
    expect(outcome.blocking.some((i) => i.id === "po.bundle.all_distinct")).toBe(false);
  });
});
