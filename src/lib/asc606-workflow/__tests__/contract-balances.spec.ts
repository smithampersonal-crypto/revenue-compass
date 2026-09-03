import { describe, expect, it } from "vitest";

import { formatCents } from "@/lib/asc606";
import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  createEmptyDraft,
  createCashCollectionDraft,
  createConsiderationEventDraft,
  createPoDraft,
  createPromiseDraft,
  parseUsdToCents,
  type WorkflowDraft,
} from "../index";
import { answerAllStep1, scenarioADraft, scenarioBDraft } from "./fixtures";

/** Phase 3 Acceptance Scenario A — Horizon Logistics, advance billing. */
function horizonDraft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const poSpecs = [
    { id: "po-saas", seq: 1, name: "SaaS", ssp: "144,000.00", start: "2027-07-01", end: "2028-06-30" },
    { id: "po-training", seq: 2, name: "Training", ssp: "12,000.00", start: "2027-07-10", end: "2027-07-11" },
    { id: "po-support", seq: 3, name: "Premium Support", ssp: "24,000.00", start: "2027-07-01", end: "2028-06-30" },
  ];
  const pos = poSpecs.map((spec) => ({
    ...createPoDraft(spec.seq, spec.id),
    name: spec.name,
    classification: "single_distinct" as const,
    classificationRationale: "Distinct promise.",
    sspInput: spec.ssp,
    sspBasis: "Observable standalone pricing.",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: spec.start,
    serviceEnd: spec.end,
    recognitionRationale: "Customer simultaneously receives and consumes the service.",
  }));
  const promises = poSpecs.map((spec, index) => ({
    ...createPromiseDraft(index + 1, `pr-${spec.id}`),
    description: spec.name,
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale: "Benefit available on its own.",
    performanceObligationId: spec.id,
  }));
  return {
    ...base,
    contract: { ...base.contract, customerName: "Horizon Logistics", contractNumber: "P3-A" },
    transactionPriceInput: "153,000.00",
    promises,
    performanceObligations: pos,
    contractBalances: {
      considerationEvents: [
        { ...createConsiderationEventDraft(1, "ce-1"), amountInput: "75,000.00", unconditionalRightDate: "2027-07-01", invoiceDate: "2027-07-01" },
        { ...createConsiderationEventDraft(2, "ce-2"), amountInput: "39,000.00", unconditionalRightDate: "2028-01-01", invoiceDate: "2028-01-01" },
        { ...createConsiderationEventDraft(3, "ce-3"), amountInput: "39,000.00", unconditionalRightDate: "2028-04-01", invoiceDate: "2028-04-01" },
      ],
      cashCollections: [
        { ...createCashCollectionDraft(1, "cc-1"), considerationEventId: "ce-1", amountInput: "75,000.00", collectionDate: "2027-07-31" },
        { ...createCashCollectionDraft(2, "cc-2"), considerationEventId: "ce-2", amountInput: "39,000.00", collectionDate: "2028-03-15" },
        { ...createCashCollectionDraft(3, "cc-3"), considerationEventId: "ce-3", amountInput: "39,000.00", collectionDate: "2028-04-30" },
      ],
    },
  };
}

/** Phase 3 Acceptance Scenario B — Stellar, quarterly arrears billing. */
function stellarDraft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const po = {
    ...createPoDraft(1, "po-saas"),
    name: "SaaS subscription",
    classification: "single_distinct" as const,
    classificationRationale: "Single distinct hosted service.",
    sspInput: "240,000.00",
    sspBasis: "Observable standalone renewal pricing.",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionRationale: "Simultaneous receipt and consumption.",
  };
  const promise = {
    ...createPromiseDraft(1, "pr-saas"),
    description: "Annual hosted SaaS service",
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale: "Benefit available on its own.",
    performanceObligationId: po.id,
  };
  const quarters = [
    { id: "q1", right: "2027-03-31", invoice: "2027-04-01", cash: "2027-04-30" },
    { id: "q2", right: "2027-06-30", invoice: "2027-07-01", cash: "2027-07-31" },
    { id: "q3", right: "2027-09-30", invoice: "2027-10-01", cash: "2027-10-31" },
    { id: "q4", right: "2027-12-31", invoice: "2028-01-01", cash: "2028-01-31" },
  ];
  return {
    ...base,
    contract: { ...base.contract, customerName: "Stellar", contractNumber: "P3-B" },
    transactionPriceInput: "240,000.00",
    promises: [promise],
    performanceObligations: [po],
    contractBalances: {
      considerationEvents: quarters.map((q, i) => ({
        ...createConsiderationEventDraft(i + 1, q.id),
        amountInput: "60,000.00",
        unconditionalRightDate: q.right,
        invoiceDate: q.invoice,
      })),
      cashCollections: quarters.map((q, i) => ({
        ...createCashCollectionDraft(i + 1, `cash-${q.id}`),
        considerationEventId: q.id,
        amountInput: "60,000.00",
        collectionDate: q.cash,
      })),
    },
  };
}

