/**
 * Phase 9G-R Task R1 — acceptance patch.
 *
 * Deterministic only: synthetic analyses, no provider, no live model, no
 * database. Proves (1) ARC's deterministic full-term fixed consideration is
 * authoritative over model arithmetic, (2) the variable-consideration
 * allocation judgment is one user-ownable group, and (3) the two Phase 9G
 * store calls keep their Supabase client receiver.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  canonicalReviewTargetFingerprint,
  classifyReviewTarget,
  reconcileAiEdits,
} from "../edit-reconciliation";
import { deriveCanonicalId, fieldKeys } from "../identity";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import type { AiContractAnalysis } from "../schema";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID, R1_SAAS_PO_KEY } from "./r1-fixtures";

const SAAS_PO_ID = deriveCanonicalId("performance_obligation", R1_SAAS_PO_KEY);
const SLA_VC_ID = deriveCanonicalId("variable_component", "vc:sla-service-credit");
const ALLOCATION_KEYS = {
  treatment: fieldKeys.vc(SLA_VC_ID, "allocationTreatment"),
  target: fieldKeys.vc(SLA_VC_ID, "targetPoId"),
  relates: fieldKeys.vc(SLA_VC_ID, "relatesSpecifically"),
  objective: fieldKeys.vc(SLA_VC_ID, "consistentWithAllocationObjective"),
  rationale: fieldKeys.vc(SLA_VC_ID, "allocationRationale"),
};

function run(args: {
  analysis: AiContractAnalysis;
  draft?: WorkflowDraft;
  state?: AiAnalysisState;
  runId?: string;
}) {
  return mergeAiAnalysis({
    currentDraft: args.draft ?? createEmptyDraft(),
    currentAiState: args.state ?? createEmptyAiAnalysisState(),
    analysis: args.analysis,
    runId: args.runId ?? R1_RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

function withFixed(value: string | null): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.fixedConsiderationInput = value;
  return analysis;
}

/* ================================================== fixed-consideration matrix */

describe("R1 acceptance — the deterministic full-term total is authoritative", () => {
  it("A. corrects a model amount that is one billing period's fee", () => {
    expect(run({ analysis: withFixed("245000") }).draft.transactionPriceInput).toBe("490000.00");
  });

  it("B. keeps the same canonical amount when the model already agrees", () => {
    expect(run({ analysis: withFixed("490000") }).draft.transactionPriceInput).toBe("490000.00");
  });

  it("C. overrides a model amount that is simply wrong", () => {
    expect(run({ analysis: withFixed("500000") }).draft.transactionPriceInput).toBe("490000.00");
  });

  it("D. supplies the total when the model reported nothing", () => {
    expect(run({ analysis: withFixed(null) }).draft.transactionPriceInput).toBe("490000.00");
  });

  it("D2. raises no missing-input item when ARC derived the total", () => {
    const { issues } = run({ analysis: withFixed(null) });
    expect(
      issues.filter((issue) => issue.targetKey === fieldKeys.transactionPrice("input")),
    ).toHaveLength(0);
  });

  it("E. preserves the accountant's own price and raises exactly one item", () => {
    const manual: WorkflowDraft = { ...createEmptyDraft(), transactionPriceInput: "400000" };
    const { draft, issues } = run({ analysis: withFixed("500000"), draft: manual });
    expect(draft.transactionPriceInput).toBe("400000");
    expect(
      issues.filter((issue) => issue.targetKey === fieldKeys.transactionPrice("input")),
    ).toHaveLength(1);
  });

  it("F. falls back to the model's full-term amount when no unambiguous schedule exists", () => {
    const analysis = withFixed("490000");
    analysis.billingTerms = [
      ...analysis.billingTerms,
      {
        ...analysis.billingTerms[0]!,
        semanticKey: "billing:second-fixed",
        description: "A second, independently schedulable fixed invoice.",
        frequency: "quarterly",
        amountOrRateInput: "10000",
        citations: [
          {
            ...analysis.billingTerms[0]!.citations[0]!,
            excerpt: "A separate $10,000 fee is invoiced quarterly in advance.",
          },
        ],
      },
    ];
    expect(run({ analysis }).draft.transactionPriceInput).toBe("490000");
  });

  it("G. still fails to a missing-input item with no schedule and no model amount", () => {
    const analysis = withFixed(null);
    analysis.billingTerms = analysis.billingTerms.filter(
      (term) => term.billingTiming === "on_usage",
    );
    const { draft, issues } = run({ analysis });
    expect(draft.transactionPriceInput).toBe("");
    expect(
      issues.some(
        (issue) =>
          issue.targetKey === fieldKeys.transactionPrice("input") &&
          issue.reasonCode === "missing_required_input",
      ),
    ).toBe(true);
  });

  it("writes ARC's own derivation wording whenever ARC supplied the amount", () => {
    for (const reported of ["245000", "490000", "500000", null]) {
      const notes = run({ analysis: withFixed(reported) }).draft.transactionPriceNotes;
      expect(notes).toContain("490000.00");
      expect(notes).toContain("annual");
      expect(notes).not.toContain("500000");
    }
  });

  it("keeps the model's validated rationale when the model's amount is used", () => {
    const analysis = withFixed("490000");
    analysis.billingTerms = analysis.billingTerms.filter(
      (term) => term.billingTiming === "on_usage",
    );
    expect(run({ analysis }).draft.transactionPriceNotes).toContain(
      analysis.transactionPrice.fixedConsiderationRationale,
    );
  });
});

