import { describe, expect, it } from "vitest";

import type { CheckResult } from "@/lib/asc606";

import { groupPassedValidationChecks } from "./review-validation-presentation";

describe("Review & Finalize passed-check presentation", () => {
  it("conserves every passed result exactly once and leaves technical order authoritative", () => {
    const checks: CheckResult[] = [
      {
        id: "po.exists",
        category: "performance_obligations",
        severity: "blocking",
        message: "PO fixture.",
        passed: true,
      },
      {
        id: "future.validation.rule",
        category: "contract",
        severity: "warning",
        message: "Future fixture.",
        passed: true,
      },
      {
        id: "failed.fixture",
        category: "allocation",
        severity: "blocking",
        message: "Failed fixture.",
        passed: false,
      },
      {
        id: "accounting_horizon.supported_range",
        category: "revenue",
        severity: "blocking",
        message: "Horizon fixture.",
        passed: true,
      },
      {
        id: "contract.transaction_price.valid",
        category: "contract",
        severity: "blocking",
        message: "Contract fixture.",
        passed: true,
      },
    ];
    const technicalOrder = checks.filter((check) => check.passed);
    const groups = groupPassedValidationChecks(checks);
    const presented = groups.flatMap((group) => group.checks);

    expect(presented).toHaveLength(technicalOrder.length);
    expect(new Set(presented).size).toBe(technicalOrder.length);
    expect(new Set(presented)).toEqual(new Set(technicalOrder));
    expect(groups.find((group) => group.heading === "Other validation checks")?.checks).toEqual([
      technicalOrder[1],
    ]);
    expect(groups.every((group) => group.checks.length > 0)).toBe(true);
    expect(technicalOrder.map((check) => check.id)).toEqual([
      "po.exists",
      "future.validation.rule",
      "accounting_horizon.supported_range",
      "contract.transaction_price.valid",
    ]);
  });
});