const rowFor = (rows: { month: string }[], month: string) => {
  const found = rows.find((r) => r.month === month);
  if (!found) throw new Error(`missing month ${month}`);
  return found;
};

describe("Phase 3 workflow separation", () => {
  it("does not make Phase 2 finalization depend on billing data", () => {
    const draft = scenarioADraft();
    expect(draft.contractBalances.considerationEvents).toEqual([]);
    expect(analyzeWorkflow(draft).finalized).toBe(true);
  });

  it("cannot finalize contract balances when billing data is missing", () => {
    const result = analyzeContractBalanceWorkflow(scenarioADraft());
    expect(result.finalized).toBe(false);
    expect(result.analysis).toBeNull();
    expect(result.blockedReason).not.toBeNull();
  });

  it("cannot finalize contract balances when Steps 1-5 are not finalized", () => {
    const draft = { ...stellarDraft() };
    const notQualified = answerAllStep1(draft, false);
    const result = analyzeContractBalanceWorkflow(notQualified);
    expect(result.finalized).toBe(false);
    expect(result.analysis).toBeNull();
  });

  it("blocks when consideration events do not equal the transaction price", () => {
    const draft = stellarDraft();
    draft.contractBalances = {
      ...draft.contractBalances,
      considerationEvents: draft.contractBalances.considerationEvents.slice(0, 3),
    };
    const result = analyzeContractBalanceWorkflow(draft);
    expect(result.finalized).toBe(false);
    expect(result.validation.blocking.map((i) => i.id)).toContain(
      "consideration.total.equals_transaction_price",
    );
  });
});

describe("Phase 3 Acceptance Scenario A — Horizon Logistics", () => {
  const result = analyzeContractBalanceWorkflow(horizonDraft());
  const rows = () => result.analysis!.monthly!;

  it("finalizes and reconciles", () => {
    expect(result.finalized).toBe(true);
    expect(formatCents(result.analysis!.reconciliation.totalConsiderationEventsCents)).toBe("$153,000.00");
    expect(formatCents(result.analysis!.reconciliation.totalRevenueCents!)).toBe("$153,000.00");
    expect(result.analysis!.reconciliation.reconciled).toBe(true);
  });

  it("produces the expected monthly balances", () => {
    const expected: [string, string, string, string, string, string][] = [
      ["2027-07", "$22,295.08", "$0.00", "$0.00", "$0.00", "$52,704.92"],
      ["2027-08", "$12,095.09", "$0.00", "$0.00", "$0.00", "$40,609.83"],
      ["2027-09", "$11,704.91", "$0.00", "$0.00", "$0.00", "$28,904.92"],
      ["2027-10", "$12,095.09", "$0.00", "$0.00", "$0.00", "$16,809.83"],
      ["2027-11", "$11,704.91", "$0.00", "$0.00", "$0.00", "$5,104.92"],
      ["2027-12", "$12,095.09", "$0.00", "$0.00", "$6,990.17", "$0.00"],
      ["2028-01", "$12,095.08", "$39,000.00", "$0.00", "$0.00", "$19,914.75"],
      ["2028-02", "$11,314.75", "$39,000.00", "$0.00", "$0.00", "$8,600.00"],
      ["2028-03", "$12,095.08", "$0.00", "$0.00", "$3,495.08", "$0.00"],
      ["2028-04", "$11,704.92", "$0.00", "$0.00", "$0.00", "$23,800.00"],
      ["2028-05", "$12,095.08", "$0.00", "$0.00", "$0.00", "$11,704.92"],
      ["2028-06", "$11,704.92", "$0.00", "$0.00", "$0.00", "$0.00"],
    ];
    const actual = rows().map((r) => [
      r.month,
      formatCents(r.revenueCents),
      formatCents(r.billedArCents),
      formatCents(r.unbilledArCents),
      formatCents(r.contractAssetCents),
      formatCents(r.contractLiabilityCents),
    ]);
    expect(actual).toEqual(expected);
  });
});