/* ============================================ allocation group re-analysis */

type AllocationEdit = {
  name: string;
  key: string;
  edit: (draft: WorkflowDraft) => WorkflowDraft;
  expected: (row: Record<string, unknown>) => void;
};

function editComponent(draft: WorkflowDraft, patch: Record<string, unknown>): WorkflowDraft {
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((row) =>
      row.id === SLA_VC_ID ? { ...row, ...patch } : row,
    ),
  };
}

function slaRow(draft: WorkflowDraft): Record<string, unknown> {
  return draft.variableConsiderationComponents.find(
    (row) => row.id === SLA_VC_ID,
  ) as unknown as Record<string, unknown>;
}

const EDITS: AllocationEdit[] = [
  {
    name: "A. target performance obligation",
    key: ALLOCATION_KEYS.target,
    edit: (draft) => editComponent(draft, { targetPoId: null, allocationTreatment: "general" }),
    expected: (row) => expect(row["targetPoId"]).toBeNull(),
  },
  {
    name: "B. relates specifically",
    key: ALLOCATION_KEYS.relates,
    edit: (draft) => editComponent(draft, { relatesSpecifically: false }),
    expected: (row) => expect(row["relatesSpecifically"]).toBe(false),
  },
  {
    name: "C. consistent with the allocation objective",
    key: ALLOCATION_KEYS.objective,
    edit: (draft) => editComponent(draft, { consistentWithAllocationObjective: false }),
    expected: (row) => expect(row["consistentWithAllocationObjective"]).toBe(false),
  },
  {
    name: "D. allocation treatment",
    key: ALLOCATION_KEYS.treatment,
    edit: (draft) => editComponent(draft, { allocationTreatment: "general" }),
    expected: (row) => expect(row["allocationTreatment"]).toBe("general"),
  },
  {
    name: "E. allocation rationale",
    key: ALLOCATION_KEYS.rationale,
    edit: (draft) => editComponent(draft, { allocationRationale: "My own allocation reasoning." }),
    expected: (row) => expect(row["allocationRationale"]).toBe("My own allocation reasoning."),
  },
];

