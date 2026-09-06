/**
 * Architecture regression (Phase 5C remediation items 3 and 17).
 *
 * There must be exactly ONE revenue-recognition engine. Every Phase 5C
 * performance obligation that receives ORDINARY prospective recognition must
 * produce output byte-for-byte identical to `recognizePerformanceObligation()`
 * from `src/lib/asc606/recognition.ts`, including the complete monthly array
 * and every explanation payload.
 *
 * If a modification-specific helper ever reimplements daily-ratable or
 * point-in-time scheduling, these deep comparisons fail.
 */

import { describe, expect, it } from "vitest";

import { recognizePerformanceObligation, type RecognizableUnit } from "@/lib/asc606";

import { analyzeContractModification, futureSourceId } from "../index";
import { case10Prospective, case12Mixed, case9SeparateContract } from "./fixtures";
import type { ContractModificationAnalysis } from "../types";

/** The Phase 5C monthly rows recorded against one revenue source. */
function phase5cRows(analysis: ContractModificationAnalysis, sourceId: string) {
  return (analysis.revenueSchedule?.byPo ?? [])
    .filter((row) => row.poId === sourceId)
    .map((row) => ({
      month: row.month,
      revenueCents: row.revenueCents,
      explanation: row.explanation,
    }));
}

/** What the single authoritative core engine would produce for the same PO. */
function coreRows(po: RecognizableUnit, allocatedCents: number) {
  return recognizePerformanceObligation(po, allocatedCents);
}

describe("Phase 5C delegates ordinary recognition to the core engine", () => {
  it("Case 9 — separate-contract added service matches the core engine exactly", () => {
    const analysis = analyzeContractModification(case9SeparateContract());
    expect(
      phase5cRows(analysis, "po-added-seats"),
    ).toEqual(
      coreRows(
        {
          id: "po-added-seats",
          seq: 2,
          name: "SaaS subscription (50 added seats)",
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-07-01",
          serviceEnd: "2028-12-31",
        },
        9_000_000,
      ),
    );
  });

  it("Case 9 — the original contract schedule is untouched by the modification", () => {
    const analysis = analyzeContractModification(case9SeparateContract());
    expect(phase5cRows(analysis, "po-saas")).toEqual(
      coreRows(
        {
          id: "po-saas",
          seq: 1,
          name: "SaaS subscription (100 seats)",
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-01-01",
          serviceEnd: "2028-12-31",
        },
        24_000_000,
      ),
    );
  });

  it("Case 10 — remaining original prospective service matches the core engine exactly", () => {
    const analysis = analyzeContractModification(case10Prospective());
    expect(phase5cRows(analysis, futureSourceId("mod-1", "mpo-saas"))).toEqual(
      coreRows(
        {
          id: "mpo-saas",
          seq: 1,
          name: "SaaS subscription (100 seats)",
          recognitionMethod: "over_time_ratable",
          serviceStart: "2028-07-02",
          serviceEnd: "2028-12-31",
        },
        5_200_000,
      ),
    );
  });

  it("Case 10 — added prospective service matches the core engine exactly", () => {
    const analysis = analyzeContractModification(case10Prospective());
    expect(phase5cRows(analysis, futureSourceId("mod-1", "mpo-added-seats"))).toEqual(
      coreRows(
        {
          id: "mpo-added-seats",
          seq: 2,
          name: "SaaS subscription (50 added seats)",
          recognitionMethod: "over_time_ratable",
          serviceStart: "2028-07-02",
          serviceEnd: "2028-12-31",
        },
        2_600_000,
      ),
    );
  });

  it("Case 12A — original and newly added training match the core engine exactly", () => {
    const analysis = analyzeContractModification(case12Mixed("total_transaction_price"));
    expect(phase5cRows(analysis, futureSourceId("mod-1", "mpo-training"))).toEqual(
      coreRows(
        {
          id: "mpo-training",
          seq: 2,
          name: "Onsite training",
          recognitionMethod: "point_in_time",
          recognitionDate: "2028-10-01",
        },
        6_666_667,
      ),
    );
    expect(phase5cRows(analysis, futureSourceId("mod-1", "mpo-support"))).toEqual(
      coreRows(
        {
          id: "mpo-support",
          seq: 3,
          name: "Premium support onboarding",
          recognitionMethod: "point_in_time",
          recognitionDate: "2028-11-01",
        },
        3_333_333,
      ),
    );
  });

  it("Case 12B — original and newly added training match the core engine exactly", () => {
    const analysis = analyzeContractModification(case12Mixed("remaining_transaction_price"));
    expect(phase5cRows(analysis, futureSourceId("mod-1", "mpo-training"))).toEqual(
      coreRows(
        {
          id: "mpo-training",
          seq: 2,
          name: "Onsite training",
          recognitionMethod: "point_in_time",
          recognitionDate: "2028-10-01",
        },
        6_333_333,
      ),
    );
    expect(phase5cRows(analysis, futureSourceId("mod-1", "mpo-support"))).toEqual(
      coreRows(
        {
          id: "mpo-support",
          seq: 3,
          name: "Premium support onboarding",
          recognitionMethod: "point_in_time",
          recognitionDate: "2028-11-01",
        },
        3_166_667,
      ),
    );
  });
});

describe("independent cumulative-cent clocks", () => {
  it("a separate contract starts its own clock on the modification date", () => {
    const analysis = analyzeContractModification(case9SeparateContract());
    const group = analysis.groups.find((g) => g.id !== "group::original");
    expect(group?.revenueSchedule?.firstMonth).toBe("2027-07");
    expect(group?.revenueSchedule?.byMonth[0]?.cumulativeCents).toBe(
      group?.revenueSchedule?.byMonth[0]?.totalCents,
    );
    expect(group?.revenueSchedule?.totalCents).toBe(9_000_000);
  });

  it("a 25-13(a) prospective segment restarts at zero on the modification date", () => {
    const analysis = analyzeContractModification(case10Prospective());
    const rows = phase5cRows(analysis, futureSourceId("mod-1", "mpo-saas"));
    expect(rows[0]?.month).toBe("2028-07");
    // First prospective month is measured from day one of the NEW clock, not
    // as a continuation of the original contract's cumulative curve.
    const first = rows[0]?.explanation.inputs as Record<string, unknown>;
    expect(first["priorCumulativeRevenueCents"]).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.revenueCents, 0)).toBe(5_200_000);
  });
});
