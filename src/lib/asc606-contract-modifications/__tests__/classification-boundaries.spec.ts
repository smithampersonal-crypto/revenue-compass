/**
 * ASC 606-10-25-12 separate-contract boundary coverage (remediation item 6).
 *
 * A modification must NOT qualify as a separate contract merely because two
 * global Yes/No judgments were answered affirmatively.
 */

import { describe, expect, it } from "vitest";

import { classifyModification, separateContractTest } from "../classification";
import { case9SeparateContract, case10Prospective, case11CatchUp } from "./fixtures";
import type { ContractModificationInput } from "../types";

const event = (input: ContractModificationInput) => input.contractModifications[0]!;

function case9(mutate: (input: ContractModificationInput) => void): ContractModificationInput {
  const input = case9SeparateContract();
  mutate(input);
  return input;
}

describe("separate-contract test", () => {
  it("passes for a clean added-scope-at-SSP modification", () => {
    const test = separateContractTest(event(case9SeparateContract()));
    expect(test.passed).toBe(true);
    expect(test.failures).toEqual([]);
    expect(classifyModification(event(case9SeparateContract())).treatment).toBe("separate_contract");
  });

  it("fails a price-only modification with no added obligation", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.postModificationPerformanceObligations =
        i.contractModifications[0]!.postModificationPerformanceObligations.filter((po) => po.status !== "added");
    });
    const test = separateContractTest(event(input));
    expect(test.passed).toBe(false);
    expect(test.failures.join(" ")).toContain("No performance obligation was added");
    expect(classifyModification(event(input)).treatment).not.toBe("separate_contract");
  });

  it("fails a scope decrease", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.considerationMagnitudeCents = 1_000_000;
      i.contractModifications[0]!.considerationEffect = "decrease";
    });
    expect(separateContractTest(event(input)).passed).toBe(false);
  });

  it("fails a no-change-in-consideration modification", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.considerationMagnitudeCents = 0;
      i.contractModifications[0]!.considerationEffect = "none";
    });
    expect(separateContractTest(event(input)).passed).toBe(false);
  });

  it("fails when added goods are priced below their standalone selling price", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.priceReflectsAddedGoodsSsp = false;
    });
    const test = separateContractTest(event(input));
    expect(test.passed).toBe(false);
    expect(test.failures.join(" ")).toContain("standalone selling prices");
  });

  it("fails when added goods coincide with removal of original scope", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.removedPoIds = ["po-legacy-support"];
    });
    const test = separateContractTest(event(input));
    expect(test.passed).toBe(false);
    expect(test.failures.join(" ")).toContain("removed");
  });

  it("fails when a continuing obligation is reconfigured", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.postModificationPerformanceObligations[0]!.scopeEffect = "reconfigured";
    });
    const test = separateContractTest(event(input));
    expect(test.passed).toBe(false);
    expect(test.failures.join(" ")).toContain("repriced or reconfigured");
  });

  it("fails when an added good or service is not distinct", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.postModificationPerformanceObligations[1]!.remainingGoodsDistinctFromTransferred = false;
    });
    expect(separateContractTest(event(input)).passed).toBe(false);
  });
});

describe("routing after the separate-contract test fails", () => {
  it("routes all-distinct remaining performance prospectively", () => {
    const classification = classifyModification(event(case10Prospective()));
    expect(classification.separateContractTestPassed).toBe(false);
    expect(classification.treatment).toBe("prospective");
  });

  it("routes no-distinct remaining performance to a cumulative catch-up", () => {
    expect(classifyModification(event(case11CatchUp())).treatment).toBe("cumulative_catch_up");
  });

  it("routes partially distinct remaining performance to mixed", () => {
    const input = case10Prospective();
    input.contractModifications[0]!.postModificationPerformanceObligations[0]!.remainingGoodsDistinctFromTransferred = false;
    expect(classifyModification(event(input)).treatment).toBe("mixed");
  });

  it("records every failed criterion for the audit output", () => {
    const input = case9((i) => {
      i.contractModifications[0]!.priceReflectsAddedGoodsSsp = false;
      i.contractModifications[0]!.removedPoIds = ["po-legacy"];
    });
    expect(classifyModification(event(input)).separateContractFailures.length).toBeGreaterThan(1);
  });
});