describe("Phase 3 Acceptance Scenario B — Stellar", () => {
  const result = analyzeContractBalanceWorkflow(stellarDraft());
  const rows = () => result.analysis!.monthly!;

  it("finalizes and reconciles", () => {
    expect(result.finalized).toBe(true);
    expect(formatCents(result.analysis!.reconciliation.totalRevenueCents!)).toBe("$240,000.00");
    expect(formatCents(result.analysis!.reconciliation.totalConsiderationEventsCents)).toBe("$240,000.00");
    expect(result.analysis!.reconciliation.reconciled).toBe(true);
  });

  it("produces the expected monthly balances including January 2028", () => {
    const expected: [string, string, string, string, string, string][] = [
      ["2027-01", "$20,383.56", "$0.00", "$0.00", "$20,383.56", "$0.00"],
      ["2027-02", "$18,410.96", "$0.00", "$0.00", "$38,794.52", "$0.00"],
      ["2027-03", "$20,383.56", "$0.00", "$60,000.00", "$0.00", "$821.92"],
      ["2027-04", "$19,726.03", "$0.00", "$0.00", "$18,904.11", "$0.00"],
      ["2027-05", "$20,383.56", "$0.00", "$0.00", "$39,287.67", "$0.00"],
      ["2027-06", "$19,726.03", "$0.00", "$60,000.00", "$0.00", "$986.30"],
      ["2027-07", "$20,383.56", "$0.00", "$0.00", "$19,397.26", "$0.00"],
      ["2027-08", "$20,383.56", "$0.00", "$0.00", "$39,780.82", "$0.00"],
      ["2027-09", "$19,726.03", "$0.00", "$60,000.00", "$0.00", "$493.15"],
      ["2027-10", "$20,383.56", "$0.00", "$0.00", "$19,890.41", "$0.00"],
      ["2027-11", "$19,726.03", "$0.00", "$0.00", "$39,616.44", "$0.00"],
      ["2027-12", "$20,383.56", "$0.00", "$60,000.00", "$0.00", "$0.00"],
      ["2028-01", "$0.00", "$0.00", "$0.00", "$0.00", "$0.00"],
    ];
    const actual = rows().map((r) => [
      r.month,
      formatCents(r.revenueCents),
      formatCents(r.billedArCents),
      formatCents(r.unbilledArCents),
      formatCents(r.contractAssetCents),
      formatCents(r.contractLiabilityCents),
    ]);
    expect(actual).toEqual(expected);
  });

  it("keeps rights, invoicing and cash as three distinct monthly flows", () => {
    const mar = rowFor(rows(), "2027-03") as never as {
      unconditionalRightsCents: number;
      invoicesIssuedCents: number;
      cashCollectedCents: number;
    };
    expect(mar.unconditionalRightsCents).toBe(6_000_000);
    expect(mar.invoicesIssuedCents).toBe(0);
    expect(mar.cashCollectedCents).toBe(0);

    const apr = rowFor(rows(), "2027-04") as never as {
      unconditionalRightsCents: number;
      invoicesIssuedCents: number;
      cashCollectedCents: number;
    };
    expect(apr.unconditionalRightsCents).toBe(0);
    expect(apr.invoicesIssuedCents).toBe(6_000_000);
    expect(apr.cashCollectedCents).toBe(6_000_000);
  });

  it("keeps the same three distinct flows at every quarter transition", () => {
    const flows = (month: string) => {
      const r = rowFor(rows(), month) as never as {
        revenueCents: number;
        unconditionalRightsCents: number;
        invoicesIssuedCents: number;
        cashCollectedCents: number;
        billedArCents: number;
        unbilledArCents: number;
      };
      return r;
    };

    for (const rightsMonth of ["2027-06", "2027-09"]) {
      const r = flows(rightsMonth);
      expect(r.unconditionalRightsCents).toBe(6_000_000);
      expect(r.invoicesIssuedCents).toBe(0);
      expect(r.cashCollectedCents).toBe(0);
    }
    for (const billingMonth of ["2027-07", "2027-10"]) {
      const b = flows(billingMonth);
      expect(b.unconditionalRightsCents).toBe(0);
      expect(b.invoicesIssuedCents).toBe(6_000_000);
      expect(b.cashCollectedCents).toBe(6_000_000);
    }

    const dec = flows("2027-12");
    expect(dec.unconditionalRightsCents).toBe(6_000_000);
    expect(dec.invoicesIssuedCents).toBe(0);
    expect(dec.cashCollectedCents).toBe(0);
    expect(dec.unbilledArCents).toBe(6_000_000);

    const jan = flows("2028-01");
    expect(jan.revenueCents).toBe(0);
    expect(jan.unconditionalRightsCents).toBe(0);
    expect(jan.invoicesIssuedCents).toBe(6_000_000);
    expect(jan.cashCollectedCents).toBe(6_000_000);
    expect(jan.billedArCents).toBe(0);
    expect(jan.unbilledArCents).toBe(0);
  });

  it("returns an event-level billing schedule with no outstanding balance", () => {
    const schedule = result.analysis!.billingSchedule!;
    expect(schedule).toHaveLength(4);
    expect(schedule.every((row) => row.outstandingCents === 0)).toBe(true);
    expect(schedule[0]!.cashCollectedCents).toBe(6_000_000);
  });
});

