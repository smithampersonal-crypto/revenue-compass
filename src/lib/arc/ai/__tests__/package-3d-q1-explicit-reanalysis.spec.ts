/**
 * Package 3D-Q.1 — Safe Re-analysis of an incumbent explicit invoice schedule.
 *
 * Deterministic only: synthetic data, no provider, no network, no database.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import { assessSafeReanalysis, explicitScheduleSignature } from "../safe-reanalysis";
import type { AiContractAnalysis, AiExplicitInvoice } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];
const FINGERPRINT = "sha256:redwood-fixture";
const NEXT_RUN = "run-00000000-0000-4000-8000-00000000q1r2";

function cite(excerpt: string) {
  const base = genomixR1Analysis().billingTerms[0]!.citations[0]!;
  return { ...base, evidenceMode: "text" as const, excerpt };
}

const LONG: Record<string, string> = {
  "01": "January",
  "04": "April",
  "07": "July",
  "10": "October",
};

function inv(date: string, amount: string, suffix = ""): AiExplicitInvoice {
  const [year, month, day] = date.split("-");
  const text = `Redwood will invoice $${Number(amount).toLocaleString("en-US")} on ${LONG[month!]} ${Number(day)}, ${year} for hosted subscription services${suffix}.`;
  return {
    invoiceDateInput: date,
    amountInput: amount,
    coveragePeriodText: null,
    citations: [cite(text)],
  };
}

function analysisWith(invoices: AiExplicitInvoice[]): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = "60000";
  analysis.billingTerms = [
    {
      semanticKey: "billing:subscription",
      description: "Hosted subscription invoices.",
      billingTiming: "advance",
      frequency: "one_time",
      invoiceTrigger: "Stated invoice dates.",
      amountOrRateInput: null,
      paymentTermsDays: 30,
      dueDateRule: "Net 30 from invoice date.",
      citations: invoices.flatMap((entry) => entry.citations),
      reviewState: "supported",
      amountKind: "fixed_invoice_amount",
      explicitInvoices: invoices,
    } as Term,
  ];
  return analysis;
}

const baseline = () => analysisWith([inv("2027-01-01", "30000"), inv("2027-04-01", "30000")]);

function applied(): { draft: WorkflowDraft; aiState: AiAnalysisState } {
  const merged = mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis: baseline(),
    runId: R1_RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
  return {
    draft: merged.draft,
    aiState: {
      ...merged.aiState,
      lastSuccessfulRunId: R1_RUN_ID,
      sourceSetFingerprint: FINGERPRINT,
    },
  };
}

const events = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents
    .map((row) => `${row.invoiceDate}|${Number(row.amountInput)}`)
    .sort();

function assess(next: AiContractAnalysis) {
  const { draft, aiState } = applied();
  const before = JSON.stringify({ draft, aiState });
  const decision = assessSafeReanalysis({
    analysis: next,
    priorAnalysis: baseline(),
    priorAnalysisLoad: "loaded",
    currentDraft: draft,
    currentAiState: aiState,
    currentSourceSetFingerprint: FINGERPRINT,
  });
  // The firewall is pure: the incumbent rows are exactly as they were.
  expect(JSON.stringify({ draft, aiState })).toBe(before);
  console.log("DECISION", JSON.stringify(decision), events(draft));
  return { decision, draft, aiState };
}

describe("explicit schedule signature", () => {
  it("uses only date and exact amount, never prose", () => {
    expect(explicitScheduleSignature([inv("2027-01-01", "30000")])).toBe(
      explicitScheduleSignature([inv("2027-01-01", "30000.00", " (restated)")]),
    );
    expect(explicitScheduleSignature([])).toBeNull();
    expect(explicitScheduleSignature(undefined)).toBeNull();
  });
});

describe("Safe Re-analysis — incumbent explicit schedule", () => {
  it("A. applies an identical schedule without duplicates", () => {
    const { decision, draft, aiState } = assess(baseline());
    expect(decision.outcome).toBe("apply");
    const again = mergeAiAnalysis({
      currentDraft: draft,
      currentAiState: aiState,
      analysis: baseline(),
      runId: NEXT_RUN,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    expect(events(again.draft)).toEqual(["2027-01-01|30000", "2027-04-01|30000"]);
  });

  it("B. declines a changed invoice date and leaves incumbent rows unchanged", () => {
    const { decision, draft } = assess(
      analysisWith([inv("2027-01-15", "30000"), inv("2027-04-15", "30000")]),
    );
    expect(decision).toMatchObject({ outcome: "decline", objectKind: "billing_term" });
    expect(events(draft)).toEqual(["2027-01-01|30000", "2027-04-01|30000"]);
    expect(events(draft).some((entry) => entry.startsWith("2027-01-15"))).toBe(false);
  });

  it("C. declines a changed invoice amount", () => {
    const { decision, draft } = assess(
      analysisWith([inv("2027-01-01", "30000"), inv("2027-04-01", "31000")]),
    );
    expect(decision.outcome).toBe("decline");
    expect(events(draft)).toEqual(["2027-01-01|30000", "2027-04-01|30000"]);
  });

  it("D. declines an added invoice", () => {
    const { decision } = assess(
      analysisWith([
        inv("2027-01-01", "30000"),
        inv("2027-04-01", "30000"),
        inv("2027-07-01", "30000"),
      ]),
    );
    expect(decision.outcome).toBe("decline");
  });

  it("E. declines a removed invoice", () => {
    const { decision } = assess(analysisWith([inv("2027-01-01", "30000")]));
    expect(decision.outcome).toBe("decline");
  });

  it("F. permits citation, prose and coverage-text changes on an identical schedule", () => {
    const changed = [
      inv("2027-01-01", "30000", ", first quarter"),
      inv("2027-04-01", "30000", ", second quarter"),
    ];
    changed[0]!.coveragePeriodText = "January 1 – March 31, 2027";
    const { decision } = assess(analysisWith(changed));
    expect(decision.outcome).toBe("apply");
  });
});
