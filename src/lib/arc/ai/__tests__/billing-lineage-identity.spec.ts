/**
 * Phase 9G-R3 / Phase L — billing-schedule lineage identity.
 *
 * A model billing-term semantic key is an ephemeral alias. Before this patch a
 * rename produced a whole duplicate billing schedule: four consideration
 * events and four projected collections for a two-invoice contract.
 *
 * Everything below runs through the real merge. No model, no network, no
 * database. All data is hand-authored and fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  createEmptyAiAnalysisState,
  mergeAiAnalysis,
  type AiAnalysisState,
} from "../merge";
import type { AiContractAnalysis } from "../schema";
import { DRIFT_RUN_1, DRIFT_RUN_2, driftRun1Analysis, driftRun2Analysis } from "./drift-fixtures";
import { guidancePackFixture } from "./merge-fixtures";

const DRIFT_RUN_3 = "run-00000000-0000-4000-8000-0000000000a3";

const RUN1_BILLING_KEY = "fixed_annual_advance_billing";
const RUN2_BILLING_KEY = "billing_fixed_annual_advance";
const RUN3_BILLING_KEY = "annual_advance_invoice_schedule";

type BillingTerm = AiContractAnalysis["billingTerms"][number];

function annualAdvanceTerm(semanticKey: string, overrides: Partial<BillingTerm> = {}): BillingTerm {
  return {
    semanticKey,
    description: "Annual advance subscription invoice.",
    billingTiming: "advance",
    frequency: "annual",
    invoiceTrigger: "Start of each annual period.",
    amountOrRateInput: "245000",
    paymentTermsDays: 30,
    dueDateRule: "Net 30 from invoice date.",
    citations: [
      {
        documentId: "doc-r1-fixture-1",
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text" as const,
        excerpt: "Net 30",
      },
    ],
    reviewState: "supported",
    ...overrides,
  };
}

function withBilling(
  analysis: AiContractAnalysis,
  billingTerms: readonly BillingTerm[],
): AiContractAnalysis {
  analysis.billingTerms = [...billingTerms];
  return analysis;
}

function merge(
  analysis: AiContractAnalysis,
  currentDraft: WorkflowDraft,
  currentAiState: AiAnalysisState,
  runId: string,
  priorAnalysis: AiContractAnalysis | null = null,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
    priorAnalysis,
  });
}

function run1(terms: readonly BillingTerm[] = [annualAdvanceTerm(RUN1_BILLING_KEY)]) {
  return merge(
    withBilling(driftRun1Analysis(), terms),
    createEmptyDraft(),
    createEmptyAiAnalysisState(),
    DRIFT_RUN_1,
  );
}

const eventIds = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents.map((row) => row.id).sort();
const cashIds = (draft: WorkflowDraft) =>
  draft.contractBalances.cashCollections.map((row) => row.id).sort();

/** A sidecar exactly as ARC wrote it BEFORE this patch: no identity at all. */
function legacySidecar(state: AiAnalysisState): AiAnalysisState {
  const objectProvenance = Object.fromEntries(
    Object.entries(state.objectProvenance).map(([key, provenance]) => {
      const { identitySignature: _dropped, previousSemanticKeys: _lineage, ...rest } = provenance;
      return [key, rest];
    }),
  );
  const { tombstoneIdentities: _identities, ...rest } = state;
  return { ...rest, objectProvenance };
}

