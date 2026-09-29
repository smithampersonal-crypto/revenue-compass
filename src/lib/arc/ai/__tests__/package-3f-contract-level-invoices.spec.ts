/**
 * Package 3F — contract-level explicit invoices.
 *
 * Deterministic only: synthetic data modelled on the Aster Peak agreement's
 * wording, no provider, no network, no database.
 */
import { describe, expect, it } from "vitest";

import {
  createEmptyDraft,
  isProjectedCollection,
  validateContractBalanceDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import {
  aiExplicitInvoiceEligibility,
  isExplicitInvoiceCandidate,
  type AiExplicitInvoiceTerm,
} from "../billing-evidence";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import { assessSafeReanalysis } from "../safe-reanalysis";
import type { AiContractAnalysis, AiExplicitInvoice } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];
const NEXT_RUN = "run-00000000-0000-4000-8000-00000000f3f2";
const FINGERPRINT = "sha256:aster-fixture";

function cite(excerpt: string) {
  const base = genomixR1Analysis().billingTerms[0]!.citations[0]!;
  return { ...base, evidenceMode: "text" as const, excerpt };
}

function inv(date: string, amount: string, excerpt: string): AiExplicitInvoice {
  return { invoiceDateInput: date, amountInput: amount, coveragePeriodText: null, citations: [cite(excerpt)] };
}

const ASTER_1 =
  "February 1, 2027 Third installment $37,000 March 3, 2027 Aster Peak will invoice Customer $74,000 on October 1, 2026, and the invoice is due October 31, 2026.";
const ASTER_2 =
  "Aster Peak will invoice Customer $37,000 on November 1, 2026, and the invoice is due December 1, 2026. Aster Peak will invoice";
const ASTER_3 =
  "Aster Peak will invoice Customer $37,000 on November 1, 2026, and the invoice is due December 1, 2026. Aster Peak will invoice Customer $37,000 on February 1, 2027, and the invoice is due March 3, 2027. These three invoices constitute the complete billing schedule for the fixed consideration under this Agreement.";

const asterInvoices = () => [
  inv("2026-10-01", "74000", ASTER_1),
  inv("2026-11-01", "37000", ASTER_2),
  inv("2027-02-01", "37000", ASTER_3),
];

/** The Aster production term shape: amountKind unknown, no PO, supported. */
function asterTerm(overrides: Partial<Term> = {}, invoices = asterInvoices()): Term {
  return {
    semanticKey: "fixed_consideration_dated_invoices",
    description: "Three expressly dated invoices comprising the complete billing schedule.",
    billingTiming: "milestone",
    frequency: "on_event",
    invoiceTrigger: "Execution, go-live and third installment on the stated dates.",
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
    ...overrides,
  } as Term;
}

function aster(step3 = "148000", terms: Term[] = [asterTerm()]): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = step3;
  analysis.billingTerms = terms;
  return analysis;
}

