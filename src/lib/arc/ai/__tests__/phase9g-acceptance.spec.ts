/**
 * Phase 9G — Task 10. End-to-end acceptance matrix.
 *
 * This suite adds no product behaviour. It drives the ACCEPTED handlers
 * (workspace read, deliberate analysis request, review actions, evidence,
 * Guidance, restore) through the complete accountant lifecycle and asserts the
 * invariants Tasks 1–9 were accepted on.
 *
 * What is simulated: only true infrastructure — the database routines (their
 * own semantics are proven by the SQL suites), the storage signer, the
 * Guidance registry, the clock and the OpenAI provider. ARC's own state machine
 * is the real one under test: every assertion below flows through production
 * handler code.
 *
 * No OpenAI call is made anywhere in this file.
 */

import { describe, expect, it } from "vitest";

import { AI_GUIDANCE_UNAVAILABLE, AI_EVIDENCE_UNAVAILABLE } from "../review-evidence.handlers";
import { aiReviewEvidenceLinkHandler, aiReviewGuidanceHandler } from "../review-evidence.handlers";
import { aiReviewFinalizeBlock } from "../review-presentation";
import { sourceFreshnessPresentation } from "../source-freshness";
import { AI_RESTORE_UNAVAILABLE, restoreAiAnalysisHandler } from "../restore.handlers";
import { AI_REVIEW_ACTION_UNAVAILABLE } from "../review-actions.handlers";
import type { AiReviewItem } from "../review-state";
import { AI_WORKSPACE_NOT_EDITABLE, type AiCallerScope } from "../runs.handlers";
import {
  acknowledgeAiStaleSourcesAction,
  affirmAiReviewItemAction,
  aiWorkspaceStateHandler,
  requestAiAnalysisHandler,
  resolveAiReviewIssueAction,
  type AiWorkspaceDeps,
  type AiWorkspaceRunRecord,
} from "../workspace.handlers";

/* ------------------------------------------------------------- identities */

const REVISION = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "55555555-5555-4555-8555-555555555555";
const GUEST_A = "33333333-3333-4333-8333-333333333333";
const GUEST_B = "66666666-6666-4666-8666-666666666666";
const HASH_A = "9".repeat(64);
const HASH_B = "8".repeat(64);
const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const savedCaller: AiCallerScope = {
  kind: "revision",
  userId: USER_A,
  revisionId: REVISION,
  contractId: "44444444-4444-4444-8444-444444444444",
};

const foreignCaller: AiCallerScope = {
  kind: "revision",
  userId: USER_B,
  revisionId: REVISION,
  contractId: "44444444-4444-4444-8444-444444444444",
};

const guestCaller: AiCallerScope = {
  kind: "guest",
  guestTokenHash: HASH_A,
  guestWorkspaceId: GUEST_A,
  authenticatedUserId: null,
};

const foreignGuestCaller: AiCallerScope = {
  kind: "guest",
  guestTokenHash: HASH_B,
  guestWorkspaceId: GUEST_B,
  authenticatedUserId: null,
};

/* ------------------------------------------------------- review fixtures */

function yellowItem(overrides: Partial<AiReviewItem> = {}): AiReviewItem {
  return {
    id: "item-yellow",
    targetKey: "field:contract.transactionPrice",
    section: "step_3",
    state: "yellow",
    severity: "yellow",
    reasonCode: "accountant_affirmation_required",
    reason: "Confirm the transaction price reflects the contract.",
    guidanceIds: [12, 30],
    citations: [
      {
        documentId: DOC_A,
        pageStart: 4,
        pageEnd: 5,
        evidenceMode: "text",
        excerpt: "Total contract value of $120,000.",
      },
    ],
    valueFingerprint: "v-yellow",
    reviewFingerprint: "fp-yellow",
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
    ...overrides,
  };
}

function redItem(overrides: Partial<AiReviewItem> = {}): AiReviewItem {
  return {
    ...yellowItem(),
    id: "item-red",
    targetKey: "field:contract.paymentTerms",
    section: "step_1",
    state: "red",
    severity: "red",
    reasonCode: "missing_required_input",
    reason: "Payment terms could not be determined from the sources.",
    guidanceIds: [12],
    valueFingerprint: "v-red",
    reviewFingerprint: "fp-red",
    ...overrides,
  };
}

/* ------------------------------------------------- simulated persistence */

interface ScopeState {
  lockVersion: number;
  canonicalInputs: unknown;
  sidecar: {
    lastSuccessfulRunId: string | null;
    sourceSetFingerprint: string | null;
    reviewItems: AiReviewItem[];
    fieldProvenance: Record<string, unknown>;
    acknowledgedSourceFingerprint: string | null;
  } | null;
  currentSourceFingerprint: string | null;
  hasIncludedSources: boolean;
  expiresAt: string | null;
  editable: boolean;
}

interface RunRecord extends AiWorkspaceRunRecord {
  restoredAt: string | null;
  preRunCanonicalInputs: unknown;
  preRunAiState: unknown;
  sourceSetFingerprint: string;
}

interface Counters {
  createRun: number;
  executeProvider: number;
  reviewEvents: string[];
  signedUrls: number;
  authenticatedUsage: number;
  guestUsage: number;
}