describe("R1 acceptance — the VC allocation judgment is one user-ownable group", () => {
  it("writes the whole AI allocation on a first run", () => {
    const first = run({ analysis: genomixR1Analysis() });
    const row = slaRow(first.draft);
    expect(row["allocationTreatment"]).toBe("specific_po");
    expect(row["targetPoId"]).toBe(SAAS_PO_ID);
    expect(row["relatesSpecifically"]).toBe(true);
    expect(row["consistentWithAllocationObjective"]).toBe(true);
    for (const key of Object.values(ALLOCATION_KEYS)) {
      expect(first.aiState.fieldProvenance[key]!.state).toBe("ai_generated_untouched");
    }
  });

  for (const spec of EDITS) {
    it(`${spec.name}: an accountant edit survives a later AI analysis`, () => {
      const first = run({ analysis: genomixR1Analysis() });
      const edited = spec.edit(first.draft);
      const reconciled = reconcileAiEdits({
        previousDraft: first.draft,
        nextDraft: edited,
        currentAiState: first.aiState,
      });

      const second = run({
        analysis: genomixR1Analysis(),
        draft: edited,
        state: reconciled.aiState,
        runId: "run-00000000-0000-4000-8000-000000000012",
      });

      spec.expected(slaRow(second.draft));
      const provenance = second.aiState.fieldProvenance[spec.key]!;
      expect(
        ["ai_generated_user_edited", "ai_difference_preserved_user_override"].includes(
          provenance.state,
        ),
      ).toBe(true);
      // One focused difference for the whole judgment, never five.
      expect(
        second.issues.filter((issue) =>
          issue.targetKey.startsWith(fieldKeys.vc(SLA_VC_ID, "allocation")),
        ),
      ).toHaveLength(1);
    });
  }

  it("F. an untouched allocation group can still be updated by a later AI run", () => {
    const first = run({ analysis: genomixR1Analysis() });
    const second = run({
      analysis: (() => {
        const analysis = genomixR1Analysis();
        analysis.transactionPrice.variableConsiderationComponents[1]!.allocationRationale =
          "Updated: the credit reduces only the recurring platform fee.";
        return analysis;
      })(),
      draft: first.draft,
      state: first.aiState,
      runId: "run-00000000-0000-4000-8000-000000000013",
    });
    expect(slaRow(second.draft)["allocationRationale"]).toBe(
      "Updated: the credit reduces only the recurring platform fee.",
    );
    expect(second.aiState.fieldProvenance[ALLOCATION_KEYS.rationale]!.state).toBe(
      "ai_generated_untouched",
    );
  });

  it("G. an unmappable specific target still fails closed", () => {
    const analysis = genomixR1Analysis();
    analysis.transactionPrice.variableConsiderationComponents[1]!.targetPerformanceObligationKey =
      "po:does-not-exist";
    const { draft, issues } = run({ analysis });
    expect(slaRow(draft)["targetPoId"]).toBeNull();
    expect(
      issues.some(
        (issue) =>
          issue.targetKey === fieldKeys.vc(SLA_VC_ID, "allocation") &&
          issue.reasonCode === "unsafe_semantic_relationship",
      ),
    ).toBe(true);
  });

  it("H. a manual-from-start allocation is never overwritten", () => {
    const first = run({ analysis: genomixR1Analysis() });
    // The accountant's own judgment, recorded before any AI state existed.
    const manual = editComponent(first.draft, {
      allocationTreatment: "general",
      targetPoId: null,
      relatesSpecifically: false,
      consistentWithAllocationObjective: false,
      allocationRationale: "Allocated across the contract on my own judgment.",
    });
    const second = run({ analysis: genomixR1Analysis(), draft: manual });
    const row = slaRow(second.draft);
    expect(row["allocationTreatment"]).toBe("general");
    expect(row["targetPoId"]).toBeNull();
    expect(row["allocationRationale"]).toBe("Allocated across the contract on my own judgment.");
  });

  it("does not freeze unrelated variable-consideration fields", () => {
    const first = run({ analysis: genomixR1Analysis() });
    const edited = editComponent(first.draft, { targetPoId: null });
    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: edited,
      currentAiState: first.aiState,
    });
    const analysis = genomixR1Analysis();
    analysis.transactionPrice.variableConsiderationComponents[1]!.description =
      "Availability service credit (restated)";
    const second = run({
      analysis,
      draft: edited,
      state: reconciled.aiState,
      runId: "run-00000000-0000-4000-8000-000000000014",
    });
    expect(slaRow(second.draft)["description"]).toBe("Availability service credit (restated)");
  });

  it("reopens the allocation review when the proposed judgment materially changes", () => {
    const first = run({ analysis: genomixR1Analysis() });
    const edited = editComponent(first.draft, { relatesSpecifically: false });
    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: edited,
      currentAiState: first.aiState,
    });
    const itemFor = (rationale: string) => {
      const analysis = genomixR1Analysis();
      analysis.transactionPrice.variableConsiderationComponents[1]!.allocationRationale = rationale;
      return run({
        analysis,
        draft: edited,
        state: reconciled.aiState,
        runId: "run-00000000-0000-4000-8000-000000000015",
      }).issues.find((issue) => issue.targetKey === fieldKeys.vc(SLA_VC_ID, "allocation"))!;
    };
    expect(itemFor("A materially different allocation conclusion.").reviewFingerprint).not.toBe(
      itemFor("The credit applies exclusively to the recurring platform license fees.")
        .reviewFingerprint,
    );
  });
});