function run(analysis: AiContractAnalysis, draft?: WorkflowDraft, state?: AiAnalysisState, runId = R1_RUN_ID) {
  return mergeAiAnalysis({
    currentDraft: draft ?? createEmptyDraft(),
    currentAiState: state ?? createEmptyAiAnalysisState(),
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

const events = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents.map((row) => `${row.invoiceDate}|${Number(row.amountInput)}`).sort();

const conflict = (issues: { reasonCode: string; targetKey: string }[]) =>
  issues.some((issue) => issue.reasonCode === "source_conflict" && issue.targetKey.endsWith(":billing-conflict"));

/* ============================================================ eligibility */

describe("3F eligibility — unknown kind with explicit invoices", () => {
  const term = (overrides: Partial<AiExplicitInvoiceTerm> = {}, invoices = asterInvoices()) =>
    ({ amountKind: "unknown", reviewState: "supported", explicitInvoices: invoices, ...overrides }) as AiExplicitInvoiceTerm;

  it("accepts unknown when every invoice is proven by its own sentence", () => {
    const result = aiExplicitInvoiceEligibility(term());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.map((e) => `${e.invoiceDate}|${e.amountInput}`)).toEqual([
        "2026-10-01|74000",
        "2026-11-01|37000",
        "2027-02-01|37000",
      ]);
    }
  });

  it("refuses unknown with zero explicit invoices", () => {
    expect(aiExplicitInvoiceEligibility(term({}, []))).toEqual({ ok: false, reason: "amount_not_fixed_invoice" });
    expect(isExplicitInvoiceCandidate({ amountKind: "unknown", explicitInvoices: [] })).toBe(false);
  });

  it("never treats a missing (legacy) kind as a candidate", () => {
    expect(isExplicitInvoiceCandidate({ amountKind: undefined, explicitInvoices: asterInvoices() })).toBe(false);
    expect(isExplicitInvoiceCandidate({ amountKind: null, explicitInvoices: asterInvoices() })).toBe(false);
  });

  it.each(["pricing_basis_only", "per_unit_rate", "percentage_rate", "formula"])("still refuses %s", (kind) => {
    expect(aiExplicitInvoiceEligibility(term({ amountKind: kind }))).toEqual({ ok: false, reason: "amount_not_fixed_invoice" });
  });

  it.each(["inference", "needs_review", "source_conflict", "needs_user_input"])("refuses review state %s", (reviewState) => {
    expect(aiExplicitInvoiceEligibility(term({ reviewState }))).toEqual({
      ok: false,
      reason: "billing_term_not_source_supported",
    });
  });

  const refusals: [string, AiExplicitInvoice, string][] = [
    ["missing invoicing word", inv("2026-10-01", "74000", "Customer pays $74,000 on October 1, 2026."), "no_invoicing_language"],
    ["missing date", inv("2026-10-01", "74000", "Aster Peak will invoice Customer $74,000 at go-live."), "no_matching_invoice_date"],
    ["invalid date", inv("2026-13-01", "74000", ASTER_1), "invalid_invoice_date"],
    ["mismatched date", inv("2026-10-02", "74000", ASTER_1), "no_matching_invoice_date"],
    ["mismatched amount", inv("2026-10-01", "75000", ASTER_1), "no_currency_amount"],
    ["per-unit rate", inv("2026-10-01", "74", "Aster Peak will invoice $74 per user on October 1, 2026."), "rate_like_amount"],
    ["percentage", inv("2026-10-01", "5", "Aster Peak will invoice 5% on October 1, 2026."), "no_currency_amount"],
    ["interest", inv("2026-10-01", "740", "Aster Peak will invoice interest of $740 on October 1, 2026."), "rate_like_amount"],
    ["late fee", inv("2026-10-01", "50", "Aster Peak will invoice a $50 late fee on October 1, 2026."), "rate_like_amount"],
    ["penalty", inv("2026-10-01", "500", "Aster Peak will invoice a $500 penalty on October 1, 2026."), "rate_like_amount"],
  ];

  it.each(refusals)("one invalid invoice (%s) refuses the whole unknown term", (_label, bad, reason) => {
    const [first, second] = asterInvoices();
    const result = aiExplicitInvoiceEligibility(term({}, [first!, second!, bad]));
    expect(result).toMatchObject({ ok: false, reason, invoiceIndex: 2 });
  });
});

/* ================================================================ Aster */

describe("3F Aster — contract-level explicit invoices", () => {
  it("creates exactly the three contract-level invoices ($148,000), no PO, balances unblocked", () => {
    const { draft, issues } = run(aster());
    expect(events(draft)).toEqual(["2026-10-01|74000", "2026-11-01|37000", "2027-02-01|37000"]);
    const total = draft.contractBalances.considerationEvents.reduce((sum, row) => sum + Number(row.amountInput), 0);
    expect(total).toBe(148000);
    for (const row of draft.contractBalances.considerationEvents) {
      expect(row.unconditionalRightDate).toBe(row.invoiceDate);
      expect((row as unknown as Record<string, unknown>)["performanceObligationId"] ?? null).toBeNull();
    }
    expect(issues.some((i) => i.reasonCode === "billing_schedule_not_derivable")).toBe(false);
    const ids = validateContractBalanceDraft(draft).issues.map((i) => i.id);
    expect(ids).not.toContain("billing.events.exists");
  });

  it("corroborates Step 3 at $148,000 without a conflict", () => {
    const { draft, issues } = run(aster());
    expect(Number(draft.transactionPriceInput)).toBe(148000);
    expect(conflict(issues)).toBe(false);
  });

  it("fabricates no actual cash receipt", () => {
    const { draft } = run(aster());
    for (const collection of draft.contractBalances.cashCollections) {
      expect(isProjectedCollection(collection)).toBe(true);
    }
  });

  it("does not change any recognition date (unresolved implementation date stays unresolved)", () => {
    const withBilling = run(aster()).draft;
    const withoutBilling = run(aster("148000", [])).draft;
    const dates = (draft: WorkflowDraft) => draft.performanceObligations.map((po) => [po.id, po.recognitionDate]);
    expect(dates(withBilling)).toEqual(dates(withoutBilling));
  });

  it("Step 3 $150,000 vs billing $148,000 raises a blocking source_conflict and replaces neither", () => {
    const { draft, issues } = run(aster("150000"));
    expect(draft.transactionPriceInput).toBe("150000");
    expect(conflict(issues)).toBe(true);
    expect(events(draft)).toHaveLength(3);
  });

  it("never overwrites an accountant-entered Step 3", () => {
    const first = run(aster());
    const edited: WorkflowDraft = { ...first.draft, transactionPriceInput: "150000" };
    const state: AiAnalysisState = {
      ...first.aiState,
      fieldProvenance: Object.fromEntries(
        Object.entries(first.aiState.fieldProvenance).map(([key, value]) => [
          key,
          key.startsWith("transactionPrice") ? { ...value, state: "user_edited" as const } : value,
        ]),
      ) as AiAnalysisState["fieldProvenance"],
    };
    const second = run(aster(), edited, state, NEXT_RUN);
    expect(second.draft.transactionPriceInput).toBe("150000");
  });
});

/* ========================================================= completeness */

describe("3F completeness fails closed", () => {
  it("a refused unknown candidate keeps the schedule incomplete: no events, no corroboration or conflict", () => {
    const termA = asterTerm({ semanticKey: "billing:a", amountKind: "fixed_invoice_amount" }, [
      inv("2026-10-01", "74000", ASTER_1),
    ]);
    const termB = asterTerm({ semanticKey: "billing:b" }, [
      inv("2026-11-01", "37000", ASTER_2),
      inv("2027-02-01", "37000", "Customer pays $37,000 on February 1, 2027."),
    ]);
    // Step 3 = A alone: if B vanished, A would "corroborate" it.
    const agrees = run(aster("74000", [termA, termB]));
    expect(events(agrees.draft)).toEqual(["2026-10-01|74000"]);
    expect(agrees.draft.transactionPriceInput).toBe("74000");
    expect(conflict(agrees.issues)).toBe(false);
    expect(
      agrees.issues.some((i) => i.reasonCode === "billing_schedule_not_derivable" && i.targetKey === "billing:billing:b"),
    ).toBe(true);
    // Step 3 = full $148,000: an incomplete total must not challenge it either.
    const full = run(aster("148000", [termA, termB]));
    expect(full.draft.transactionPriceInput).toBe("148000");
    expect(conflict(full.issues)).toBe(false);
  });

  it("a refused unknown term's review item names the real reason", () => {
    const { issues } = run(aster("148000", [asterTerm({ amountKind: "pricing_basis_only" })]));
    const item = issues.find((i) => i.reasonCode === "billing_schedule_not_derivable");
    expect(item?.reason).toContain("not identified as fixed invoice amounts");
    expect(item?.reason).not.toContain("does not state its invoiced amount");
    const unsupported = run(aster("148000", [asterTerm({ reviewState: "inference" })])).issues.find(
      (i) => i.reasonCode === "billing_schedule_not_derivable",
    );
    expect(unsupported?.reason).toContain("not marked as directly supported");
  });
});

/* ======================================================= re-analysis */

describe("3F identity / Safe Re-analysis", () => {
  function applied() {
    const merged = run(aster());
    return {
      draft: merged.draft,
      aiState: { ...merged.aiState, lastSuccessfulRunId: R1_RUN_ID, sourceSetFingerprint: FINGERPRINT },
    };
  }
  function assess(next: AiContractAnalysis) {
    const { draft, aiState } = applied();
    return {
      decision: assessSafeReanalysis({
        analysis: next,
        priorAnalysis: aster(),
        priorAnalysisLoad: "loaded",
        currentDraft: draft,
        currentAiState: aiState,
        currentSourceSetFingerprint: FINGERPRINT,
      }),
      draft,
      aiState,
    };
  }

  it("an unchanged rerun keeps the same IDs and creates no duplicates", () => {
    const { decision, draft, aiState } = assess(aster());
    expect(decision.outcome).toBe("apply");
    const again = run(aster(), draft, aiState, NEXT_RUN);
    expect(again.draft.contractBalances.considerationEvents.map((r) => r.id).sort()).toEqual(
      draft.contractBalances.considerationEvents.map((r) => r.id).sort(),
    );
  });

  it("a changed amount is declined", () => {
    const changed = asterInvoices();
    changed[0] = inv("2026-10-01", "70000", ASTER_1.replace("$74,000", "$70,000"));
    expect(assess(aster("148000", [asterTerm({}, changed)])).decision).toMatchObject({ outcome: "decline" });
  });

  it("a changed date is declined", () => {
    const changed = asterInvoices();
    changed[1] = inv("2026-11-15", "37000", ASTER_2.replace("November 1, 2026", "November 15, 2026"));
    expect(assess(aster("148000", [asterTerm({}, changed)])).decision).toMatchObject({ outcome: "decline" });
  });

  it("explicit → recurring rule on the same stream stays blocked", () => {
    const { draft, aiState } = applied();
    const rule = asterTerm({ amountKind: "fixed_invoice_amount", explicitInvoices: [], frequency: "monthly", billingTiming: "advance", amountOrRateInput: "12000" }, []);
    const next = run(aster("148000", [rule]), draft, aiState, NEXT_RUN);
    expect(events(next.draft)).toEqual(events(draft));
    expect(next.issues.some((i) => i.reasonCode === "unsafe_semantic_relationship")).toBe(true);
  });

  it("a manual billing event is preserved", () => {
    const { draft, aiState } = applied();
    const manual = { ...draft.contractBalances.considerationEvents[0]!, id: "ce-manual-3f", amountInput: "1000", amountSource: "manual" as const };
    const withManual: WorkflowDraft = {
      ...draft,
      contractBalances: { ...draft.contractBalances, considerationEvents: [...draft.contractBalances.considerationEvents, manual] },
    };
    const next = run(aster(), withManual, aiState, NEXT_RUN);
    expect(next.draft.contractBalances.considerationEvents.map((r) => r.id)).toContain("ce-manual-3f");
  });
});