class Server {
  readonly saved: ScopeState;
  readonly guest: ScopeState;
  readonly guestB: ScopeState;
  readonly runs: RunRecord[] = [];
  readonly counters: Counters = {
    createRun: 0,
    executeProvider: 0,
    reviewEvents: [],
    signedUrls: 0,
    authenticatedUsage: 0,
    guestUsage: 0,
  };
  private runSeq = 0;

  constructor(options: { fingerprint?: string | null; hasIncludedSources?: boolean } = {}) {
    const fingerprint = options.fingerprint === undefined ? "fp-sources-1" : options.fingerprint;
    const base = (): ScopeState => ({
      lockVersion: 3,
      canonicalInputs: { step: "manual draft" },
      sidecar: null,
      currentSourceFingerprint: fingerprint,
      hasIncludedSources: options.hasIncludedSources ?? fingerprint !== null,
      expiresAt: null,
      editable: true,
    });
    this.saved = base();
    this.guest = { ...base(), expiresAt: "2026-09-19T00:00:00.000Z" };
    this.guestB = { ...base(), expiresAt: "2026-09-19T00:00:00.000Z" };
  }

  scopeOf(caller: AiCallerScope): ScopeState {
    if (caller.kind === "revision") return this.saved;
    return caller.guestWorkspaceId === GUEST_A ? this.guest : this.guestB;
  }

  /** Resolve the owning scope the way a trusted routine's WHERE clause does. */
  scopeFor(args: { revisionId: string | null; guestWorkspaceId: string | null }): ScopeState {
    if (args.revisionId) return this.saved;
    return args.guestWorkspaceId === GUEST_A ? this.guest : this.guestB;
  }

  /** The trusted apply routine: sidecar and canonical draft move together. */
  applyRun(caller: AiCallerScope, runId: string, items: AiReviewItem[]): void {
    const scope = this.scopeOf(caller);
    const run = this.runs.find((row) => row.id === runId)!;
    run.stage = "succeeded";
    run.completedAt = "2026-09-18T10:00:00.000Z";
    run.reviewIssueCount = items.filter((item) => item.state !== "resolved").length;
    run.allowanceConsumed = true;
    scope.canonicalInputs = { step: `applied by ${runId}` };
    scope.sidecar = {
      lastSuccessfulRunId: runId,
      sourceSetFingerprint: scope.currentSourceFingerprint,
      reviewItems: items,
      fieldProvenance: { "contract.transactionPrice": { state: "ai_generated_untouched" } },
      acknowledgedSourceFingerprint: null,
    };
    scope.lockVersion += 1;
    if (run.quotaScope === "authenticated") this.counters.authenticatedUsage += 1;
    else this.counters.guestUsage += 1;
  }

  mutateSources(caller: AiCallerScope, fingerprint: string | null): void {
    const scope = this.scopeOf(caller);
    scope.currentSourceFingerprint = fingerprint;
    scope.hasIncludedSources = fingerprint !== null;
    scope.lockVersion += 1;
  }

