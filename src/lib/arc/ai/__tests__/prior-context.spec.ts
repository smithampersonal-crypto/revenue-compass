/**
 * Phase 9F — protected prior finalized accounting context.
 *
 * Proves that an amendment receives the exact superseded finalized revision's
 * accounting facts, that revision 1 and temporary workspaces receive none, and
 * that the compact context never carries schedule rows, journals or AI prose.
 */

import { describe, expect, it } from "vitest";

import {
  buildPriorAccountingContext,
  loadPriorAccountingContext,
  type PriorRevisionReader,
  type PriorRevisionRecord,
} from "../prior-context.server";

const PRIOR: PriorRevisionRecord = {
  id: "rev-1",
  analysisId: "analysis-1",
  status: "superseded",
  schemaVersion: "arc-workflow-1",
  finalizedAt: "2026-03-31T18:04:00.000Z",
  canonicalInputs: {
    transactionPriceInput: "120000.00",
    aiRationale: "The model said the platform subscription is a series.",
    performanceObligations: [
      {
        id: "po-1",
        seq: 1,
        name: "Platform subscription",
        kind: "standard",
        classification: "over_time",
        sspInput: "100000.00",
        sspBasis: "observable list price",
        recognitionMethod: "ratable_daily",
        serviceStart: "2026-01-01",
        serviceEnd: "2026-12-31",
        recognitionDate: "",
      },
      {
        id: "po-2",
        seq: 2,
        name: "Implementation",
        kind: "standard",
        classification: "point_in_time",
        sspInput: "20000.00",
        sspBasis: "cost plus margin",
        recognitionMethod: "point_in_time",
        serviceStart: "",
        serviceEnd: "",
        recognitionDate: "2026-02-15",
      },
    ],
    contractModifications: [
      {
        id: "mod-1",
        seq: 1,
        modificationDate: "2026-02-01",
        classification: "separate_contract",
        additionalConsiderationInput: "10000.00",
      },
    ],
  },
  engineOutputs: {
    workflow: {
      allocation: [
        { poId: "po-1", name: "Platform subscription", sspCents: 10000000, allocatedCents: 10000000 },
        { poId: "po-2", name: "Implementation", sspCents: 2000000, allocatedCents: 2000000 },
      ],
      revenueSchedule: { rows: Array.from({ length: 24 }, (_, i) => ({ month: i, revenueCents: 1 })) },
    },
    journals: { entries: Array.from({ length: 40 }, (_, i) => ({ id: `je-${i}` })) },
  },
  reconciliationSnapshot: {
    totals: { transactionPriceCents: 12000000, revenueCents: 9000000, allocatedCents: 12000000 },
  },
};

function reader(overrides: Partial<PriorRevisionReader> = {}): PriorRevisionReader {
  return {
    readAmendmentParent: async () => ({
      analysisId: "analysis-1",
      supersedesRevisionId: "rev-1",
    }),
    readHistoricalRevision: async () => PRIOR,
    ...overrides,
  };
}

describe("prior finalized accounting context", () => {
  it("returns null for an initial revision that supersedes nothing", async () => {
    const context = await loadPriorAccountingContext(
      reader({
        readAmendmentParent: async () => ({ analysisId: "analysis-1", supersedesRevisionId: null }),
      }),
      "rev-1",
    );
    expect(context).toBeNull();
  });

  it("returns null when the editable revision cannot be read", async () => {
    const context = await loadPriorAccountingContext(
      reader({ readAmendmentParent: async () => null }),
      "rev-2",
    );
    expect(context).toBeNull();
  });

  it("resolves the exact superseded finalized revision for an amendment", async () => {
    const context = await loadPriorAccountingContext(reader(), "rev-2");
    expect(context?.sourceRevisionId).toBe("rev-1");
    expect(context?.kind).toBe("prior_finalized");
    expect(context?.finalizedAt).toBe("2026-03-31T18:04:00.000Z");
  });

  it("refuses a historical revision from another analysis", async () => {
    await expect(
      loadPriorAccountingContext(
        reader({
          readHistoricalRevision: async () => ({ ...PRIOR, analysisId: "analysis-other" }),
        }),
        "rev-2",
      ),
    ).rejects.toThrow(/prior finalized analysis/i);
  });

  it("ignores a superseded pointer that is not finalized history", async () => {
    const context = await loadPriorAccountingContext(
      reader({ readHistoricalRevision: async () => ({ ...PRIOR, status: "draft" }) }),
      "rev-2",
    );
    expect(context).toBeNull();
  });

  it("includes prior obligations with their classification", () => {
    const context = buildPriorAccountingContext(PRIOR);
    expect(context.performanceObligations.map((po) => po["id"])).toEqual(["po-1", "po-2"]);
    expect(context.performanceObligations[0]!["classification"]).toBe("over_time");
  });

  it("includes prior SSP and allocation", () => {
    const context = buildPriorAccountingContext(PRIOR);
    expect(context.performanceObligations[0]!["sspInput"]).toBe("100000.00");
    expect(context.allocation).toEqual([
      { poId: "po-1", name: "Platform subscription", sspCents: 10000000, allocatedCents: 10000000 },
      { poId: "po-2", name: "Implementation", sspCents: 2000000, allocatedCents: 2000000 },
    ]);
  });

  it("includes recognition methods and periods or events", () => {
    const context = buildPriorAccountingContext(PRIOR);
    expect(context.recognitionSummary[0]).toMatchObject({
      poId: "po-1",
      recognitionMethod: "ratable_daily",
      serviceStart: "2026-01-01",
      serviceEnd: "2026-12-31",
    });
    expect(context.recognitionSummary[1]).toMatchObject({ recognitionDate: "2026-02-15" });
  });

  it("includes the prior transaction price and modification history", () => {
    const context = buildPriorAccountingContext(PRIOR);
    expect(context.transactionPriceInput).toBe("120000.00");
    expect(context.modificationSummary).toHaveLength(1);
    expect(context.modificationSummary[0]!["classification"]).toBe("separate_contract");
  });

  it("includes revenue recognized through the finalized date", () => {
    const context = buildPriorAccountingContext(PRIOR);
    expect(context.revenueRecognizedThroughDate).toBe("2026-03-31");
  });

  it("includes the remaining consideration", () => {
    const context = buildPriorAccountingContext(PRIOR);
    expect(context.remainingConsiderationInput).toBe("30000.00");
  });

  it("excludes the full monthly schedule, the journals and prior AI prose", () => {
    const serialized = JSON.stringify(buildPriorAccountingContext(PRIOR));
    expect(serialized).not.toContain("revenueSchedule");
    expect(serialized).not.toContain("je-0");
    expect(serialized).not.toContain("The model said");
  });

  it("tolerates a historical revision with no engine outputs", () => {
    const context = buildPriorAccountingContext({
      ...PRIOR,
      engineOutputs: null,
      reconciliationSnapshot: null,
    });
    expect(context.allocation).toEqual([]);
    expect(context.remainingConsiderationInput).toBeNull();
  });
});