/* ================================================ Phase 9G store receiver */

describe("R1 acceptance — the Phase 9G stores keep their Supabase receiver", () => {
  it("calls the reconciling routine with the client as the receiver", async () => {
    const client = {
      rpc(this: unknown, _fn: string, _args: Record<string, unknown>) {
        // The real client reads `this.rest`; a detached method throws.
        if (this !== client)
          throw new TypeError("Cannot read properties of undefined (reading 'rest')");
        return Promise.resolve({
          data: [{ lock_version: 7, saved_at: "2026-09-19" }],
          error: null,
        });
      },
    };
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: client }));
    const { createAutosaveReconciliationStore } = await import("../autosave.store.server");
    const store = await createAutosaveReconciliationStore(async () => null as never);

    const saved = await store.saveWithReconciliation({
      scope: {
        ownerUserId: "00000000-0000-4000-8000-0000000000aa",
        actorUserId: "00000000-0000-4000-8000-0000000000aa",
        guestTokenHash: null,
        revisionId: "00000000-0000-4000-8000-0000000000bb",
        guestWorkspaceId: null,
      },
      expectedLockVersion: 6,
      canonical: createEmptyDraft() as never,
      schemaVersion: 1,
      aiState: createEmptyAiAnalysisState(),
      reviewEvents: [],
    } as never);

    expect(saved).toEqual({ lockVersion: 7, savedAt: "2026-09-19" });
    vi.doUnmock("@/integrations/supabase/client.server");
  });

  it("never detaches rpc from the client in either Phase 9G store", () => {
    for (const path of [
      "src/lib/arc/ai/autosave.store.server.ts",
      "src/lib/arc/ai/review-actions.store.server.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("supabaseAdmin.rpc.bind(supabaseAdmin)");
      expect(/=\s*supabaseAdmin\.rpc\s*as/.test(source)).toBe(false);
    }
  });
});

/* ============================== Task 4 integration — allocation targets */

const ALLOCATION_TARGET = fieldKeys.vc(SLA_VC_ID, "allocation");

const FIELD_EDITS: Array<{ name: string; key: string; patch: Record<string, unknown> }> = [
  {
    name: "allocationTreatment",
    key: ALLOCATION_KEYS.treatment,
    patch: { allocationTreatment: "general" },
  },
  {
    name: "targetPoId",
    key: ALLOCATION_KEYS.target,
    patch: { targetPoId: deriveCanonicalId("performance_obligation", "po:other") },
  },
  {
    name: "relatesSpecifically",
    key: ALLOCATION_KEYS.relates,
    patch: { relatesSpecifically: false },
  },
  {
    name: "consistentWithAllocationObjective",
    key: ALLOCATION_KEYS.objective,
    patch: { consistentWithAllocationObjective: false },
  },
  {
    name: "allocationRationale",
    key: ALLOCATION_KEYS.rationale,
    patch: { allocationRationale: "My own allocation reasoning." },
  },
];

