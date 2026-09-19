/**
 * Phase 9G-R3 — accounting-authority / integrity patch acceptance.
 *
 * Every test starts from a REAL WorkflowDraft and travels the production path:
 * `analyzeWorkflow`, the Step 4 presenter input `previewAllocation`, and the
 * live workpaper `buildWorkpaper`. Nothing here builds a progressive engine
 * input by hand, and no test re-implements accounting arithmetic: each
 * assertion reads a field the accepted engines produced.
 */

import { describe, expect, it } from "vitest";

import {
  buildWorkpaper,
  buildFinalizationSnapshot,
  isWorkpaperComplete,
} from "@/lib/arc/persistence/snapshot";
import { analyzeJournalEntries } from "@/lib/asc606-journals";

import { analyzeWorkflow, previewAllocation } from "../analysis";
import { draftRequiresProgressive } from "../r3-adapter";
import { createVcComponentDraft, type VcComponentDraft, type WorkflowDraft } from "../types";
import {
  genomixR3Draft,
  withRealizedCredit,
  withSupportHours,
  withValidationTransfer,
  GENOMIX_HOSTED_CENTS,
  GENOMIX_SUPPORT_CENTS,
  GENOMIX_VALIDATION_CENTS,
  GENOMIX_FIXED_CENTS,
} from "./genomix-r3-fixture";

/** The ordinary (non-grouped) journal analysis of a live workpaper. */
function ordinaryJournals(draft: WorkflowDraft) {
  const journals = buildWorkpaper(draft).journals;
  if (journals?.kind !== "ordinary") throw new Error("expected an ordinary journal set");
  return journals.analysis;
}

const QUARTERS = [
  { id: "q1", seq: 1, label: "Q1 2027", startDate: "2027-01-01", endDate: "2027-03-31" },
  { id: "q2", seq: 2, label: "Q2 2027", startDate: "2027-04-01", endDate: "2027-06-30" },
  { id: "q3", seq: 3, label: "Q3 2027", startDate: "2027-07-01", endDate: "2027-09-30" },
  { id: "q4", seq: 4, label: "Q4 2027", startDate: "2027-10-01", endDate: "2027-12-31" },
];

/** All 200 contracted support hours incurred, so nothing stays pending. */
function allSupportHours(draft: WorkflowDraft): WorkflowDraft {
  return withSupportHours(draft, [
    { id: "pe-1", seq: 1, date: "2027-03-31", unitsInput: "100" },
    { id: "pe-2", seq: 2, date: "2027-06-30", unitsInput: "100" },
  ]);
}

/** Genomix with every future operational fact resolved. */
function resolvedGenomix(): WorkflowDraft {
  return allSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-15"));
}

function allocationFor(draft: WorkflowDraft, poId: string): number {
  const row = analyzeWorkflow(draft).allocation?.find((r) => r.poId === poId);
  if (!row) throw new Error(`no allocation row for ${poId}`);
  return row.allocatedCents;
}

/** A specific-series-period credit/uplift on the hosted series obligation. */
function slaComponentWith(
  effect: "increase" | "decrease",
  includedInput: string,
  realized: { amountInput: string; periodId: string; date: string }[],
): VcComponentDraft {
  const base = createVcComponentDraft(1, "vc-sla", "estimated");
  return {
    ...base,
    description: "Service-level adjustment",
    effect,
    estimationMethod: "most_likely_amount",
    allocationTreatment: "specific_series_period",
    targetPoId: "po-hosted",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale: "The amount relates specifically to the quarter it arises in.",
    inception: {
      ...base.inception,
      effectiveDate: "2027-01-01",
      includedInput,
      constraintRationale: "Most likely amount at inception.",
      outcomes: [
        {
          id: "vc-sla-o1",
          seq: 1,
          description: "Most likely outcome",
          amountInput: includedInput,
          probabilityInput: "100",
          isMostLikely: true,
        },
      ],
    },
    seriesPeriods: QUARTERS,
    realizedEvents: realized.map((event, index) => ({
      id: `vc-sla-r${index + 1}`,
      seq: index + 1,
      date: event.date,
      amountInput: event.amountInput,
      seriesPeriodId: event.periodId,
      description: "Realized service-level adjustment",
    })),
    billOnRealization: true,
  };
}

