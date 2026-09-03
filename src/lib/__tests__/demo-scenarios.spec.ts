import { describe, expect, it } from "vitest";

import {
  createDemoDraft,
  createDemoDraftIfKnown,
  isDemoScenarioId,
  DEMO_SCENARIOS,
} from "@/lib/demo-scenarios";
import { analyzeContractBalanceWorkflow, analyzeWorkflow } from "@/lib/asc606-workflow";
import { analyzeJournalEntries } from "@/lib/asc606-journals";

function month(analysis: ReturnType<typeof analyzeWorkflow>, key: string) {
  const row = analysis.analysis?.revenueSchedule?.byMonth.find((r) => r.month === key);
  if (!row) throw new Error(`missing month ${key}`);
  return row;
}

function balanceMonth(result: ReturnType<typeof analyzeContractBalanceWorkflow>, key: string) {
  const row = result.analysis?.monthly?.find((r) => r.month === key);
  if (!row) throw new Error(`missing balance month ${key}`);
  return row;
}

describe("demo scenarios", () => {
  it("exposes exactly the four approved samples", () => {
    expect(DEMO_SCENARIOS.map((s) => s.id)).toEqual(["redwood", "apex", "horizon", "stellar"]);
  });

  it("rejects unknown scenario ids without loading another sample", () => {
    expect(isDemoScenarioId("nope")).toBe(false);
    expect(createDemoDraftIfKnown("nope")).toBeNull();
    expect(createDemoDraftIfKnown(undefined)).toBeNull();
    expect(() => createDemoDraft("nope" as never)).toThrow();
  });

  it("returns fresh independent drafts", () => {
    const a = createDemoDraft("stellar");
    const b = createDemoDraft("stellar");
    expect(a).not.toBe(b);
    expect(a.performanceObligations[0]).not.toBe(b.performanceObligations[0]);
    a.performanceObligations[0]!.sspInput = "1.00";
    a.contractBalances.considerationEvents[0]!.amountInput = "1.00";
    expect(b.performanceObligations[0]!.sspInput).toBe("240,000.00");
    expect(b.contractBalances.considerationEvents[0]!.amountInput).toBe("60,000.00");
  });

  it("Redwood: single SaaS obligation, $120,000", () => {
    const result = analyzeWorkflow(createDemoDraft("redwood"));
    expect(result.finalized).toBe(true);
    expect(result.analysis!.allocation!.map((r) => r.allocatedCents)).toEqual([12_000_000]);
    expect(month(result, "2027-01").totalCents).toBe(1_019_178);
    expect(result.analysis!.revenueSchedule!.totalCents).toBe(12_000_000);
  });

  it("Apex: SaaS + training relative SSP allocation", () => {
    const result = analyzeWorkflow(createDemoDraft("apex"));
    expect(result.finalized).toBe(true);
    const allocation = result.analysis!.allocation!;
    expect(allocation.find((r) => r.poId === "po-saas")!.allocatedCents).toBe(10_800_000);
    expect(allocation.find((r) => r.poId === "po-training")!.allocatedCents).toBe(1_800_000);
    const jan = month(result, "2027-01");
    expect(jan.perPo["po-saas"]).toBe(917_260);
    expect(jan.perPo["po-training"]).toBe(1_800_000);
    expect(jan.totalCents).toBe(2_717_260);
    expect(result.analysis!.revenueSchedule!.totalCents).toBe(12_600_000);
  });

  it("Horizon: advance billing, contract asset and liability", () => {
    const draft = createDemoDraft("horizon");
    const revenue = analyzeWorkflow(draft);
    expect(revenue.finalized).toBe(true);
    expect(revenue.analysis!.revenueSchedule!.totalCents).toBe(15_300_000);

    const balances = analyzeContractBalanceWorkflow(draft);
    expect(balances.finalized).toBe(true);
    expect(balanceMonth(balances, "2027-12").contractAssetCents).toBe(699_017);
    expect(balanceMonth(balances, "2028-01").billedArCents).toBe(3_900_000);
    expect(balanceMonth(balances, "2028-01").contractLiabilityCents).toBe(1_991_475);
    expect(balanceMonth(balances, "2028-03").contractAssetCents).toBe(349_508);
    expect(balanceMonth(balances, "2028-06").contractAssetCents).toBe(0);
    expect(balanceMonth(balances, "2028-06").contractLiabilityCents).toBe(0);

    const journals = analyzeJournalEntries(balances.engineInput!);
    expect(journals.reconciliation.reconciled).toBe(true);
  });

  it("Stellar: arrears billing and unbilled AR", () => {
    const draft = createDemoDraft("stellar");
    const revenue = analyzeWorkflow(draft);
    expect(revenue.finalized).toBe(true);
    expect(revenue.analysis!.revenueSchedule!.totalCents).toBe(24_000_000);

    const balances = analyzeContractBalanceWorkflow(draft);
    expect(balances.finalized).toBe(true);
    expect(balanceMonth(balances, "2027-03").unbilledArCents).toBe(6_000_000);
    expect(balanceMonth(balances, "2027-06").unbilledArCents).toBe(6_000_000);
    expect(balanceMonth(balances, "2027-09").unbilledArCents).toBe(6_000_000);
    expect(balanceMonth(balances, "2027-12").unbilledArCents).toBe(6_000_000);
    expect(balanceMonth(balances, "2028-01").totalArCents).toBe(0);

    const journals = analyzeJournalEntries(balances.engineInput!);
    expect(journals.reconciliation.reconciled).toBe(true);
  });
});