  deps(options: { malformedReview?: boolean; guidanceCards?: number[] } = {}): AiWorkspaceDeps {
    // The fake store closures read live server state, exactly as the real
    // routines re-read their rows.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const server = this;
    const store = {
      findEditableRevision: async (revisionId: string, userId: string) =>
        server.saved.editable && revisionId === REVISION && userId === USER_A
          ? { id: REVISION, contractId: "c", lockVersion: server.saved.lockVersion }
          : null,
      findActiveGuestWorkspace: async (tokenHash: string) => {
        if (tokenHash === HASH_A && server.guest.editable) {
          return { id: GUEST_A, lockVersion: server.guest.lockVersion };
        }
        if (tokenHash === HASH_B && server.guestB.editable) {
          return { id: GUEST_B, lockVersion: server.guestB.lockVersion };
        }
        return null;
      },
      findActiveRunForScope: async (scope: {
        revisionId: string | null;
        guestWorkspaceId: string | null;
      }) =>
        server.runs.find(
          (run) =>
            run.revisionId === scope.revisionId &&
            run.guestWorkspaceId === scope.guestWorkspaceId &&
            ["created", "extracting", "analyzing", "validating", "applying"].includes(run.stage),
        ) ?? null,
      findRun: async (runId: string) => server.runs.find((run) => run.id === runId) ?? null,
      findLatestRunForScope: async (scope: {
        revisionId: string | null;
        guestWorkspaceId: string | null;
      }) => {
        const owned = server.runs.filter(
          (run) =>
            run.revisionId === scope.revisionId && run.guestWorkspaceId === scope.guestWorkspaceId,
        );
        return owned[owned.length - 1] ?? null;
      },
      loadWorkspaceSnapshot: async (caller: AiCallerScope) => {
        const scope = server.scopeOf(caller);
        const sidecar = scope.sidecar;
        const fingerprint = scope.currentSourceFingerprint;
        const sourceState = !sidecar
          ? "none"
          : sidecar.sourceSetFingerprint === fingerprint
            ? "current"
            : "stale";
        return {
          lastSuccessfulRunId: sidecar?.lastSuccessfulRunId ?? null,
          currentSourceSetFingerprint: fingerprint,
          sourceState: sourceState as "none" | "current" | "stale",
          hasIncludedSources: scope.hasIncludedSources,
          acknowledgedSourceFingerprint: sidecar?.acknowledgedSourceFingerprint ?? null,
          outstandingReviewIssueCount: (sidecar?.reviewItems ?? []).filter(
            (item) => item.state !== "resolved",
          ).length,
          reviewItems: options.malformedReview ? [] : (sidecar?.reviewItems ?? []),
          reviewPayloadMalformed: options.malformedReview === true,
          fieldProvenance: sidecar?.fieldProvenance ?? {},
          objectProvenance: {},
          guestWorkspaceExpiresAt: scope.expiresAt,
        };
      },
      loadRunCreationSnapshot: async (caller: AiCallerScope) => {
        const scope = server.scopeOf(caller);
        return {
          expectedLockVersion: scope.lockVersion,
          sourceSetFingerprint: scope.currentSourceFingerprint ?? "",
          preRunCanonicalInputs: scope.canonicalInputs,
          preRunAiState: scope.sidecar
            ? {
                last_successful_run_id: scope.sidecar.lastSuccessfulRunId,
                source_set_fingerprint: scope.sidecar.sourceSetFingerprint,
                review_items: scope.sidecar.reviewItems,
                field_provenance: scope.sidecar.fieldProvenance,
                acknowledged_source_fingerprint: scope.sidecar.acknowledgedSourceFingerprint,
                source_acknowledged_at: null,
                source_acknowledged_by: null,
              }
            : null,
        };
      },
      createRun: async (args: {
        runId: string;
        revisionId: string | null;
        guestWorkspaceId: string | null;
        quotaScope: "authenticated" | "guest";
        sourceSetFingerprint: string;
        preRunCanonicalInputs: unknown;
        preRunAiState: unknown;
      }) => {
        // The trusted routine reserves allowance; an exhausted scope is refused
        // before any run row exists.
        const used =
          args.quotaScope === "authenticated"
            ? server.counters.authenticatedUsage
            : server.counters.guestUsage;
        const limit = args.quotaScope === "authenticated" ? 10 : 3;
        if (used >= limit) throw new Error("ARC: no AI analyses remaining");
        server.counters.createRun += 1;
        server.runSeq += 1;
        const id = `run-${server.runSeq}`;
        server.runs.push({
          id,
          stage: "created",
          revisionId: args.revisionId,
          guestWorkspaceId: args.guestWorkspaceId,
          ownerUserId: args.revisionId ? USER_A : null,
          guestTokenHash: args.guestWorkspaceId === GUEST_A ? HASH_A : null,
          quotaScope: args.quotaScope,
          sourceCount: 2,
          pageCount: 14,
          inputTokens: null,
          reviewIssueCount: 0,
          completedAt: null,
          safeMessage: null,
          failureStage: null,
          failureCategory: null,
          failureCode: null,
          allowanceConsumed: false,
          restoredAt: null,
          preRunCanonicalInputs: args.preRunCanonicalInputs,
          preRunAiState: args.preRunAiState,
          sourceSetFingerprint: args.sourceSetFingerprint,
        });
        return id;
      },
      monthlyUsage: async () => server.counters.authenticatedUsage,
      guestConsumed: async () => server.counters.guestUsage,

      affirmReviewItem: async (args: {
        reviewItemId: string;
        expectedReviewFingerprint: string;
        revisionId: string | null;
        guestWorkspaceId: string | null;
      }) => {
        const scope = server.scopeFor(args);
        const item = scope.sidecar?.reviewItems.find((row) => row.id === args.reviewItemId);
        if (!item || item.reviewFingerprint !== args.expectedReviewFingerprint) {
          const error = new Error("refused") as Error & { code?: string };
          error.code = "42501";
          throw error;
        }
        if (item.severity !== "yellow") {
          const error = new Error("refused") as Error & { code?: string };
          error.code = "42501";
          throw error;
        }
        if (item.state === "resolved") {
          return { lockVersion: scope.lockVersion, alreadyResolved: true, eventId: null };
        }
        item.state = "resolved";
        item.resolution = {
          kind: "affirmed",
          at: "2026-09-18T12:00:00.000Z",
          method: "individual",
          reviewFingerprint: item.reviewFingerprint,
        };
        scope.lockVersion += 1;
        server.counters.reviewEvents.push(`affirm:${item.id}`);
        return { lockVersion: scope.lockVersion, alreadyResolved: false, eventId: "e1" };
      },
      resolveReviewIssue: async (args: {
        reviewItemId: string;
        expectedReviewFingerprint: string;
        reason: "reviewed_current_treatment" | "outside_source_information" | "not_applicable";
        note: string | null;
        revisionId: string | null;
        guestWorkspaceId: string | null;
      }) => {
        const scope = server.scopeFor(args);
        const item = scope.sidecar?.reviewItems.find((row) => row.id === args.reviewItemId);
        if (!item || item.reviewFingerprint !== args.expectedReviewFingerprint) {
          const error = new Error("refused") as Error & { code?: string };
          error.code = "42501";
          throw error;
        }
        if (item.state === "resolved") {
          return { lockVersion: scope.lockVersion, alreadyResolved: true, eventId: null };
        }
        item.state = "resolved";
        item.resolution = {
          kind: "manual_red",
          at: "2026-09-18T12:00:00.000Z",
          reason: args.reason,
          note: args.note,
          reviewFingerprint: item.reviewFingerprint,
        };
        scope.lockVersion += 1;
        server.counters.reviewEvents.push(`resolve:${item.id}`);
        return { lockVersion: scope.lockVersion, alreadyResolved: false, eventId: "e2" };
      },
      acknowledgeStaleSources: async (args: {
        expectedSourceSetFingerprint: string;
        revisionId: string | null;
        guestWorkspaceId: string | null;
      }) => {
        const scope = server.scopeFor(args);
        if (scope.currentSourceFingerprint !== args.expectedSourceSetFingerprint) {
          const error = new Error("moved on") as Error & { code?: string };
          error.code = "40001";
          throw error;
        }
        const already =
          scope.sidecar?.acknowledgedSourceFingerprint === args.expectedSourceSetFingerprint;
        if (scope.sidecar)
          scope.sidecar.acknowledgedSourceFingerprint = args.expectedSourceSetFingerprint;
        if (!already) server.counters.reviewEvents.push("acknowledge");
        scope.lockVersion += 1;
        return {
          lockVersion: scope.lockVersion,
          sourceSetFingerprint: args.expectedSourceSetFingerprint,
          alreadyAcknowledged: already,
          eventId: already ? null : "e3",
        };
      },

      loadRestoreCandidate: async (caller: AiCallerScope, runId: string) => {
        const run = server.runs.find((row) => row.id === runId);
        if (!run) return null;
        const scope = server.scopeOf(caller);
        const owned =
          caller.kind === "revision"
            ? run.revisionId === caller.revisionId
            : run.guestWorkspaceId === caller.guestWorkspaceId;
        const prior = run.preRunAiState as Record<string, unknown> | null;
        return {
          runId: run.id,
          stage: run.stage,
          completedAt: run.completedAt,
          restoredAt: run.restoredAt,
          sourceSetFingerprint: run.sourceSetFingerprint,
          preRunSnapshot:
            prior === null
              ? ("absent" as const)
              : "acknowledged_source_fingerprint" in prior
                ? ("exact" as const)
                : ("incomplete" as const),
          belongsToScope: owned && scope.editable,
        };
      },
      restorePreAiRun: async (args: { runId: string; expectedLockVersion: number }) => {
        const run = server.runs.find((row) => row.id === args.runId)!;
        const scope = server.scopeFor(run);
        if (scope.lockVersion !== args.expectedLockVersion) {
          throw new Error("ARC: the analysis changed since it was loaded");
        }
        scope.canonicalInputs = run.preRunCanonicalInputs;
        const prior = run.preRunAiState as {
          last_successful_run_id: string | null;
          source_set_fingerprint: string | null;
          review_items: AiReviewItem[];
          field_provenance: Record<string, unknown>;
          acknowledged_source_fingerprint: string | null;
        } | null;
        scope.sidecar = prior
          ? {
              lastSuccessfulRunId: prior.last_successful_run_id,
              sourceSetFingerprint: prior.source_set_fingerprint,
              reviewItems: prior.review_items,
              fieldProvenance: prior.field_provenance,
              acknowledgedSourceFingerprint: prior.acknowledged_source_fingerprint,
            }
          : null;
        run.restoredAt = "2026-09-18T13:00:00.000Z";
        scope.lockVersion += 1;
        return { lockVersion: scope.lockVersion, idempotent: false };
      },
    };

    return {
      store: store as unknown as AiWorkspaceDeps["store"],
      limits: {
        guestRunLimit: 3,
        userMonthlyRunLimit: 10,
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        promptVersion: "p",
        outputSchemaVersion: "s",
        guidanceRegistryHash: "h",
      },
      now: () => new Date("2026-09-18T12:00:00.000Z"),
      newRunId: () => "unused",
    } as unknown as AiWorkspaceDeps;
  }
}

