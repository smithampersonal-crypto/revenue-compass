/**
 * Package 3D-Q.1 — source-stated dated invoices.
 *
 * Deterministic only: synthetic data, no provider, no network, no database.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { aiExplicitInvoiceEligibility, checkExplicitInvoiceEvidence } from "../billing-evidence";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import {
  AI_OUTPUT_SCHEMA_VERSION,
  LEGACY_V7_AI_OUTPUT_SCHEMA_VERSION,
  parseAiContractAnalysis,
  parsePersistedAiContractAnalysis,
  type AiContractAnalysis,
  type AiExplicitInvoice,
} from "../schema";
import { AI_PROMPT_VERSION } from "../prompt";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];
type Invoice = AiExplicitInvoice;

function textCite(excerpt: string) {
  const base = genomixR1Analysis().billingTerms[0]!.citations[0]!;
  return { ...base, evidenceMode: "text" as const, excerpt };
}

function invoice(date: string, amount: string, excerpt: string): Invoice {
  return {
    invoiceDateInput: date,
    amountInput: amount,
    coveragePeriodText: null,
    citations: [textCite(excerpt)],
  };
}

const Q = [
  ["2027-01-01", "Redwood will invoice $30,000 on January 1, 2027 for the first quarter of hosted subscription services."],
  ["2027-04-01", "Redwood will invoice $30,000 on April 1, 2027 for the second quarter of hosted subscription services."],
  ["2027-07-01", "Redwood will invoice $30,000 on July 1, 2027 for the third quarter of hosted subscription services."],
  ["2027-10-01", "Redwood will invoice $30,000 on October 1, 2027 for the fourth quarter of hosted subscription services."],
] as const;

function explicitTerm(key: string, description: string, invoices: Invoice[]): Term {
  return {
    semanticKey: key,
    description,
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
  } as Term;
}

function redwood(): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = "150000";
  analysis.billingTerms = [
    explicitTerm("billing:implementation", "Implementation fee invoice.", [
      invoice("2027-01-01", "24000", "Redwood will invoice $24,000 on January 1, 2027 for implementation services."),
    ]),
    explicitTerm(
      "billing:subscription",
      "Hosted subscription quarterly invoices.",
      Q.map(([date, text]) => invoice(date, "30000", text)),
    ),
    explicitTerm("billing:training", "Training invoice.", [
      invoice("2027-04-15", "6000", "Redwood will invoice $6,000 on April 15, 2027 for training services."),
    ]),
  ];
  return analysis;
}

function run(analysis: AiContractAnalysis, draft?: WorkflowDraft, state?: AiAnalysisState) {
  return mergeAiAnalysis({
    currentDraft: draft ?? createEmptyDraft(),
    currentAiState: state ?? createEmptyAiAnalysisState(),
    analysis,
    runId: R1_RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

const events = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents
    .map((row) => `${row.invoiceDate}|${Number(row.amountInput)}`)
    .sort();

/* ========================================================== versions */

describe("versions", () => {
  it("pins schema v8 and prompt v12, keeping v7 readable", () => {
    expect(AI_OUTPUT_SCHEMA_VERSION).toBe("arc.ai.schema.v8");
    expect(AI_PROMPT_VERSION).toBe("arc.ai.prompt.v12");
    expect(parseAiContractAnalysis(redwood()).ok).toBe(true);
    const legacy = structuredClone(genomixR1Analysis()) as unknown as Record<string, unknown>;
    legacy["schemaVersion"] = LEGACY_V7_AI_OUTPUT_SCHEMA_VERSION;
    for (const term of legacy["billingTerms"] as Record<string, unknown>[]) {
      delete term["explicitInvoices"];
    }
    const parsed = parsePersistedAiContractAnalysis(legacy, LEGACY_V7_AI_OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.analysis.billingTerms.every((t) => (t.explicitInvoices ?? []).length === 0)).toBe(true);
    }
  });
});

/* ========================================================== evidence */

describe("explicit invoice evidence", () => {
  it("accepts one sentence with invoicing word, exact amount and introduced date", () => {
    expect(checkExplicitInvoiceEvidence(invoice(...[Q[1][0], "30000", Q[1][1]] as const)).ok).toBe(true);
    expect(
      checkExplicitInvoiceEvidence(invoice("2027-04-15", "6000", "Customer will be invoiced $6,000 on Apr. 15, 2027.")).ok,
    ).toBe(true);
  });

  it("never lets one quarter's citation support another quarter", () => {
    const wrong = invoice("2027-07-01", "30000", Q[1][1]);
    expect(checkExplicitInvoiceEvidence(wrong)).toEqual({ ok: false, reason: "no_matching_invoice_date" });
  });

  it("refuses split sentences, wrong amounts, missing invoicing words and impossible dates", () => {
    expect(
      checkExplicitInvoiceEvidence(
        invoice("2027-04-15", "6000", "Redwood will invoice training. The fee is $6,000 on April 15, 2027."),
      ).ok,
    ).toBe(false);
    expect(checkExplicitInvoiceEvidence(invoice("2027-04-15", "6500", "Redwood will invoice $6,000 on April 15, 2027.")).ok).toBe(false);
    expect(checkExplicitInvoiceEvidence(invoice("2027-04-15", "6000", "Training costs $6,000 on April 15, 2027.")).ok).toBe(false);
    expect(checkExplicitInvoiceEvidence(invoice("2027-02-30", "6000", "Redwood will invoice $6,000 on February 30, 2027.")).ok).toBe(false);
    expect(checkExplicitInvoiceEvidence(invoice("2027-04-15", "6000", "Redwood will invoice $6,000 around mid-April 2027.")).ok).toBe(false);
  });

  it("fails the whole term when any one invoice is unsupported", () => {
    const invoices = Q.map(([date, text]) => invoice(date, "30000", text));
    invoices[2] = invoice("2027-07-01", "30000", Q[1][1]);
    const verdict = aiExplicitInvoiceEligibility(explicitTerm("billing:s", "s", invoices));
    expect(verdict).toMatchObject({ ok: false, invoiceIndex: 2 });
  });

  it("collapses an exact duplicate within the same stream", () => {
    const twice = [invoice(Q[0][0], "30000", Q[0][1]), invoice(Q[0][0], "30000", Q[0][1])];
    const verdict = aiExplicitInvoiceEligibility(explicitTerm("billing:s", "s", twice));
    expect(verdict.ok && verdict.events.length).toBe(1);
  });
});

