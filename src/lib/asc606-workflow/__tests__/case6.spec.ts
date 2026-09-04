/**
 * APPROVED CASE 6 acceptance coverage.
 *
 * Annual SaaS 1/1/2027–12/31/2027, SaaS SSP $120,000, activation fee $24,000
 * (no separate service), original fixed transaction price $144,000, plus a
 * customer renewal option: renewal SaaS 1/1/2028–12/31/2028, new consideration
 * $120,000 if exercised, economic benefit $24,000, 80% exercise probability at
 * inception, concluded to convey a material right.
 *
 * All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { analyzeJournalEntries } from "@/lib/asc606-journals";

import { analyzeWorkflow, materialRightStepPreviews } from "../analysis";
import { analyzeContractBalanceWorkflow } from "../contract-balances";
import {
  createEmptyDraft,
  createMaterialRightPoDraft,
  createPoDraft,
  createPromiseDraft,
  type PoDraft,
  type WorkflowDraft,
} from "../types";
import { answerAllStep1 } from "./fixtures";

const SAAS_ALLOCATION = 12_413_793; // $124,137.93
const RIGHT_ALLOCATION = 1_986_207; // $19,862.07
const MR_SSP = 1_920_000; // $19,200.00

function case6Draft(rightOverrides: Partial<PoDraft> = {}): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const saasPo: PoDraft = {
    ...createPoDraft(1, "po-saas"),
    name: "Annual SaaS subscription",
    classification: "single_distinct",
    classificationRationale: "Single distinct hosted service; the activation activity conveys no separate service.",
    sspInput: "120,000.00",
    sspBasis: "Observable standalone renewal pricing.",
    recognitionMethod: "over_time_ratable",
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionRationale: "Customer simultaneously receives and consumes the hosted service.",
  };
  const rightPo: PoDraft = {
    ...createMaterialRightPoDraft(2, "po-option"),
    name: "Customer renewal option",
    underlyingGoodOrServiceName: "Renewal SaaS",
    benefitAmountInput: "24,000.00",
    exerciseProbabilityInput: "80",
    sspBasis: "Incremental discount versus standalone renewal pricing, weighted for exercise.",
    ...rightOverrides,
  };
  const saasPromise = {
    ...createPromiseDraft(1, "pr-saas"),
    description: "Annual hosted SaaS service",
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale: "Benefit available on its own; not significantly integrated.",
    performanceObligationId: saasPo.id,
  };
  const optionPromise = {
    ...createPromiseDraft(2, "pr-option"),
    kind: "customer_option" as const,
    description: "Option to renew for a second year",
    conveysMaterialRight: true,
    materialRightRationale: "The discount is incremental to discounts typically offered.",
    performanceObligationId: rightPo.id,
  };
  return {
    ...base,
    contract: { ...base.contract, customerName: "Redwood Retail", contractNumber: "CASE-6" },
    transactionPriceInput: "144,000.00",
    promises: [saasPromise, optionPromise],
    performanceObligations: [saasPo, rightPo],
  };
}

/** Approved TEST-ONLY billing facts: $144,000 billed and collected. */
function withOriginalBilling(draft: WorkflowDraft): WorkflowDraft {
  return {
    ...draft,
    contractBalances: {
      considerationEvents: [
        {
          id: "ce-1",
          seq: 1,
          amountInput: "144,000.00",
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-01",
        },
      ],
      cashCollections: [
        {
          id: "cash-1",
          seq: 1,
          considerationEventId: "ce-1",
          amountInput: "144,000.00",
          collectionDate: "2027-01-31",
        },
      ],
    },
  };
}

describe("Case 6 — inception measurement and allocation", () => {
  const result = analyzeWorkflow(case6Draft());

  it("measures the material right as benefit × probability", () => {
    expect(result.finalized).toBe(true);
    const right = result.lifecycle!.materialRights[0]!;
    expect(right.estimatedSspCents).toBe(MR_SSP);
  });

  it("allocates the $144,000 original transaction price", () => {
    expect(result.allocation?.map((row) => [row.poId, row.allocatedCents])).toEqual([
      ["po-saas", SAAS_ALLOCATION],
      ["po-option", RIGHT_ALLOCATION],
    ]);
    expect(SAAS_ALLOCATION + RIGHT_ALLOCATION).toBe(14_400_000);
  });
});

describe("Case 6 — outstanding", () => {
  const draft = case6Draft();
  const result = analyzeWorkflow(draft);

  it("schedules only the SaaS revenue and carries the option as unscheduled", () => {
    expect(result.revenueSchedule?.totalCents).toBe(SAAS_ALLOCATION);
    expect(result.unscheduledRevenueCents).toBe(RIGHT_ALLOCATION);
    expect(result.lifecycleConsiderationCents).toBe(14_400_000);
    expect(result.lifecycle?.reconciliation.reconciled).toBe(true);
  });

  it("produces the approved contract-balance and journal results", () => {
    const balances = analyzeContractBalanceWorkflow(withOriginalBilling(draft));
    expect(balances.finalized).toBe(true);
    const monthly = balances.analysis!.monthly!;
    const january = monthly.find((m) => m.month === "2027-01")!;
    const december = monthly.find((m) => m.month === "2027-12")!;
    expect(january.contractLiabilityCents).toBe(13_345_678); // $133,456.78
    expect(december.contractLiabilityCents).toBe(RIGHT_ALLOCATION);
    expect(december.totalArCents).toBe(0);

    const journals = analyzeJournalEntries(balances.engineInput!);
    expect(journals.reconciliation.reconciled).toBe(true);
    const optionRevenue = journals
      .entries!.flatMap((entry) => entry.lines)
      .filter((line) => line.account === "revenue" && line.poId.startsWith("po-option"))
      .reduce((sum, line) => sum + line.creditCents, 0);
    expect(optionRevenue).toBe(0);
  });
});