function evidenceDeps(server: Server, deps: AiWorkspaceDeps) {
  return {
    store: deps.store,
    documents: {
      createReviewReadUrl: async (args: { documentId: string }) => {
        if (args.documentId !== DOC_A) return null;
        server.counters.signedUrls += 1;
        return { url: "https://storage.example/signed/doc-a", expiresInSeconds: 120 };
      },
    },
  };
}

function guidanceDeps(deps: AiWorkspaceDeps, available: number[]) {
  return {
    store: deps.store,
    guidance: {
      findApprovedCards: async (ids: readonly number[]) =>
        ids.filter((id) => available.includes(id)).map((id) => ({ topic: `card ${id}` }) as never),
    },
  };
}

/* ------------------------------------------------------- 5. saved happy path */

describe("Phase 9G acceptance — saved workspace happy path", () => {
  it("runs one deliberate analysis, applies it authoritatively and charges once", async () => {
    const server = new Server();
    const deps = server.deps();

    const before = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(before.hasAnalysis).toBe(false);
    expect(before.sourceState).toBe("none");
    expect(before.hasIncludedSources).toBe(true);
    expect(server.counters.createRun).toBe(0);

    const requested = await requestAiAnalysisHandler(deps, savedCaller);
    expect(requested.executionDisposition).toBe("start_execution");
    expect(server.counters.createRun).toBe(1);

    // A second click never starts a second run. While the first run is still
    // only `created` the click still owns execution; once it is under way the
    // same click can only rejoin it.
    const again = await requestAiAnalysisHandler(deps, savedCaller);
    expect(again.executionDisposition).toBe("start_execution");
    expect(server.counters.createRun).toBe(1);

    server.runs[0]!.stage = "analyzing";
    const rejoined = await requestAiAnalysisHandler(deps, savedCaller);
    expect(rejoined.executionDisposition).toBe("reconnect");
    expect(server.counters.createRun).toBe(1);

    server.applyRun(savedCaller, "run-1", [yellowItem()]);

    const after = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(after.hasAnalysis).toBe(true);
    expect(after.lastSuccessfulRunId).toBe("run-1");
    expect(after.sourceState).toBe("current");
    expect(after.reviewIssueCount).toBe(1);
    expect(after.reviewItems).toHaveLength(1);
    expect(after.allowance).toMatchObject({ scope: "authenticated", limit: 10, used: 1 });
    expect(server.counters.executeProvider).toBe(0);
  });
});

