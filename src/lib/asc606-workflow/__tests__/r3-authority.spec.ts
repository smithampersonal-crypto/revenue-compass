/**
 * Phase 9G-R3 Part 2 — accounting-authority tranche (B, D, E, F, J-orchestration).
 *
 * Every assertion travels the production path: a real WorkflowDraft through
 * analyzeWorkflow(). All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { analyzeWorkflow } from "../analysis";
import { validateWorkflow } from "../validation";
import { buildProgressiveInput } from "../r3-adapter";
import { analyzeProgressiveContract } from "@/lib/asc606-progressive";
import {
  genomixR3Draft,
  withRealizedCredit,
  withSupportHours,
  withValidationTransfer,
  GENOMIX_FIXED_CENTS,
  GENOMIX_HOSTED_CENTS,
  GENOMIX_SUPPORT_CENTS,
  GENOMIX_VALIDATION_CENTS,
} from "./genomix-r3-fixture";

function progressiveOf(draft: ReturnType<typeof genomixR3Draft>) {
  const result = analyzeWorkflow(draft);
  expect(result.blockedReason).toBeNull();
  expect(result.adapterErrors).toEqual([]);
  expect(result.progressive).not.toBeNull();
  return result;
}

// ---------------------------------------------------------------------------
// B — the progressive path is the authoritative workflow path
// ---------------------------------------------------------------------------

describe("B — authoritative progressive workflow", () => {
  it("produces the fixed allocation from the workflow API at inception", () => {
    const result = progressiveOf(genomixR3Draft());
    const rows = result.progressive!.allocation!;
    expect(rows.map((r) => [r.poId, r.allocatedCents])).toEqual([
      ["po-hosted", GENOMIX_HOSTED_CENTS],
      ["po-validation", GENOMIX_VALIDATION_CENTS],
      ["po-support", GENOMIX_SUPPORT_CENTS],
    ]);
    expect(rows.reduce((sum, r) => sum + r.allocatedCents, 0)).toBe(GENOMIX_FIXED_CENTS);
  });

  it("recognizes the hosted service while validation and support stay pending", () => {
    const result = progressiveOf(genomixR3Draft());
    expect(result.revenueSchedule!.totalCents).toBe(GENOMIX_HOSTED_CENTS);
    expect(
      result.progressive!.recognition!.pending.map((p) => [p.poId, p.amountCents, p.reason]),
    ).toEqual([
      ["po-validation", GENOMIX_VALIDATION_CENTS, "awaiting_transfer_date"],
      ["po-support", GENOMIX_SUPPORT_CENTS, "awaiting_progress_actuals"],
    ]);
    expect(result.unscheduledRevenueCents).toBe(
      GENOMIX_VALIDATION_CENTS + GENOMIX_SUPPORT_CENTS,
    );
  });

  it("shows both fixed billings and partial-but-correct balances", () => {
    const { progressive } = progressiveOf(genomixR3Draft());
    expect(progressive!.billing.events.map((e) => e.amountCents)).toEqual([
      24_500_000, 24_500_000,
    ]);
    expect(progressive!.billing.totalCents).toBe(GENOMIX_FIXED_CENTS);
    expect(progressive!.balances!.partial).toBe(true);
    expect(progressive!.balances!.totalRevenueCents).toBe(GENOMIX_HOSTED_CENTS);
    expect(progressive!.balances!.pendingCents).toBe(
      GENOMIX_VALIDATION_CENTS + GENOMIX_SUPPORT_CENTS,
    );
  });

  it("reconciles transaction price to allocation, recognition and pending", () => {
    const recon = progressiveOf(genomixR3Draft()).progressive!.reconciliation!;
    expect(recon.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
    expect(recon.allocatedCents).toBe(GENOMIX_FIXED_CENTS);
    expect(
      recon.scheduledRevenueCents + recon.pendingCents + recon.blockedCents,
    ).toBe(GENOMIX_FIXED_CENTS);
    expect(recon.state).toBe("pending");
  });

  it("is not finalized while future activity is outstanding", () => {
    expect(analyzeWorkflow(genomixR3Draft()).finalized).toBe(false);
  });

  it("renders the same analysis the orchestration produced (no second engine)", () => {
    const draft = genomixR3Draft();
    const viaWorkflow = analyzeWorkflow(draft).progressive;
    const built = buildProgressiveInput(draft);
    const direct = analyzeProgressiveContract(built.input!);
    expect(JSON.stringify(viaWorkflow)).toBe(JSON.stringify(direct));
  });
});

// ---------------------------------------------------------------------------
// B — narrowed validation
// ---------------------------------------------------------------------------

describe("B — narrowed recognition validation", () => {
  it("does not demand service dates from an input-measure obligation", () => {
    const blocking = validateWorkflow(genomixR3Draft()).blocking.map((i) => i.id);
    expect(blocking).toEqual([]);
  });

  it("blocks an input-measure obligation with no expected total units", () => {
    const draft = genomixR3Draft();
    const blocking = validateWorkflow({
      ...draft,
      performanceObligations: draft.performanceObligations.map((po) =>
        po.id === "po-support" ? { ...po, totalExpectedUnitsInput: "" } : po,
      ),
    }).blocking;
    expect(blocking.length).toBeGreaterThan(0);
  });

  it("accepts not-yet-transferred with no date and blocks transferred with no date", () => {
    const draft = genomixR3Draft();
    expect(validateWorkflow(draft).blocking).toEqual([]);
    const transferredNoDate = {
      ...draft,
      performanceObligations: draft.performanceObligations.map((po) =>
        po.id === "po-validation" ? { ...po, transferStatus: "transferred" as const } : po,
      ),
    };
    expect(validateWorkflow(transferredNoDate).blocking.length).toBeGreaterThan(0);
  });

  it("blocks the contradiction of not-yet-transferred with a transfer date", () => {
    const draft = genomixR3Draft();
    const contradictory = {
      ...draft,
      performanceObligations: draft.performanceObligations.map((po) =>
        po.id === "po-validation" ? { ...po, recognitionDate: "2027-05-01" as const } : po,
      ),
    };
    expect(validateWorkflow(contradictory).blocking.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D — the accepted VC measurement stays the source of truth
// ---------------------------------------------------------------------------

describe("D — variable-consideration source of truth", () => {
  it("keeps the unconstrained estimate distinct from the included amount", () => {
    const draft = genomixR3Draft();
    const component = draft.variableConsiderationComponents[0]!;
    const constrained = {
      ...draft,
      variableConsiderationComponents: [
        {
          ...component,
          allocationTreatment: "specific_po" as const,
          effect: "increase" as const,
          estimationMethod: "expected_value" as const,
          inception: {
            ...component.inception,
            includedInput: "10,000.00",
            outcomes: [
              {
                id: "o1",
                seq: 1,
                description: "Bonus earned",
                amountInput: "40,000.00",
                probabilityInput: "60",
                isMostLikely: true,
              },
              {
                id: "o2",
                seq: 2,
                description: "Bonus missed",
                amountInput: "0.00",
                probabilityInput: "40",
                isMostLikely: false,
              },
            ],
          },
          seriesPeriods: [],
          realizedEvents: [],
        },
      ],
    };
    const built = buildProgressiveInput(constrained);
    const vc = built.input!.variableComponents![0]!;
    // The included-after-constraint amount drives the transaction price; the
    // unconstrained estimate is preserved separately as provenance.
    expect(vc.includedCents).toBe(1_000_000);
    expect(vc.estimateCents).toBe(2_400_000);
  });

  it("maps the accepted resolution facts into a single realized event", () => {
    const draft = genomixR3Draft();
    const component = draft.variableConsiderationComponents[0]!;
    const resolved = {
      ...draft,
      variableConsiderationComponents: [
        {
          ...component,
          allocationTreatment: "specific_po" as const,
          effect: "increase" as const,
          hasResolution: true,
          resolutionDate: "2027-09-30",
          resolutionAmountInput: "12,000.00",
          resolutionRationale: "The bonus milestone was achieved and invoiced.",
          seriesPeriods: [],
          realizedEvents: [],
        },
      ],
    };
    const vc = buildProgressiveInput(resolved).input!.variableComponents![0]!;
    expect((vc.realizedEvents ?? []).map((e) => [e.id, e.amountCents, e.date])).toEqual([
      ["vc-sla:resolution", 1_200_000, "2027-09-30"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// E — signed specific-series-period accounting
// ---------------------------------------------------------------------------

describe("E — signed specific-series-period accounting", () => {
  function withEstimate(effect: "increase" | "decrease", included: string) {
    const draft = genomixR3Draft();
    const component = draft.variableConsiderationComponents[0]!;
    return {
      ...draft,
      variableConsiderationComponents: [
        {
          ...component,
          effect,
          inception: {
            ...component.inception,
            includedInput: included,
            outcomes: [
              {
                id: "o1",
                seq: 1,
                description: "Expected outcome",
                amountInput: included,
                probabilityInput: "100",
                isMostLikely: true,
              },
            ],
          },
        },
      ],
    };
  }

  it("$0 inception carries no amount into the transaction price", () => {
    const recon = progressiveOf(genomixR3Draft()).progressive!.reconciliation!;
    expect(recon.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
  });

  it("an unrealized decrease lowers price and the target allocation together", () => {
    const result = progressiveOf(withEstimate("decrease", "5,000.00"));
    const recon = result.progressive!.reconciliation!;
    expect(recon.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS - 500_000);
    const hosted = recon.byPo.find((p) => p.poId === "po-hosted")!;
    expect(hosted.allocatedCents).toBe(GENOMIX_HOSTED_CENTS - 500_000);
    // The economic sign never reverses between the two layers.
    expect(recon.allocatedCents).toBe(recon.transactionPriceCents);
  });

  it("an unrealized increase raises price and the target allocation together", () => {
    const result = progressiveOf(withEstimate("increase", "5,000.00"));
    const recon = result.progressive!.reconciliation!;
    expect(recon.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS + 500_000);
    const hosted = recon.byPo.find((p) => p.poId === "po-hosted")!;
    expect(hosted.allocatedCents).toBe(GENOMIX_HOSTED_CENTS + 500_000);
  });

  it("a realized decrease reduces only the targeted series period", () => {
    const result = progressiveOf(
      withRealizedCredit(genomixR3Draft(), "5,000.00", "q2", "2027-06-30"),
    );
    const layers = result.progressive!.vc!.seriesPeriod;
    expect(layers.map((l) => [l.seriesPeriodId, l.amountCents])).toEqual([["q2", -500_000]]);
    expect(result.progressive!.vc!.generalPoolCents).toBe(0);
    expect(result.revenueSchedule!.totalCents).toBe(GENOMIX_HOSTED_CENTS - 500_000);
  });

  it("keeps no series amount in the general standalone-price pool", () => {
    for (const draft of [
      genomixR3Draft(),
      withEstimate("decrease", "5,000.00"),
      withEstimate("increase", "5,000.00"),
    ]) {
      expect(progressiveOf(draft).progressive!.vc!.generalPoolCents).toBe(0);
    }
  });

  it("carries pending magnitudes non-negatively with an explicit direction", () => {
    const vc = progressiveOf(withEstimate("decrease", "5,000.00")).progressive!.vc!;
    for (const component of vc.components) {
      expect(component.pendingSignedCents).toBeLessThanOrEqual(0);
    }
    for (const pending of vc.pendingByPo) {
      expect(pending.signedCents).toBeLessThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// F — Phase 3 and Phase 4 remain the accounting authority
// ---------------------------------------------------------------------------

describe("F — Phase 3 / Phase 4 reuse", () => {
  it("balances come from the approved contract-balance engine", () => {
    const balances = progressiveOf(genomixR3Draft()).progressive!.balances!;
    expect(balances.analysis).toBeDefined();
    expect(balances.monthly!.length).toBeGreaterThan(0);
    expect(balances.totalBilledCents).toBe(GENOMIX_FIXED_CENTS);
  });

  it("advance billing creates a contract liability", () => {
    const balances = progressiveOf(genomixR3Draft()).progressive!.balances!;
    const january = balances.monthly!.find((m) => m.month === "2027-01")!;
    expect(january.contractLiabilityCents).toBeGreaterThan(0);
    expect(january.contractAssetCents).toBe(0);
  });

  it("journals come from the approved journal engine and balance", () => {
    const journals = progressiveOf(genomixR3Draft()).progressive!.journals!;
    expect(journals.balanced).toBe(true);
    expect(journals.totalDebitCents).toBe(journals.totalCreditCents);
    for (const entry of journals.entries) {
      for (const line of entry.lines) {
        expect(line.debitCents).toBeGreaterThanOrEqual(0);
        expect(line.creditCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("fabricates no journal for a pending future event", () => {
    const journals = progressiveOf(genomixR3Draft()).progressive!.journals!;
    const validationRevenue = journals.entries.some((e) =>
      e.lines.some((l) => l.poId === "po-validation"),
    );
    expect(validationRevenue).toBe(false);
    expect(journals.pendingEvents.length).toBeGreaterThan(0);
  });

  it("presents a realized credit as a balanced non-negative reversal", () => {
    const journals = progressiveOf(
      withRealizedCredit(genomixR3Draft(), "5,000.00", "q2", "2027-06-30"),
    ).progressive!.journals!;
    expect(journals.balanced).toBe(true);
    for (const entry of journals.entries) {
      for (const line of entry.lines) {
        expect(line.debitCents).toBeGreaterThanOrEqual(0);
        expect(line.creditCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Independent mutations touch only their dependent accounting
// ---------------------------------------------------------------------------

describe("independent mutations", () => {
  it("the validation transfer date creates only validation revenue", () => {
    const result = progressiveOf(withValidationTransfer(genomixR3Draft(), "2027-03-31"));
    expect(result.revenueSchedule!.totalCents).toBe(
      GENOMIX_HOSTED_CENTS + GENOMIX_VALIDATION_CENTS,
    );
    expect(result.progressive!.recognition!.pending.map((p) => p.poId)).toEqual(["po-support"]);
  });

  it("support hours recognize only the proportion actually incurred", () => {
    const result = progressiveOf(
      withSupportHours(genomixR3Draft(), [
        { id: "pe-1", seq: 1, date: "2027-02-28", unitsInput: "50" },
      ]),
    );
    const support = result.progressive!.reconciliation!.byPo.find((p) => p.poId === "po-support")!;
    expect(support.recognizedCents).toBe(GENOMIX_SUPPORT_CENTS / 4);
    expect(support.pendingCents).toBe(GENOMIX_SUPPORT_CENTS - GENOMIX_SUPPORT_CENTS / 4);
    const validation = result.progressive!.reconciliation!.byPo.find(
      (p) => p.poId === "po-validation",
    )!;
    expect(validation.recognizedCents).toBe(0);
  });

  it("a realized credit leaves validation and support untouched", () => {
    const base = progressiveOf(genomixR3Draft()).progressive!.reconciliation!;
    const after = progressiveOf(
      withRealizedCredit(genomixR3Draft(), "5,000.00", "q2", "2027-06-30"),
    ).progressive!.reconciliation!;
    for (const poId of ["po-validation", "po-support"]) {
      expect(after!.byPo.find((p) => p.poId === poId)).toEqual(
        base!.byPo.find((p) => p.poId === poId),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// J — orchestration-level duplicate / orphan checks
// ---------------------------------------------------------------------------

describe("J — orchestration fails closed on identity defects", () => {
  function expectBlocked(mutate: (input: any) => void) {
    const built = buildProgressiveInput(genomixR3Draft());
    const input = JSON.parse(JSON.stringify(built.input)) as any;
    mutate(input);
    expect(() => analyzeProgressiveContract(input)).toThrow();
  }

  it("rejects duplicate performance-obligation identities", () => {
    expectBlocked((input) => {
      input.performanceObligations.push({ ...input.performanceObligations[0] });
    });
  });

  it("rejects duplicate progress-event identities", () => {
    expectBlocked((input) => {
      const po = input.performanceObligations.find((p: any) => p.id === "po-support");
      po.progressEvents = [
        { id: "pe-1", seq: 1, date: "2027-02-28", units: 10 },
        { id: "pe-1", seq: 2, date: "2027-03-31", units: 10 },
      ];
    });
  });

  it("rejects duplicate variable-consideration component identities", () => {
    expectBlocked((input) => {
      input.variableComponents.push({ ...input.variableComponents[0] });
    });
  });

  it("rejects duplicate realized-event identities", () => {
    expectBlocked((input) => {
      input.variableComponents[0].realizedEvents = [
        {
          id: "dup",
          seq: 1,
          date: "2027-06-30",
          amountCents: 100,
          seriesPeriodId: "q2",
          description: "a",
        },
        {
          id: "dup",
          seq: 2,
          date: "2027-09-30",
          amountCents: 100,
          seriesPeriodId: "q3",
          description: "b",
        },
      ];
    });
  });

  it("rejects duplicate series-period identities within a component", () => {
    expectBlocked((input) => {
      input.variableComponents[0].seriesPeriods.push({
        ...input.variableComponents[0].seriesPeriods[0],
      });
    });
  });

  it("rejects a variable component targeting an unknown obligation", () => {
    expectBlocked((input) => {
      input.variableComponents[0].targetPoId = "po-does-not-exist";
    });
  });

  it("rejects duplicate billing-event identities", () => {
    expectBlocked((input) => {
      input.fixedBilling.push({ ...input.fixedBilling[0] });
    });
  });

  it("rejects a cash collection referencing an unknown billing event", () => {
    expectBlocked((input) => {
      input.cashCollections = [
        {
          id: "cash-1",
          seq: 1,
          billingEventId: "nope",
          amountCents: 100,
          collectionDate: "2027-02-01",
        },
      ];
    });
  });
});