describe("Case 6 — expired 12/31/2027", () => {
  const draft = case6Draft({ materialRightStatus: "expired", expirationDate: "2027-12-31" });
  const result = analyzeWorkflow(draft);

  it("keeps the original allocation and recognizes the allocated amount on expiration", () => {
    expect(result.allocation?.map((row) => row.allocatedCents)).toEqual([
      SAAS_ALLOCATION,
      RIGHT_ALLOCATION,
    ]);
    const december = result.revenueSchedule!.byMonth.find((m) => m.month === "2027-12")!;
    expect(december.perPo["po-saas"]).toBe(1_054_322); // $10,543.22
    expect(december.perPo["po-option::expiration"]).toBe(RIGHT_ALLOCATION);
    expect(december.totalCents).toBe(3_040_529); // $30,405.29
    expect(result.revenueSchedule?.totalCents).toBe(14_400_000);
    expect(result.unscheduledRevenueCents).toBe(0);
  });

  it("labels the expiration revenue source from the underlying good or service", () => {
    const source = result.revenueSources.find((s) => s.sourceType === "material_right_expiration");
    expect(source?.name).toBe("Renewal SaaS — material-right expiration");
    expect(source?.materialRightPoId).toBe("po-option");
  });

  it("clears the contract liability and reconciles the journals", () => {
    const balances = analyzeContractBalanceWorkflow(withOriginalBilling(draft));
    expect(balances.finalized).toBe(true);
    const last = balances.analysis!.monthly!.at(-1)!;
    expect(last.contractLiabilityCents).toBe(0);
    expect(analyzeJournalEntries(balances.engineInput!).reconciliation.reconciled).toBe(true);
  });
});

describe("Case 6 — exercised 12/15/2027", () => {
  const draft = case6Draft({
    materialRightStatus: "exercised",
    exerciseDate: "2027-12-15",
    exerciseConsiderationInput: "120,000.00",
    recognitionMethod: "over_time_ratable",
    serviceStart: "2028-01-01",
    serviceEnd: "2028-12-31",
    recognitionRationale: "Renewal hosted service consumed as delivered in 2028.",
  });
  const result = analyzeWorkflow(draft);
  const withRenewalBilling: WorkflowDraft = (() => {
    const billed = withOriginalBilling(draft);
    return {
      ...billed,
      contractBalances: {
        considerationEvents: [
          ...billed.contractBalances.considerationEvents,
          {
            id: "ce-2",
            seq: 2,
            amountInput: "120,000.00",
            unconditionalRightDate: "2028-01-01",
            invoiceDate: "2028-01-01",
          },
        ],
        cashCollections: [
          ...billed.contractBalances.cashCollections,
          {
            id: "cash-2",
            seq: 2,
            considerationEventId: "ce-2",
            amountInput: "120,000.00",
            collectionDate: "2028-01-31",
          },
        ],
      },
    };
  })();

  it("carries the locked allocation into the exercise segment", () => {
    const right = result.lifecycle!.materialRights[0]!;
    expect(right.allocatedCents).toBe(RIGHT_ALLOCATION);
    expect(right.exerciseConsiderationCents).toBe(12_000_000);
    expect(right.exerciseRecognitionBasisCents).toBe(13_986_207); // $139,862.07
    expect(right.unscheduledCents).toBe(0);
  });

  it("exposes the same read-only amounts to Step 5", () => {
    const preview = materialRightStepPreviews(draft)[0]!;
    expect(preview.allocatedCents).toBe(RIGHT_ALLOCATION);
    expect(preview.exerciseConsiderationCents).toBe(12_000_000);
    expect(preview.recognitionBasisCents).toBe(13_986_207);
  });

  it("recognizes 2027 and 2028 revenue and reconciles the lifecycle", () => {
    const byYear = (year: string) =>
      result
        .revenueSchedule!.byMonth.filter((m) => m.month.startsWith(year))
        .reduce((sum, m) => sum + m.totalCents, 0);
    expect(byYear("2027")).toBe(SAAS_ALLOCATION);
    expect(byYear("2028")).toBe(13_986_207);
    expect(result.lifecycleConsiderationCents).toBe(26_400_000);
    expect(result.revenueSchedule?.totalCents).toBe(26_400_000);
    expect(result.unscheduledRevenueCents).toBe(0);
  });

  it("produces the approved balances and journals with no exercise-date entry", () => {
    const balances = analyzeContractBalanceWorkflow(withRenewalBilling);
    expect(balances.finalized).toBe(true);
    const monthly = balances.analysis!.monthly!;
    expect(monthly.find((m) => m.month === "2027-12")!.contractLiabilityCents).toBe(
      RIGHT_ALLOCATION,
    );
    const jan28 = monthly.find((m) => m.month === "2028-01")!;
    expect(jan28.contractLiabilityCents).toBe(12_801_583); // $128,015.83
    const dec28 = monthly.find((m) => m.month === "2028-12")!;
    expect(dec28.contractLiabilityCents).toBe(0);
    expect(dec28.totalArCents).toBe(0);

    const journals = analyzeJournalEntries(balances.engineInput!);
    expect(journals.reconciliation.reconciled).toBe(true);
    expect(journals.entries!.some((entry) => entry.date === "2027-12-15")).toBe(false);
  });
});