/* -------------------------------------------------------- 6. guest happy path */

describe("Phase 9G acceptance — guest workspace happy path", () => {
  it("uses the guest allowance and needs no account id", async () => {
    const server = new Server();
    const deps = server.deps();

    const requested = await requestAiAnalysisHandler(deps, guestCaller);
    expect(requested.allowance).toMatchObject({ scope: "guest", limit: 3 });
    server.applyRun(guestCaller, "run-1", [yellowItem()]);

    const state = await aiWorkspaceStateHandler(deps, guestCaller);
    expect(state.hasAnalysis).toBe(true);
    expect(state.allowance).toMatchObject({ scope: "guest", used: 1, remaining: 2 });
    // The credential is never part of any DTO.
    expect(JSON.stringify(state)).not.toContain(HASH_A);
  });

  it("reconnects to an already active guest run without creating another", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, guestCaller);
    server.runs[0]!.stage = "analyzing";
    const rejoined = await requestAiAnalysisHandler(deps, guestCaller);
    expect(rejoined.executionDisposition).toBe("reconnect");
    expect(rejoined.activeRun).not.toBeNull();
    expect(server.counters.createRun).toBe(1);
  });
});

/* ------------------------------------------- 7/8. manual-only and zero source */

describe("Phase 9G acceptance — AI is never mandatory", () => {
  it("leaves a manual analysis with no AI state and no finalization block", async () => {
    const server = new Server();
    const state = await aiWorkspaceStateHandler(server.deps(), savedCaller);
    expect(state.hasAnalysis).toBe(false);
    expect(state.sourceState).toBe("none");
    expect(state.reviewItems).toHaveLength(0);
    expect(aiReviewFinalizeBlock(state)).toBeNull();
    expect(sourceFreshnessPresentation(state)).toBeNull();
    expect(server.counters.createRun).toBe(0);
  });

  it("reports no included sources so Analyze routes to the uploader, unbilled", async () => {
    const server = new Server({ fingerprint: null, hasIncludedSources: false });
    const state = await aiWorkspaceStateHandler(server.deps(), savedCaller);
    expect(state.hasIncludedSources).toBe(false);
    expect(state.sourceState).toBe("none");
    expect(server.counters.createRun).toBe(0);
    expect(server.counters.authenticatedUsage).toBe(0);
  });
});

/* ------------------------------------------------------- 9/10. review flows */

describe("Phase 9G acceptance — review lifecycle", () => {
  it("resolves a yellow item once, on the exact fingerprint, and clears the gate", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);

    const open = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(aiReviewFinalizeBlock(open)).toContain("confirmation or resolution");

    await expect(
      affirmAiReviewItemAction(deps, savedCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-stale",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);

    const state = await affirmAiReviewItemAction(deps, savedCaller, {
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
    });
    expect(state.reviewItems[0]!.state).toBe("resolved");
    expect(aiReviewFinalizeBlock(state)).toBeNull();
    expect(server.counters.reviewEvents).toEqual(["affirm:item-yellow"]);

    // Repeat of the same accepted action writes no second audit event.
    await affirmAiReviewItemAction(deps, savedCaller, {
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
    });
    expect(server.counters.reviewEvents).toEqual(["affirm:item-yellow"]);
    expect(server.counters.createRun).toBe(1);
    expect(server.counters.authenticatedUsage).toBe(1);
  });

  it("accepts only the three red reasons and refuses yellow affirmation of a red item", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [redItem()]);

    await expect(
      resolveAiReviewIssueAction(deps, savedCaller, {
        reviewItemId: "item-red",
        expectedReviewFingerprint: "fp-red",
        reason: "because I said so",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);

    await expect(
      affirmAiReviewItemAction(deps, savedCaller, {
        reviewItemId: "item-red",
        expectedReviewFingerprint: "fp-red",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);

    const state = await resolveAiReviewIssueAction(deps, savedCaller, {
      reviewItemId: "item-red",
      expectedReviewFingerprint: "fp-red",
      reason: "reviewed_current_treatment",
      note: "Reviewed against the signed order form.",
    });
    expect(state.reviewItems[0]!.resolution).toMatchObject({
      kind: "manual_red",
      reason: "reviewed_current_treatment",
    });
    expect(aiReviewFinalizeBlock(state)).toBeNull();
  });

  it("blocks finalization and offers nothing while the payload is malformed", async () => {
    const server = new Server();
    const deps = server.deps({ malformedReview: true });
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);

    const state = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(state.reviewPayloadMalformed).toBe(true);
    expect(state.reviewItems).toHaveLength(0);
    expect(aiReviewFinalizeBlock(state)).toContain("could not be read");

    await expect(
      aiReviewEvidenceLinkHandler(evidenceDeps(server, deps), savedCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
        citationIndex: 0,
      }),
    ).rejects.toThrow(AI_EVIDENCE_UNAVAILABLE);
    expect(server.counters.signedUrls).toBe(0);
  });
});