function withSla(draft: WorkflowDraft, component: VcComponentDraft): WorkflowDraft {
  return { ...draft, variableConsiderationComponents: [component] };
}

/** A usage rule on the hosted series obligation. */
function usageComponent(actuals: { month: string; quantity: string }[]): VcComponentDraft {
  const base = createVcComponentDraft(2, "vc-usage", "usage_as_incurred");
  return {
    ...base,
    description: "Overage API calls",
    effect: "increase",
    allocationTreatment: "specific_series_period",
    targetPoId: "po-hosted",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    meters: [
      {
        id: "m1",
        seq: 1,
        name: "API calls",
        rateAmountInput: "1.00",
        rateQuantityInput: "100",
        unit: "calls",
        includedQuantityInput: "50",
      },
    ],
    seriesPeriods: QUARTERS,
    billOnRealization: true,
    usagePeriods: actuals.map((actual, index) => ({
      id: `up-${index + 1}`,
      month: actual.month,
      quantities: { m1: actual.quantity },
    })),
  };
}

// ---------------------------------------------------------------------------
// A / H — one authority for Step 4, balances, journals and finalization
// ---------------------------------------------------------------------------

describe("A/H — the progressive result is the only production authority", () => {
  it("routes the Genomix contract to the progressive authority", () => {
    const workflow = analyzeWorkflow(genomixR3Draft());
    expect(workflow.progressive).not.toBeNull();
    expect(workflow.allocation).not.toBeNull();
  });

  it("gives the Step 4 presenter exactly the authoritative allocation", () => {
    const draft = genomixR3Draft();
    const workflow = analyzeWorkflow(draft);
    const preview = previewAllocation(draft);

    expect(preview.rows).toEqual(workflow.allocation);
    expect(preview.totalAllocatedCents).toBe(GENOMIX_FIXED_CENTS);
    expect(preview.issues).toEqual([]);
    // The legacy Phase 5B objection to the series-period exception is gone.
    expect(preview.issues.join(" ")).not.toContain("series-period");
  });

  it("allocates the fixed consideration across the three obligations", () => {
    const draft = genomixR3Draft();
    expect(allocationFor(draft, "po-hosted")).toBe(GENOMIX_HOSTED_CENTS);
    expect(allocationFor(draft, "po-validation")).toBe(GENOMIX_VALIDATION_CENTS);
    expect(allocationFor(draft, "po-support")).toBe(GENOMIX_SUPPORT_CENTS);
  });

  it("presents partial balances and journals from the same progressive run", () => {
    const draft = genomixR3Draft();
    const workflow = analyzeWorkflow(draft);
    const workpaper = buildWorkpaper(draft);
    const progressive = workflow.progressive!;

    expect(workpaper.balances.analysis).toEqual(progressive.balances!.analysis);
    expect(workpaper.balances.engineInput).toEqual(progressive.balances!.contractBalanceInput);
    expect(workpaper.journals?.kind).toBe("ordinary");
    expect(workpaper.journals!.analysis).toEqual(
      analyzeJournalEntries(progressive.balances!.contractBalanceInput),
    );

    // Presentable, but never finalizable while a future fact is pending.
    expect(workpaper.balances.finalized).toBe(false);
    expect(workflow.finalized).toBe(false);
    expect(isWorkpaperComplete(workpaper)).toBe(false);
    expect(buildFinalizationSnapshot(draft).ok).toBe(false);
  });

  it("becomes complete through the same path once every future fact is resolved", () => {
    const draft = resolvedGenomix();
    const workflow = analyzeWorkflow(draft);
    expect(workflow.progressive).not.toBeNull();
    expect(workflow.finalized).toBe(true);

    const workpaper = buildWorkpaper(draft);
    expect(workpaper.balances.finalized).toBe(true);
    expect(workpaper.balances.analysis).toEqual(workflow.progressive!.balances!.analysis);
    expect(isWorkpaperComplete(workpaper)).toBe(true);
    expect(buildFinalizationSnapshot(draft).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B — real usage facts route through the progressive authority
// ---------------------------------------------------------------------------

describe("B — usage facts reach the progressive authority", () => {
  it("routes a usage-only contract carrying R3 usage facts", () => {
    const draft = withSla(genomixR3Draft(), usageComponent([]));
    expect(draftRequiresProgressive(draft)).toBe(true);
  });

  it("fabricates nothing while no usage has occurred", () => {
    const draft = { ...genomixR3Draft(), variableConsiderationComponents: [usageComponent([])] };
    const progressive = analyzeWorkflow(draft).progressive!;

    expect(progressive.usageAmounts).toEqual([]);
    expect(progressive.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
    expect(progressive.billing.pendingRules.map((rule) => rule.reason)).toContain(
      "awaiting_usage_actuals",
    );
    expect(progressive.billing.events.every((event) => event.kind === "fixed")).toBe(true);
  });

  it("honours the included quantity before anything is chargeable", () => {
    const draft = {
      ...genomixR3Draft(),
      variableConsiderationComponents: [usageComponent([{ month: "2027-02", quantity: "50" }])],
    };
    const progressive = analyzeWorkflow(draft).progressive!;
    expect(progressive.usageAmounts[0]?.totalCents).toBe(0);
    expect(progressive.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
  });

  it("prices only the actual usage that occurred, and bills it", () => {
    const draft = {
      ...genomixR3Draft(),
      variableConsiderationComponents: [usageComponent([{ month: "2027-02", quantity: "150" }])],
    };
    const progressive = analyzeWorkflow(draft).progressive!;

    expect(progressive.usageAmounts[0]?.totalCents).toBe(100);
    expect(progressive.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS + 100);
    expect(allocationFor(draft, "po-hosted")).toBe(GENOMIX_HOSTED_CENTS + 100);
    expect(progressive.billing.events.some((event) => event.kind === "variable_realized")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// C — an invalid fact blocks its dependent calculation and never disappears
// ---------------------------------------------------------------------------

describe("C — adapter-level invalid facts fail closed at their boundary", () => {
  it("blocks only the support obligation when a progress entry is unusable", () => {
    const draft = withSupportHours(genomixR3Draft(), [
      { id: "pe-1", seq: 1, date: "2027-03-31", unitsInput: "not a number" },
    ]);
    const workflow = analyzeWorkflow(draft);

    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain(
      "progress_event.incomplete",
    );
    const byPo = workflow.progressive!.recognition!.byPo;
    expect(byPo.find((row) => row.poId === "po-support")?.state).toBe("blocked");
    // Hosted revenue is unaffected and still determinable.
    expect(byPo.find((row) => row.poId === "po-hosted")?.scheduledCents).toBe(GENOMIX_HOSTED_CENTS);
    expect(workflow.finalized).toBe(false);
  });

  it("blocks billing when a billing event is unusable, keeping allocation available", () => {
    const base = genomixR3Draft();
    const draft: WorkflowDraft = {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        considerationEvents: base.contractBalances.considerationEvents.map((event) =>
          event.id === "bill-2" ? { ...event, amountInput: "" } : event,
        ),
      },
    };
    const workflow = analyzeWorkflow(draft);

    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain("billing.incomplete");
    expect(workflow.progressive!.billing.state).toBe("blocked");
    expect(workflow.allocation).not.toBeNull();
    expect(workflow.finalized).toBe(false);
  });

  it("blocks the balances when a cash collection is unusable", () => {
    const base = resolvedGenomix();
    const draft: WorkflowDraft = {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        cashCollections: [
          {
            id: "cash-1",
            seq: 1,
            considerationEventId: "bill-1",
            amountInput: "-1,000.00",
            collectionDate: "2027-02-01",
            basis: "actual",
          },
        ],
      },
    };
    const workflow = analyzeWorkflow(draft);
    const balances = workflow.progressive!.balances!;

    expect(balances.analysis.validation.blockingFailures.map((f) => f.id)).toContain(
      "cash.amount.valid",
    );
    expect(balances.analysis.monthly).toBeNull();
    expect(workflow.finalized).toBe(false);
    expect(buildWorkpaper(draft).balances.finalized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D — signed credit memo, decoupled from "partial"
// ---------------------------------------------------------------------------

describe("D — a realized decrease bills as a credit memo on a complete contract", () => {
  const draft = withRealizedCredit(
    withSla(resolvedGenomix(), slaComponentWith("decrease", "0.00", [])),
    "10,000.00",
    "q1",
    "2027-03-31",
  );

  it("reduces the transaction price and reconciles signed billings against it", () => {
    const workflow = analyzeWorkflow(draft);
    const progressive = workflow.progressive!;

    expect(progressive.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS - 1_000_000);
    expect(progressive.balances!.partial).toBe(false);
    expect(progressive.balances!.contractBalanceInput.billingCompleteness).toBeUndefined();
    expect(progressive.balances!.analysis.reconciliation.reconciled).toBe(true);
    expect(progressive.balances!.totalBilledCents).toBe(GENOMIX_FIXED_CENTS - 1_000_000);
  });

  it("produces the credit memo and its reversal with no negative journal line", () => {
    const journals = ordinaryJournals(draft);
    const entries = journals.entries!;

    expect(journals.reconciliation.reconciled).toBe(true);
    for (const entry of entries) {
      for (const line of entry.lines) {
        expect(line.debitCents).toBeGreaterThanOrEqual(0);
        expect(line.creditCents).toBeGreaterThanOrEqual(0);
      }
      expect(entry.totalDebitsCents).toBe(entry.totalCreditsCents);
    }
  });
});

// ---------------------------------------------------------------------------
// E — the signed specific-series-period matrix
// ---------------------------------------------------------------------------

describe("E — signed specific-series-period accounting", () => {
  const cases = [
    {
      name: "unrealized increase",
      effect: "increase" as const,
      included: "20,000.00",
      realized: [] as string[],
    },
    {
      name: "unrealized decrease",
      effect: "decrease" as const,
      included: "20,000.00",
      realized: [],
    },
    {
      name: "partially realized increase",
      effect: "increase" as const,
      included: "20,000.00",
      realized: ["8,000.00"],
    },
    {
      name: "partially realized decrease",
      effect: "decrease" as const,
      included: "20,000.00",
      realized: ["8,000.00"],
    },
    {
      name: "fully realized increase",
      effect: "increase" as const,
      included: "20,000.00",
      realized: ["20,000.00"],
    },
    {
      name: "fully realized decrease",
      effect: "decrease" as const,
      included: "20,000.00",
      realized: ["20,000.00"],
    },
    { name: "zero at inception", effect: "decrease" as const, included: "0.00", realized: [] },
  ];

  for (const testCase of cases) {
    it(`keeps one economic sign end to end: ${testCase.name}`, () => {
      const component = slaComponentWith(
        testCase.effect,
        testCase.included,
        testCase.realized.map((amountInput) => ({
          amountInput,
          periodId: "q1",
          date: "2027-03-31",
        })),
      );
      const draft = withSla(genomixR3Draft(), component);
      const progressive = analyzeWorkflow(draft).progressive!;
      const sign = testCase.effect === "increase" ? 1 : -1;
      const included = testCase.included === "0.00" ? 0 : 2_000_000;
      const realizedMagnitude = testCase.realized.reduce(
        (total, raw) => total + (raw === "8,000.00" ? 800_000 : 2_000_000),
        0,
      );
      // `|| 0` normalizes negative zero: a nil amount has no sign.
      const signedIncluded = sign * Math.max(included, realizedMagnitude) || 0;

      // transaction price
      expect(progressive.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS + signedIncluded);
      // PO allocation: the whole signed amount lands on the target obligation
      expect(allocationFor(draft, "po-hosted")).toBe(GENOMIX_HOSTED_CENTS + signedIncluded);
      // no series amount leaks into the general relative-SSP pool
      expect(progressive.generalPoolCents).toBe(GENOMIX_FIXED_CENTS);
      expect(allocationFor(draft, "po-validation")).toBe(GENOMIX_VALIDATION_CENTS);

      // realized + still-unresolved = currently included, with one sign
      const state = progressive.vc.components.find((row) => row.componentId === "vc-sla")!;
      expect(state.realizedSignedCents + state.pendingSignedCents).toBe(signedIncluded);
      expect(progressive.reconciliation?.reconciled).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// F — the accepted Phase 3 / Phase 4 mechanics, reached through R3
// ---------------------------------------------------------------------------

describe("F — Phase 3 and Phase 4 mechanics through the progressive bridge", () => {
  function monthly(draft: WorkflowDraft) {
    return analyzeWorkflow(draft).progressive!.balances!.analysis.monthly!;
  }

  it("records advance billing as a contract liability", () => {
    const rows = monthly(genomixR3Draft());
    const january = rows.find((row) => row.month === "2027-01")!;
    expect(january.contractLiabilityCents).toBeGreaterThan(0);
    expect(january.contractAssetCents).toBe(0);
  });

  it("records revenue ahead of billing as a contract asset, cleared by the later billing", () => {
    const base = genomixR3Draft();
    const draft: WorkflowDraft = {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        considerationEvents: [
          {
            id: "bill-1",
            seq: 1,
            amountInput: "490,000.00",
            unconditionalRightDate: "2027-12-31",
            invoiceDate: "2027-12-31",
          },
        ],
      },
    };
    const rows = monthly(draft);
    expect(rows.find((row) => row.month === "2027-01")!.contractAssetCents).toBeGreaterThan(0);
    expect(rows.find((row) => row.month === "2027-12")!.contractAssetCents).toBe(0);
  });

  it("holds an unconditional right as unbilled AR until the invoice is issued", () => {
    const base = genomixR3Draft();
    const draft: WorkflowDraft = {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        considerationEvents: base.contractBalances.considerationEvents.map((event) =>
          event.id === "bill-1" ? { ...event, invoiceDate: "2027-02-15" } : event,
        ),
      },
    };
    const rows = monthly(draft);
    expect(rows.find((row) => row.month === "2027-01")!.unbilledArCents).toBe(24_500_000);
    expect(rows.find((row) => row.month === "2027-01")!.billedArCents).toBe(0);
    expect(rows.find((row) => row.month === "2027-02")!.unbilledArCents).toBe(0);
    expect(rows.find((row) => row.month === "2027-02")!.billedArCents).toBe(24_500_000);
  });

  it("clears receivables with a positive cash collection", () => {
    const base = genomixR3Draft();
    const draft: WorkflowDraft = {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        cashCollections: [
          {
            id: "cash-1",
            seq: 1,
            considerationEventId: "bill-1",
            amountInput: "245,000.00",
            collectionDate: "2027-02-10",
            basis: "actual",
          },
        ],
      },
    };
    const rows = monthly(draft);
    const february = rows.find((row) => row.month === "2027-02")!;
    expect(february.cashCollectedCents).toBe(24_500_000);
    expect(february.billedArCents).toBe(0);
  });

  it("keeps hosted revenue flowing while another obligation is still pending", () => {
    const progressive = analyzeWorkflow(genomixR3Draft()).progressive!;
    const byPo = progressive.recognition!.byPo;
    expect(byPo.find((row) => row.poId === "po-hosted")!.scheduledCents).toBe(GENOMIX_HOSTED_CENTS);
    expect(byPo.find((row) => row.poId === "po-validation")!.reason).toBe("awaiting_transfer_date");
    expect(byPo.find((row) => row.poId === "po-support")!.reason).toBe("awaiting_progress_actuals");
  });

  it("adds validation revenue only when the transfer actually happens", () => {
    const before = analyzeWorkflow(genomixR3Draft()).progressive!;
    const after = analyzeWorkflow(
      withValidationTransfer(genomixR3Draft(), "2027-02-15"),
    ).progressive!;

    expect(after.recognition!.schedule.totalCents).toBe(
      before.recognition!.schedule.totalCents + GENOMIX_VALIDATION_CENTS,
    );
    const hostedBefore = before.recognition!.byPo.find((r) => r.poId === "po-hosted")!;
    const hostedAfter = after.recognition!.byPo.find((r) => r.poId === "po-hosted")!;
    expect(hostedAfter.scheduledCents).toBe(hostedBefore.scheduledCents);
  });

  it("adds only the proportional support revenue actually earned", () => {
    const draft = withSupportHours(genomixR3Draft(), [
      { id: "pe-1", seq: 1, date: "2027-03-31", unitsInput: "50" },
    ]);
    const support = analyzeWorkflow(draft).progressive!.recognition!.byPo.find(
      (row) => row.poId === "po-support",
    )!;
    expect(support.scheduledCents).toBe(GENOMIX_SUPPORT_CENTS / 4);
    expect(support.pendingCents).toBe(GENOMIX_SUPPORT_CENTS - GENOMIX_SUPPORT_CENTS / 4);
  });

  it("fabricates no journal entry for a pending future event", () => {
    const journals = ordinaryJournals(genomixR3Draft());
    const entries = journals.entries ?? [];
    for (const entry of entries) {
      for (const line of entry.lines) {
        expect(line.poId === "po-validation").toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// G — orchestration identity guards, reached from a real draft
// ---------------------------------------------------------------------------

describe("G — orchestration fails closed on duplicate and orphan identities", () => {
  it("rejects duplicate progress event identities", () => {
    const draft = withSupportHours(genomixR3Draft(), [
      { id: "pe-1", seq: 1, date: "2027-03-31", unitsInput: "10" },
      { id: "pe-1", seq: 2, date: "2027-04-30", unitsInput: "10" },
    ]);
    const workflow = analyzeWorkflow(draft);
    expect(workflow.progressive).toBeNull();
    expect(workflow.blockedReason).toContain("duplicate");
  });

  it("rejects duplicate realized variable-consideration identities", () => {
    const component = slaComponentWith("decrease", "0.00", [
      { amountInput: "1,000.00", periodId: "q1", date: "2027-03-31" },
      { amountInput: "1,000.00", periodId: "q1", date: "2027-03-31" },
    ]);
    const duplicated: VcComponentDraft = {
      ...component,
      realizedEvents: (component.realizedEvents ?? []).map((event) => ({
        ...event,
        id: "vc-sla-r1",
      })),
    };
    const workflow = analyzeWorkflow(withSla(genomixR3Draft(), duplicated));
    expect(workflow.progressive).toBeNull();
    expect(workflow.blockedReason).toContain("duplicate");
  });

  it("rejects a variable component that targets an obligation that does not exist", () => {
    const component = { ...slaComponentWith("decrease", "0.00", []), targetPoId: "po-missing" };
    const workflow = analyzeWorkflow(withSla(genomixR3Draft(), component));
    expect(workflow.progressive).toBeNull();
    expect(workflow.blockedReason).toContain("unknown obligation");
  });

  it("blocks only the component whose realized amount targets an unknown period", () => {
    const component = slaComponentWith("decrease", "0.00", [
      { amountInput: "1,000.00", periodId: "q9", date: "2027-03-31" },
    ]);
    const workflow = analyzeWorkflow(withSla(genomixR3Draft(), component));
    const progressive = workflow.progressive!;

    expect(progressive.blocked.map((row) => row.code)).toContain(
      "variable_consideration.series.period_unmappable",
    );
    expect(
      progressive.recognition!.byPo.find((row) => row.poId === "po-hosted")!.scheduledCents,
    ).toBe(GENOMIX_HOSTED_CENTS);
    expect(workflow.finalized).toBe(false);
  });

  it("rejects duplicate usage actual identities", () => {
    const component = usageComponent([
      { month: "2027-02", quantity: "150" },
      { month: "2027-03", quantity: "150" },
    ]);
    const duplicated: VcComponentDraft = {
      ...component,
      usagePeriods: component.usagePeriods.map((period) => ({ ...period, id: "up-1" })),
    };
    const workflow = analyzeWorkflow({
      ...genomixR3Draft(),
      variableConsiderationComponents: [duplicated],
    });
    expect(workflow.progressive).toBeNull();
    expect(workflow.blockedReason).toContain("duplicate");
  });
});