/* ============================================================= merge */

describe("merge — Redwood explicit invoices", () => {
  it("creates all six invoices totalling $150,000 with Net 30 projected collections only", () => {
    const { draft } = run(redwood());
    expect(events(draft)).toEqual([
      "2027-01-01|24000",
      "2027-01-01|30000",
      "2027-04-01|30000",
      "2027-04-15|6000",
      "2027-07-01|30000",
      "2027-10-01|30000",
    ]);
    const total = draft.contractBalances.considerationEvents.reduce((sum, row) => sum + Number(row.amountInput), 0);
    expect(total).toBe(150000);
    expect(draft.transactionPriceInput).toBe("150000");
    for (const cash of draft.contractBalances.cashCollections) {
      expect(cash).not.toHaveProperty("status", "actual");
    }
  });

  it("marks provenance as explicit_invoice_v8", () => {
    const { aiState } = run(redwood());
    const derivations = Object.values(aiState.objectProvenance)
      .map((p) => p.derivation)
      .filter(Boolean);
    expect(derivations).toContain("explicit_invoice_v8");
  });

  it("keeps same date / same amount on different streams", () => {
    const analysis = genomixR1Analysis();
    analysis.billingTerms = [
      explicitTerm("billing:implementation", "Implementation fee.", [
        invoice("2027-01-01", "10000", "Redwood will invoice $10,000 on January 1, 2027 for implementation."),
      ]),
      explicitTerm("billing:training", "Training fee.", [
        invoice("2027-01-01", "10000", "Redwood will invoice $10,000 on January 1, 2027 for training."),
      ]),
    ];
    const { draft, issues } = run(analysis);
    expect(events(draft)).toEqual(["2027-01-01|10000", "2027-01-01|10000"]);
    expect(
      issues.some(
        (i) =>
          (i.targetKey === "billing:billing:implementation" || i.targetKey === "billing:billing:training") &&
          i.reasonCode !== "ai_proposal_omitted",
      ),
    ).toBe(false);
  });

  it("does not let an explicit invoice suppress a rule-derived invoice on another stream", () => {
    const analysis = genomixR1Analysis();
    const annual = analysis.billingTerms.find((t) => t.semanticKey === "billing:annual-advance")!;
    analysis.billingTerms = [
      annual,
      explicitTerm("billing:training", "Training fee.", [
        invoice("2027-04-15", "245000", "Redwood will invoice $245,000 on April 15, 2027 for training."),
      ]),
    ];
    const ruleOnly = run({ ...analysis, billingTerms: [annual] }).draft;
    const { draft } = run(analysis);
    expect(draft.contractBalances.considerationEvents.length).toBe(
      ruleOnly.contractBalances.considerationEvents.length + 1,
    );
  });

  it("creates nothing for a term whose one invoice fails, and blocks", () => {
    const analysis = redwood();
    const sub = analysis.billingTerms[1]!;
    sub.explicitInvoices![3] = invoice("2027-10-01", "30000", Q[2][1]);
    const { draft, issues } = run(analysis);
    expect(events(draft).filter((e) => e.endsWith("|30000"))).toHaveLength(0);
    expect(
      issues.some(
        (i) => i.targetKey === "billing:billing:subscription" && i.reasonCode === "billing_schedule_not_derivable",
      ),
    ).toBe(true);
  });

  it("blocks a rule→explicit mode change on an incumbent schedule and leaves invoices unchanged", () => {
    const first = run(genomixR1Analysis());
    const before = events(first.draft);
    expect(before.length).toBeGreaterThan(0);
    const next = genomixR1Analysis();
    next.billingTerms = next.billingTerms.map((term) =>
      term.semanticKey === "billing:annual-advance"
        ? {
            ...term,
            // The same invoices the rule produced, now stated as dated invoices.
            explicitInvoices: first.draft.contractBalances.considerationEvents.map((row) =>
              invoice(row.invoiceDate, "245000", `Genomix will invoice $245,000 on ${row.invoiceDate}.`),
            ),
          }
        : term,
    );
    const second = run(next, first.draft, first.aiState);
    expect(events(second.draft)).toEqual(before);
    expect(
      second.issues.some(
        (i) => i.targetKey === "billing:billing:annual-advance" && i.reasonCode === "unsafe_semantic_relationship",
      ),
    ).toBe(true);
  });

  it("is idempotent on deliberate re-analysis of the same explicit invoices", () => {
    const first = run(redwood());
    const second = run(redwood(), first.draft, first.aiState);
    expect(events(second.draft)).toEqual(events(first.draft));
  });
});