describe("R1 acceptance — Task 4 sees an allocation edit immediately", () => {
  for (const spec of FIELD_EDITS) {
    it(`marks ${spec.name} as user-edited at autosave reconciliation`, () => {
      const first = run({ analysis: genomixR1Analysis() });
      expect(first.aiState.fieldProvenance[spec.key]!.state).toBe("ai_generated_untouched");

      const reconciled = reconcileAiEdits({
        previousDraft: first.draft,
        nextDraft: editComponent(first.draft, spec.patch),
        currentAiState: first.aiState,
      });

      expect(reconciled.aiState.fieldProvenance[spec.key]!.state).toBe("ai_generated_user_edited");
    });
  }
});

function resolvedAllocationState(state: AiAnalysisState, draft: WorkflowDraft): AiAnalysisState {
  const item = {
    id: "item-allocation",
    targetKey: ALLOCATION_TARGET,
    section: "step_3" as const,
    state: "resolved" as const,
    severity: "yellow" as const,
    reasonCode: "manual_value_preserved" as const,
    reason: "The allocation judgment differs from the AI proposal.",
    guidanceIds: [],
    citations: [],
    valueFingerprint: "v",
    reviewFingerprint: "f",
    resolution: {
      kind: "affirmation" as const,
      at: "2027-02-01T00:00:00.000Z",
      method: "explicit" as const,
      reviewFingerprint: "f",
    },
    affirmedAt: "2027-02-01T00:00:00.000Z",
    affirmedMethod: "explicit" as const,
  };
  const unrelated = {
    ...item,
    id: "item-description",
    targetKey: fieldKeys.vc(SLA_VC_ID, "description"),
  };
  void draft;
  return { ...state, reviewItems: [item as never, unrelated as never] };
}

describe("R1 acceptance — a resolved allocation review reopens on a material edit", () => {
  for (const spec of FIELD_EDITS) {
    it(`reopens when ${spec.name} materially changes`, () => {
      const first = run({ analysis: genomixR1Analysis() });
      const state = resolvedAllocationState(first.aiState, first.draft);
      const next = editComponent(first.draft, spec.patch);

      expect(canonicalReviewTargetFingerprint(first.draft, ALLOCATION_TARGET)).not.toBe(
        canonicalReviewTargetFingerprint(next, ALLOCATION_TARGET),
      );

      const reconciled = reconcileAiEdits({
        previousDraft: first.draft,
        nextDraft: next,
        currentAiState: state,
      });
      const item = reconciled.aiState.reviewItems.find((row) => row.id === "item-allocation")!;
      expect(item.state).toBe("yellow");
      expect(item.resolution).toBeNull();
      expect(
        reconciled.reviewEvents.filter((event) => event.reviewItemId === "item-allocation"),
      ).toHaveLength(1);
      expect(reconciled.reviewEvents[0]!.type).toBe("review_item_reopened");
      // The unrelated description review is untouched.
      expect(
        reconciled.aiState.reviewItems.find((row) => row.id === "item-description")!.state,
      ).toBe("resolved");
    });
  }
});

describe("R1 acceptance — the allocation target is a material group", () => {
  it("classifies through the allocation group rather than as an exact scalar", () => {
    const { draft } = run({ analysis: genomixR1Analysis() });
    expect(classifyReviewTarget(draft, ALLOCATION_TARGET)).toBe("composite");
  });

  it("ignores unrelated variable-consideration edits", () => {
    const { draft } = run({ analysis: genomixR1Analysis() });
    const base = canonicalReviewTargetFingerprint(draft, ALLOCATION_TARGET);
    for (const patch of [
      { description: "Availability service credit (restated)" },
      { estimationMethod: "most_likely_amount" },
      { usagePeriods: [] },
    ]) {
      expect(canonicalReviewTargetFingerprint(editComponent(draft, patch), ALLOCATION_TARGET)).toBe(
        base,
      );
    }
  });
});