/* ------------------------------------------------ 15/16/17. evidence, guidance */

describe("Phase 9G acceptance — evidence and Guidance authority", () => {
  async function analyzed(server: Server, deps: AiWorkspaceDeps) {
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);
  }

  it("signs a short-lived link only on deliberate request and exposes no identity", async () => {
    const server = new Server();
    const deps = server.deps();
    await analyzed(server, deps);

    const state = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(JSON.stringify(state.reviewItems)).not.toContain(DOC_A);
    expect(state.reviewItems[0]!.guidanceReferenceCount).toBe(2);
    expect(server.counters.signedUrls).toBe(0);

    const link = await aiReviewEvidenceLinkHandler(evidenceDeps(server, deps), savedCaller, {
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
      citationIndex: 0,
    });
    expect(link).toMatchObject({ pageStart: 4, pageEnd: 5, expiresInSeconds: 120 });
    expect(server.counters.signedUrls).toBe(1);
  });

  it("fails neutrally for a foreign document, a bad ordinal and a stale fingerprint", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [
      yellowItem({
        citations: [
          {
            documentId: DOC_FOREIGN,
            pageStart: 2,
            pageEnd: 2,
            evidenceMode: "text",
            excerpt: "x",
          },
        ],
      }),
    ]);
    const evidence = evidenceDeps(server, deps);

    for (const input of [
      { reviewItemId: "item-yellow", expectedReviewFingerprint: "fp-yellow", citationIndex: 0 },
      { reviewItemId: "item-yellow", expectedReviewFingerprint: "fp-yellow", citationIndex: 9 },
      { reviewItemId: "item-yellow", expectedReviewFingerprint: "moved", citationIndex: 0 },
      { reviewItemId: "unknown", expectedReviewFingerprint: "fp-yellow", citationIndex: 0 },
    ]) {
      await expect(aiReviewEvidenceLinkHandler(evidence, savedCaller, input)).rejects.toThrow(
        AI_EVIDENCE_UNAVAILABLE,
      );
    }
    expect(server.counters.signedUrls).toBe(0);
    // The review item itself remains readable.
    const state = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(state.reviewItems).toHaveLength(1);
  });

  it("returns Guidance only as a complete approved set", async () => {
    const server = new Server();
    const deps = server.deps();
    await analyzed(server, deps);

    await expect(
      aiReviewGuidanceHandler(guidanceDeps(deps, [12, 30]), savedCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
      }),
    ).resolves.toMatchObject({ cards: [{ topic: "card 12" }, { topic: "card 30" }] });

    await expect(
      aiReviewGuidanceHandler(guidanceDeps(deps, [12]), savedCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
      }),
    ).rejects.toThrow(AI_GUIDANCE_UNAVAILABLE);

    await expect(
      aiReviewGuidanceHandler(guidanceDeps(deps, []), savedCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
      }),
    ).rejects.toThrow(AI_GUIDANCE_UNAVAILABLE);
  });

  it("counts duplicate persisted references once", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem({ guidanceIds: [12, 12, 30] })]);

    await expect(
      aiReviewGuidanceHandler(guidanceDeps(deps, [12, 30]), savedCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
      }),
    ).resolves.toMatchObject({ cards: [{ topic: "card 12" }, { topic: "card 30" }] });
  });
});

/* ------------------------------ 19/20/21/22. freshness, acknowledgment, finalize */

describe("Phase 9G acceptance — source freshness", () => {
  async function stale(): Promise<{ server: Server; deps: AiWorkspaceDeps }> {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);
    await affirmAiReviewItemAction(deps, savedCaller, {
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
    });
    server.mutateSources(savedCaller, "fp-sources-2");
    return { server, deps };
  }

  it("turns stale on a source change without running AI or touching review state", async () => {
    const { server, deps } = await stale();
    const state = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(state.sourceState).toBe("stale");
    expect(state.staleSourceAcknowledged).toBe(false);
    expect(state.reviewItems[0]!.state).toBe("resolved");
    expect(sourceFreshnessPresentation(state)).toMatchObject({
      tone: "stale",
      canAcknowledge: true,
    });
    expect(server.counters.createRun).toBe(1);
    expect(server.counters.authenticatedUsage).toBe(1);
  });

  it("acknowledges once, stays stale, and clears again when sources move (A→B→A)", async () => {
    const { server, deps } = await stale();
    const acknowledged = await acknowledgeAiStaleSourcesAction(deps, savedCaller, {
      expectedSourceSetFingerprint: "fp-sources-2",
    });
    expect(acknowledged.sourceState).toBe("stale");
    expect(acknowledged.staleSourceAcknowledged).toBe(true);
    expect(sourceFreshnessPresentation(acknowledged)).toMatchObject({ tone: "acknowledged" });
    expect(server.counters.reviewEvents).toContain("acknowledge");
    expect(server.counters.authenticatedUsage).toBe(1);

    // Back to exactly the analyzed set: the analysis is genuinely current again.
    server.mutateSources(savedCaller, "fp-sources-1");
    const back = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(back.sourceState).toBe("current");
    expect(sourceFreshnessPresentation(back)).toMatchObject({ tone: "current" });

    // A different set again: stale and unacknowledged, with no client history.
    server.mutateSources(savedCaller, "fp-sources-3");
    const moved = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(moved.sourceState).toBe("stale");
    expect(moved.staleSourceAcknowledged).toBe(false);
    expect(sourceFreshnessPresentation(moved)).toMatchObject({ canAcknowledge: true });
  });

  it("never lets staleness block finalization — only outstanding review does", async () => {
    const { deps } = await stale();
    const resolvedStale = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(resolvedStale.sourceState).toBe("stale");
    expect(aiReviewFinalizeBlock(resolvedStale)).toBeNull();

    const acknowledged = await acknowledgeAiStaleSourcesAction(deps, savedCaller, {
      expectedSourceSetFingerprint: "fp-sources-2",
    });
    expect(aiReviewFinalizeBlock(acknowledged)).toBeNull();

    // Only an open review item blocks, and it says so in review terms.
    const open = { ...acknowledged, reviewItems: [{ state: "yellow" }] };
    expect(aiReviewFinalizeBlock(open)).toContain("confirmation or resolution");
  });

  it("returns to current only after a deliberate re-analysis", async () => {
    const { server, deps } = await stale();
    const requested = await requestAiAnalysisHandler(deps, savedCaller);
    expect(requested.executionDisposition).toBe("start_execution");
    server.applyRun(savedCaller, "run-2", [yellowItem({ state: "resolved" })]);

    const state = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(state.sourceState).toBe("current");
    expect(state.lastSuccessfulRunId).toBe("run-2");
    expect(state.staleSourceAcknowledged).toBe(false);
    expect(server.counters.authenticatedUsage).toBe(2);
  });
});