describe("Phase 2 regression", () => {
  it("keeps Redwood Retail and Apex Manufacturing unchanged", () => {
    const a = analyzeWorkflow(scenarioADraft());
    expect(a.analysis!.revenueSchedule!.byMonth[0]!.totalCents).toBe(1_019_178);
    expect(a.analysis!.totals.revenueCents).toBe(12_000_000);
    expect(a.analysis!.reconciliation.reconciled).toBe(true);

    const b = analyzeWorkflow(scenarioBDraft());
    expect(b.analysis!.revenueSchedule!.byMonth[0]!.totalCents).toBe(2_717_260);
    expect(b.analysis!.totals.revenueCents).toBe(12_600_000);
    expect(b.analysis!.reconciliation.reconciled).toBe(true);
  });
});

describe("Phase 4B workflow bridge — engineInput exposure", () => {
  it("exposes the exact normalized engine input for a finalized workpaper", () => {
    const draft = horizonDraft();
    const result = analyzeContractBalanceWorkflow(draft);
    const revenue = analyzeWorkflow(draft);
    expect(result.finalized).toBe(true);
    expect(result.engineInput).not.toBeNull();
    const input = result.engineInput!;
    expect(input.transactionPriceCents).toBe(revenue.analysis!.totals.transactionPriceCents);
    expect(input.revenueSchedule).toEqual(revenue.analysis!.revenueSchedule);
    expect(input.considerationEvents.map((e) => [e.id, e.amountCents])).toEqual(
      draft.contractBalances.considerationEvents.map((e) => [
        e.id,
        parseUsdToCents(e.amountInput).ok ? (parseUsdToCents(e.amountInput) as { cents: number }).cents : Number.NaN,
      ]),
    );
    expect(input.cashCollections.map((c) => [c.id, c.considerationEventId])).toEqual(
      draft.contractBalances.cashCollections.map((c) => [c.id, c.considerationEventId ?? ""]),
    );
  });

  it("returns a null engine input for a blocked workpaper", () => {
    const draft = horizonDraft();
    draft.contractBalances = { considerationEvents: [], cashCollections: [] };
    const result = analyzeContractBalanceWorkflow(draft);
    expect(result.finalized).toBe(false);
    expect(result.engineInput).toBeNull();
  });
});
