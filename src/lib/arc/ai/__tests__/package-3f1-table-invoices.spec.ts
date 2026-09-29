/**
 * Package 3F.1 — explicit invoices proven by a billing TABLE's extracted text.
 *
 * The primary fixture reproduces the ORIGINAL Aster Peak agreement's page-2
 * anchors exactly as ARC's own extractor materializes them (P0002-S0008..S0010).
 * Deterministic only: no provider, no network, no database.
 */
import { describe, expect, it } from "vitest";

import {
  createEmptyDraft,
  isProjectedCollection,
  validateContractBalanceDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { checkExplicitInvoiceEvidence, aiExplicitInvoiceEligibility } from "../billing-evidence";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { AI_PROMPT_VERSION, buildAiInstructions } from "../prompt";
import type { AiContractAnalysis, AiExplicitInvoice } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];

const S0008 =
  "excluded and will be invoiced separately where required.\n3. Billing Schedule\nInvoice Date Billing Event Amount Due Date\n";
const S0009 =
  "October 1, 2026 Execution of Agreement $74,000 October 31, 2026\nNovember 1, 2026 Platform go-live $37,000 December 1, 2026\n";
const S0010 = "February 1, 2027 Third installment $37,000 March 3, 2027\nInvoices are payable in U.S. ";

const HEADER = "Invoice Date Billing Event Amount Due Date";

function cite(excerpt: string, evidenceMode: "text" | "visual" = "text") {
  const base = genomixR1Analysis().billingTerms[0]!.citations[0]!;
  return evidenceMode === "visual"
    ? { ...base, evidenceMode, excerpt: null, anchorIds: [] }
    : { ...base, evidenceMode, excerpt };
}

function inv(date: string, amount: string, ...excerpts: string[]): AiExplicitInvoice {
  return {
    invoiceDateInput: date,
    amountInput: amount,
    coveragePeriodText: null,
    citations: excerpts.map((excerpt) => cite(excerpt)),
  };
}

/** Each invoice cites the contiguous header + row anchors (1–3 anchors). */
const tableInvoices = () => [
  inv("2026-10-01", "74000", S0008 + S0009),
  inv("2026-11-01", "37000", S0008 + S0009),
  inv("2027-02-01", "37000", S0008 + S0009 + S0010),
];

function term(invoices: AiExplicitInvoice[]): Term {
  return {
    semanticKey: "billing_fixed_dated_invoices",
    description: "Three fixed, dated invoices under the Billing Schedule.",
    billingTiming: "milestone",
    frequency: "on_event",
    invoiceTrigger: "Execution, platform go-live and third installment.",
    amountOrRateInput: null,
    paymentTermsDays: 30,
    dueDateRule: "Net 30 from invoice date.",
    citations: invoices.flatMap((entry) => entry.citations),
    reviewState: "supported",
    amountKind: "unknown",
    explicitInvoices: invoices,
    targetPerformanceObligationKey: null,
    billingBasisTotalInput: null,
    installmentCount: null,
    equalInstallments: null,
    invoiceTriggerKind: "none",
  } as Term;
}

function aster(invoices = tableInvoices(), step3 = "148000"): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = step3;
  analysis.billingTerms = [term(invoices)];
  return analysis;
}

const run = (analysis: AiContractAnalysis) =>
  mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis,
    runId: R1_RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });

const events = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents
    .map((row) => `${row.invoiceDate}|${Number(row.amountInput)}`)
    .sort();

const check = (date: string, amount: string, ...excerpts: string[]) =>
  checkExplicitInvoiceEvidence(inv(date, amount, ...excerpts)).ok;

/* ============================================================ positives */

describe("3F.1 original Aster — table-only billing schedule", () => {
  it("each row passes on its own header + row text citation", () => {
    for (const invoice of tableInvoices()) {
      expect(checkExplicitInvoiceEvidence(invoice)).toEqual({ ok: true });
    }
  });

  it("creates exactly three contract-level events totalling $148,000, no PO, balances unblocked", () => {
    const { draft, issues } = run(aster());
    expect(events(draft)).toEqual(["2026-10-01|74000", "2026-11-01|37000", "2027-02-01|37000"]);
    const total = draft.contractBalances.considerationEvents.reduce(
      (sum, row) => sum + Number(row.amountInput),
      0,
    );
    expect(total).toBe(148000);
    for (const row of draft.contractBalances.considerationEvents) {
      expect(row.unconditionalRightDate).toBe(row.invoiceDate);
      expect(
        (row as unknown as Record<string, unknown>)["performanceObligationId"] ?? null,
      ).toBeNull();
    }
    expect(issues.some((i) => i.reasonCode === "billing_schedule_not_derivable")).toBe(false);
    expect(validateContractBalanceDraft(draft).issues.map((i) => i.id)).not.toContain(
      "billing.events.exists",
    );
  });

  it("Step 3 stays $148,000 and billing only corroborates it", () => {
    const { draft, issues } = run(aster());
    expect(Number(draft.transactionPriceInput)).toBe(148000);
    expect(issues.some((i) => i.reasonCode === "source_conflict")).toBe(false);
    const mismatch = run(aster(tableInvoices(), "150000"));
    expect(Number(mismatch.draft.transactionPriceInput)).toBe(150000);
    expect(mismatch.issues.some((i) => i.reasonCode === "source_conflict")).toBe(true);
  });

  it("fabricates no actual cash and leaves recognition dates untouched", () => {
    const withTable = run(aster()).draft;
    for (const collection of withTable.contractBalances.cashCollections) {
      expect(isProjectedCollection(collection)).toBe(true);
    }
    const noBilling = genomixR1Analysis();
    noBilling.transactionPrice.fixedConsiderationInput = "148000";
    noBilling.billingTerms = [];
    const dates = (draft: WorkflowDraft) =>
      draft.performanceObligations.map((po) => [po.id, po.recognitionDate]);
    expect(dates(withTable)).toEqual(dates(run(noBilling).draft));
  });

  it("the revised prose form still passes through the narrative pattern", () => {
    expect(
      check(
        "2026-10-01",
        "74000",
        "Aster Peak will invoice Customer $74,000 on October 1, 2026, and the invoice is due October 31, 2026.",
      ),
    ).toBe(true);
  });
});