describe("billing-schedule lineage identity", () => {
  it("run 1 derives exactly two invoices and two projected collections", () => {
    const first = run1();
    expect(first.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(first.draft.contractBalances.cashCollections).toHaveLength(2);
    expect(
      first.draft.contractBalances.considerationEvents.map((row) => row.amountInput),
    ).toEqual(["245000", "245000"]);
  });

  it("a renamed billing term does not duplicate the schedule", () => {
    const first = run1();
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      first.draft,
      first.aiState,
      DRIFT_RUN_2,
    );

    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(second.draft.contractBalances.cashCollections).toHaveLength(2);
    expect(eventIds(second.draft)).toEqual(eventIds(first.draft));
    expect(cashIds(second.draft)).toEqual(cashIds(first.draft));
    // No $980,000 duplicate schedule.
    const total = second.draft.contractBalances.considerationEvents.reduce(
      (sum, row) => sum + Number(row.amountInput),
      0,
    );
    expect(total).toBe(490000);
  });

  it("the previous billing aliases are not reported as omitted objects", () => {
    const first = run1();
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      first.draft,
      first.aiState,
      DRIFT_RUN_2,
    );
    const omitted = second.issues.filter(
      (issue) =>
        issue.reasonCode === "ai_proposal_omitted" &&
        eventIds(first.draft).concat(cashIds(first.draft)).includes(String(issue.value)),
    );
    expect(omitted).toHaveLength(0);
    expect(
      second.issues.some((issue) => issue.reasonCode === "unsafe_semantic_relationship"),
    ).toBe(false);
  });

  it("projected collections stay attached to their canonical invoice", () => {
    const first = run1();
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      first.draft,
      first.aiState,
      DRIFT_RUN_2,
    );
    const events = new Set(eventIds(second.draft));
    for (const cash of second.draft.contractBalances.cashCollections) {
      expect(events.has(cash.considerationEventId)).toBe(true);
      expect(cash.basis).toBe("projected_contract_due_date");
    }
  });

  it("an accountant edit to an invoice survives semantic-key drift", () => {
    const first = run1();
    const editedId = eventIds(first.draft)[0]!;
    const edited: WorkflowDraft = {
      ...first.draft,
      contractBalances: {
        ...first.draft.contractBalances,
        considerationEvents: first.draft.contractBalances.considerationEvents.map((row) =>
          row.id === editedId ? { ...row, amountInput: "250000" } : row,
        ),
      },
    };

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      edited,
      first.aiState,
      DRIFT_RUN_2,
    );
    const survivor = second.draft.contractBalances.considerationEvents.find(
      (row) => row.id === editedId,
    );
    expect(survivor?.amountInput).toBe("250000");
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
  });

  it("a third rename remains stable", () => {
    const first = run1();
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      first.draft,
      first.aiState,
      DRIFT_RUN_2,
    );
    const third = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN3_BILLING_KEY)]),
      second.draft,
      second.aiState,
      DRIFT_RUN_3,
    );
    expect(third.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(eventIds(third.draft)).toEqual(eventIds(first.draft));
    expect(cashIds(third.draft)).toEqual(cashIds(first.draft));
  });

  it("a genuinely new second billing schedule is still created", () => {
    const first = run1();
    const newSchedule = annualAdvanceTerm("implementation_fee_invoice", {
      description: "One-time implementation fee invoice.",
      frequency: "one_time",
      invoiceTrigger: "Contract signature.",
      amountOrRateInput: "50000",
      citations: [
        {
          documentId: "doc-r1-fixture-1",
          pageStart: 7,
          pageEnd: 7,
          evidenceMode: "text" as const,
          excerpt: "implementation fee",
        },
      ],
    });
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY), newSchedule]),
      first.draft,
      first.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(3);
    expect(eventIds(second.draft)).toEqual(expect.arrayContaining(eventIds(first.draft)));
  });

  it("two similar schedules are reconciled separately, never collapsed", () => {
    const a = annualAdvanceTerm("platform_annual_advance");
    const b = annualAdvanceTerm("services_annual_advance", {
      description: "Annual advance managed-services invoice.",
      invoiceTrigger: "Start of each managed-services year.",
      citations: [
        {
          documentId: "doc-r1-fixture-1",
          pageStart: 6,
          pageEnd: 6,
          evidenceMode: "text" as const,
          excerpt: "managed services",
        },
      ],
    });
    const first = run1([a, b]);
    expect(first.draft.contractBalances.considerationEvents).toHaveLength(4);

    const second = merge(
      withBilling(driftRun2Analysis(), [
        { ...a, semanticKey: "billing_platform_advance" },
        { ...b, semanticKey: "billing_services_advance" },
      ]),
      first.draft,
      first.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(4);
    expect(eventIds(second.draft)).toEqual(eventIds(first.draft));
  });

  it("ambiguous schedule identity blocks and creates nothing", () => {
    const first = run1();
    const twin = annualAdvanceTerm("billing_annual_advance_twin");
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY), twin]),
      first.draft,
      first.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(eventIds(second.draft)).toEqual(eventIds(first.draft));
    expect(
      second.issues.filter((issue) => issue.reasonCode === "unsafe_semantic_relationship").length,
    ).toBeGreaterThan(0);
  });

  it("manual billing structure still prevents a synthetic schedule", () => {
    const first = run1();
    const manual: WorkflowDraft = {
      ...createEmptyDraft(),
      contractBalances: {
        ...createEmptyDraft().contractBalances,
        considerationEvents: [
          ...first.draft.contractBalances.considerationEvents.slice(0, 1).map((row) => ({
            ...row,
            id: "manual-invoice-1",
          })),
        ],
      },
    };
    const merged = merge(
      withBilling(driftRun1Analysis(), [annualAdvanceTerm(RUN1_BILLING_KEY)]),
      manual,
      createEmptyAiAnalysisState(),
      DRIFT_RUN_1,
    );
    expect(merged.draft.contractBalances.considerationEvents).toHaveLength(1);
    expect(
      merged.issues.some((issue) => issue.reasonCode === "manual_structure_preserved"),
    ).toBe(true);
  });

  it("a legacy sidecar reconciles from the immutable prior structured result", () => {
    const first = run1();
    const legacy = legacySidecar(first.aiState);
    const prior = withBilling(driftRun1Analysis(), [annualAdvanceTerm(RUN1_BILLING_KEY)]);

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      first.draft,
      legacy,
      DRIFT_RUN_2,
      prior,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(eventIds(second.draft)).toEqual(eventIds(first.draft));
  });

  it("an unidentifiable legacy schedule blocks instead of duplicating", () => {
    const first = run1();
    const legacy = legacySidecar(first.aiState);
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      first.draft,
      legacy,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(eventIds(second.draft)).toEqual(eventIds(first.draft));
    expect(
      second.issues.some((issue) => issue.reasonCode === "unsafe_semantic_relationship"),
    ).toBe(true);
  });
});

describe("full Genomix run 1 → accountant edits → renamed run 2", () => {
  it("preserves structure, billing lineage and accountant-owned facts", () => {
    const first = run1();
    const poId = first.draft.performanceObligations[0]!.id;
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((row) =>
        row.id === poId ? { ...row, sspInput: "450000" } : row,
      ),
      contractBalances: {
        ...first.draft.contractBalances,
        considerationEvents: first.draft.contractBalances.considerationEvents.map((row, index) =>
          index === 0 ? { ...row, invoiceDate: "2026-11-02" } : row,
        ),
      },
    };

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_BILLING_KEY)]),
      edited,
      first.aiState,
      DRIFT_RUN_2,
    );

    expect(second.draft.performanceObligations).toHaveLength(3);
    expect(second.draft.variableConsiderationComponents).toHaveLength(2);
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(second.draft.contractBalances.cashCollections).toHaveLength(2);
    expect(
      second.draft.performanceObligations.find((row) => row.id === poId)?.sspInput,
    ).toBe("450000");
    expect(
      second.draft.contractBalances.considerationEvents.map((row) => row.invoiceDate),
    ).toContain("2026-11-02");
  });
});