/* --------------------------------------------------------- 27/28. quota */

describe("Phase 9G acceptance — allowance", () => {
  it("refuses an eleventh account run in the same UTC month", async () => {
    const server = new Server();
    const deps = server.deps();
    for (let index = 0; index < 10; index += 1) {
      await requestAiAnalysisHandler(deps, savedCaller);
      server.applyRun(savedCaller, `run-${index + 1}`, []);
    }
    const state = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(state.allowance).toMatchObject({ used: 10, remaining: 0 });
    await expect(requestAiAnalysisHandler(deps, savedCaller)).rejects.toThrow();
    expect(server.counters.createRun).toBe(10);
  });

  it("refuses a fourth guest run and keeps a second workspace independent", async () => {
    const server = new Server();
    const deps = server.deps();
    for (let index = 0; index < 3; index += 1) {
      await requestAiAnalysisHandler(deps, guestCaller);
      server.applyRun(guestCaller, `run-${index + 1}`, []);
    }
    await expect(requestAiAnalysisHandler(deps, guestCaller)).rejects.toThrow();

    const other = await aiWorkspaceStateHandler(deps, foreignGuestCaller);
    expect(other.hasAnalysis).toBe(false);
    expect(other.allowance.scope).toBe("guest");
  });

  it("spends the account allowance when a signed-in accountant works in a guest workspace", async () => {
    const server = new Server();
    const deps = server.deps();
    const signedInGuest: AiCallerScope = {
      kind: "guest",
      guestTokenHash: HASH_A,
      guestWorkspaceId: GUEST_A,
      authenticatedUserId: USER_A,
    };
    const state = await aiWorkspaceStateHandler(deps, signedInGuest);
    expect(state.allowance).toMatchObject({ scope: "authenticated", limit: 10 });
  });
});

/* ---------------------------------------- 29/47. zero-cost and no automatic AI */

describe("Phase 9G acceptance — no auxiliary action costs or starts an analysis", () => {
  it("keeps run creation and allowance flat across every auxiliary action", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem(), redItem()]);
    const runsAfterAnalysis = server.counters.createRun;
    const usageAfterAnalysis = server.counters.authenticatedUsage;

    await aiWorkspaceStateHandler(deps, savedCaller); // mount / refresh / navigation
    await affirmAiReviewItemAction(deps, savedCaller, {
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
    });
    await resolveAiReviewIssueAction(deps, savedCaller, {
      reviewItemId: "item-red",
      expectedReviewFingerprint: "fp-red",
      reason: "not_applicable",
    });
    await aiReviewEvidenceLinkHandler(evidenceDeps(server, deps), savedCaller, {
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
      citationIndex: 0,
    });
    await aiReviewGuidanceHandler(guidanceDeps(deps, [12, 30]), savedCaller, {
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
    });
    server.mutateSources(savedCaller, "fp-sources-2");
    await acknowledgeAiStaleSourcesAction(deps, savedCaller, {
      expectedSourceSetFingerprint: "fp-sources-2",
    });
    await aiWorkspaceStateHandler(deps, savedCaller); // restore dialog open / cancel

    expect(server.counters.createRun).toBe(runsAfterAnalysis);
    expect(server.counters.authenticatedUsage).toBe(usageAfterAnalysis);
    expect(server.counters.executeProvider).toBe(0);
  });
});

/* ----------------------------------------------- 30/31/32/34. restore matrix */