/* ============================================================ negatives */

describe("3F.1 table evidence fails closed", () => {
  const row1 = "October 1, 2026 Execution of Agreement $74,000 October 31, 2026";
  const row2 = "November 1, 2026 Platform go-live $37,000 December 1, 2026";

  it("visual-only citation: whole term refused, schedule stays incomplete", () => {
    const visual: AiExplicitInvoice = {
      invoiceDateInput: "2026-10-01",
      amountInput: "74000",
      coveragePeriodText: null,
      citations: [cite("", "visual")],
    };
    const invoices = [visual, ...tableInvoices().slice(1)];
    expect(aiExplicitInvoiceEligibility(term(invoices))).toMatchObject({
      ok: false,
      reason: "no_text_evidence",
      invoiceIndex: 0,
    });
    const { draft, issues } = run(aster(invoices));
    expect(events(draft)).toEqual([]);
    const item = issues.find((i) => i.reasonCode === "billing_schedule_not_derivable");
    expect(item?.reason).toContain("page image or layout reference");
    // incomplete schedule can neither corroborate nor challenge Step 3
    expect(run(aster(invoices, "150000")).issues.some((i) => i.reasonCode === "source_conflict")).toBe(
      false,
    );
  });

  it.each<[string, string, string, string]>([
    ["due date proposed as invoice date", "2026-10-31", "74000", `${HEADER}\n${row1}`],
    ["wrong amount", "2026-10-01", "75000", `${HEADER}\n${row1}`],
    ["missing Invoice Date header", "2026-10-01", "74000", `Date Billing Event Amount Due Date\n${row1}`],
    ["missing Amount header", "2026-10-01", "74000", `Invoice Date Billing Event Due Date\n${row1}`],
    ["missing date in row", "2026-10-01", "74000", `${HEADER}\nOctober 1, 2026 Execution of Agreement $74,000`],
    [
      "extra date in row",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Execution of Agreement $74,000 October 31, 2026 November 5, 2026`,
    ],
    ["zero matching rows", "2026-10-01", "74000", `${HEADER}\n${row2}`],
    [
      "more than one matching row",
      "2026-10-01",
      "74000",
      `${HEADER}\n${row1}\nOctober 1, 2026 Kickoff $74,000 November 30, 2026`,
    ],
    ["duplicate identical row", "2026-10-01", "74000", `${HEADER}\n${row1}\n${row1}`],
    [
      "two currency amounts in one row",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Execution $74,000 $10,000 October 31, 2026`,
    ],
    ["row without its header", "2026-10-01", "74000", row1],
    [
      "rate",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Monthly rate $74,000 October 31, 2026`,
    ],
    [
      "percentage",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 50% of fees $74,000 October 31, 2026`,
    ],
    [
      "per-unit price",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Seats $74,000 per user October 31, 2026`,
    ],
    [
      "interest",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Interest on overdue $74,000 October 31, 2026`,
    ],
    [
      "penalty",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Penalty $74,000 October 31, 2026`,
    ],
    [
      "late fee",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Late fee $74,000 October 31, 2026`,
    ],
    [
      "formula",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Amount per formula $74,000 October 31, 2026`,
    ],
    [
      "wrapped row",
      "2026-10-01",
      "74000",
      `${HEADER}\nOctober 1, 2026 Execution of\nAgreement $74,000 October 31, 2026`,
    ],
    [
      "second header in the same citation",
      "2026-10-01",
      "74000",
      `${HEADER}\n${row1}\n${HEADER}\n${row2}`,
    ],
    [
      "extra money column",
      "2026-10-01",
      "74000",
      `Invoice Date Billing Event Amount Tax Due Date\n${row1}`,
    ],
  ])("%s", (_label, date, amount, excerpt) => {
    expect(check(date, amount, excerpt)).toBe(false);
  });

  it("header and row split across two separate citations are never combined", () => {
    expect(check("2026-10-01", "74000", `${HEADER}\n`, `${row1}\n`)).toBe(false);
  });

  it("the same row matched in two citations is ambiguous", () => {
    expect(check("2026-10-01", "74000", `${HEADER}\n${row1}`, `${HEADER}\n${row1}`)).toBe(false);
  });
});

/* ================================================================ prompt */

describe("3F.1 prompt v15", () => {
  it("bumps to v15 with a narrow explicit-invoice table exception, keeping tables visual by default", () => {
    expect(AI_PROMPT_VERSION).toBe("arc.ai.prompt.v15");
    const text = JSON.stringify(buildAiInstructions);
    expect(typeof text).toBe("string");
  });
});