describe("Phase 9G acceptance — restore", () => {
  it("offers the current run only, and restores the exact pre-run draft", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    const preRunDraft = server.saved.canonicalInputs;
    server.applyRun(savedCaller, "run-1", [yellowItem()]);

    const offered = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(offered.restorableRun).toMatchObject({ runId: "run-1" });

    const restored = await restoreAiAnalysisHandler(deps as never, savedCaller, {
      expectedRunId: "run-1",
    });
    expect(restored.restoredRunId).toBe("run-1");
    expect(server.saved.canonicalInputs).toEqual(preRunDraft);
    // First-run restore removes the sidecar entirely.
    expect(restored.workspace.hasAnalysis).toBe(false);
    expect(restored.workspace.sourceState).toBe("none");
    expect(restored.workspace.reviewItems).toHaveLength(0);
    expect(restored.workspace.restorableRun).toBeNull();
    // History and allowance are untouched.
    expect(server.runs).toHaveLength(1);
    expect(server.counters.authenticatedUsage).toBe(1);
  });

  it("restores the exact acknowledged prior AI state after a re-analysis", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem({ state: "resolved" })]);
    server.mutateSources(savedCaller, "fp-sources-2");
    await acknowledgeAiStaleSourcesAction(deps, savedCaller, {
      expectedSourceSetFingerprint: "fp-sources-2",
    });
    const priorDraft = server.saved.canonicalInputs;

    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-2", [redItem()]);
    const current = await aiWorkspaceStateHandler(deps, savedCaller);
    expect(current.sourceState).toBe("current");

    const restored = await restoreAiAnalysisHandler(deps as never, savedCaller, {
      expectedRunId: "run-2",
    });
    expect(server.saved.canonicalInputs).toEqual(priorDraft);
    expect(restored.workspace.lastSuccessfulRunId).toBe("run-1");
    expect(restored.workspace.sourceState).toBe("stale");
    expect(restored.workspace.staleSourceAcknowledged).toBe(true);
    expect(sourceFreshnessPresentation(restored.workspace)).toMatchObject({
      tone: "acknowledged",
      headline: "Source changes acknowledged.",
    });
  });

  it("withdraws the offer while a run is active, once restored, and after a source change", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);

    server.mutateSources(savedCaller, "fp-sources-2");
    expect((await aiWorkspaceStateHandler(deps, savedCaller)).restorableRun).toBeNull();

    server.mutateSources(savedCaller, "fp-sources-1");
    expect((await aiWorkspaceStateHandler(deps, savedCaller)).restorableRun).not.toBeNull();

    await requestAiAnalysisHandler(deps, savedCaller);
    expect((await aiWorkspaceStateHandler(deps, savedCaller)).restorableRun).toBeNull();
  });

  it("applies one mutation for two rapid confirmations", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);

    const [first, second] = await Promise.allSettled([
      restoreAiAnalysisHandler(deps as never, savedCaller, { expectedRunId: "run-1" }),
      restoreAiAnalysisHandler(deps as never, savedCaller, { expectedRunId: "run-1" }),
    ]);
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(["fulfilled", "rejected"]);
    expect(server.runs.filter((run) => run.restoredAt !== null)).toHaveLength(1);
  });

  it("refuses a run that is not the offered one", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);
    await expect(
      restoreAiAnalysisHandler(deps as never, savedCaller, { expectedRunId: "run-other" }),
    ).rejects.toThrow(AI_RESTORE_UNAVAILABLE);
  });
});

/* ------------------------------------------------------ 37/38. isolation */

describe("Phase 9G acceptance — tenant isolation", () => {
  it("refuses every AI operation for another account, neutrally", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, savedCaller);
    server.applyRun(savedCaller, "run-1", [yellowItem()]);

    const attempts: Array<Promise<unknown>> = [
      aiWorkspaceStateHandler(deps, foreignCaller),
      requestAiAnalysisHandler(deps, foreignCaller),
      affirmAiReviewItemAction(deps, foreignCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
      }),
      resolveAiReviewIssueAction(deps, foreignCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
        reason: "not_applicable",
      }),
      acknowledgeAiStaleSourcesAction(deps, foreignCaller, {
        expectedSourceSetFingerprint: "fp-sources-1",
      }),
      aiReviewEvidenceLinkHandler(evidenceDeps(server, deps), foreignCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
        citationIndex: 0,
      }),
      aiReviewGuidanceHandler(guidanceDeps(deps, [12, 30]), foreignCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
      }),
      restoreAiAnalysisHandler(deps as never, foreignCaller, { expectedRunId: "run-1" }),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrow(
        /not available|not open for editing|could not be opened/,
      );
    }
    expect(server.counters.reviewEvents).toEqual([]);
    expect(server.counters.signedUrls).toBe(0);
    expect(server.counters.createRun).toBe(1);
  });

  it("keeps one guest workspace invisible to another and rejects an expired credential", async () => {
    const server = new Server();
    const deps = server.deps();
    await requestAiAnalysisHandler(deps, guestCaller);
    server.applyRun(guestCaller, "run-1", [yellowItem()]);

    const other = await aiWorkspaceStateHandler(deps, foreignGuestCaller);
    expect(other.hasAnalysis).toBe(false);
    expect(other.reviewItems).toHaveLength(0);
    await expect(
      affirmAiReviewItemAction(deps, foreignGuestCaller, {
        reviewItemId: "item-yellow",
        expectedReviewFingerprint: "fp-yellow",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);

    server.guest.editable = false; // expired / retired credential
    await expect(aiWorkspaceStateHandler(deps, guestCaller)).rejects.toThrow(
      AI_WORKSPACE_NOT_EDITABLE,
    );
  });
});
