/**
 * Phase 9G — Task 3. The safe AI workspace boundary, as dependency-injected
 * handlers.
 *
 * This module adds no AI execution engine, no queue and no second lifecycle.
 * It is a narrow, deliberately dull layer over three frozen systems:
 *   - the Phase 9C/9F run surface (`startAiAnalysisHandler`, run rows, quota);
 *   - the Task 1 review semantics already reflected in persisted state;
 *   - the Task 2 review-action handlers and their trusted routines.
 *
 * Authority rules are inherited unchanged: the caller scope is server-derived,
 * the browser names a resource target, a review item and the fingerprint of
 * what it displayed, and nothing else it sends is authoritative.
 *
 * Read operations are side-effect free by construction — no run is created, no
 * allowance is reserved, no lock moves, no audit event is written and no
 * provider is contacted.
 *
 * Browser-safe: no Supabase client, no service-role code, no server-only
 * import. The store boundary is injected.
 */

import { presentAiFailure, type AiFailurePresentation } from "./failure-presentation";
import {
  acknowledgeStaleSourcesHandler,
  affirmReviewItemHandler,
  resolveReviewIssueHandler,
  type AcknowledgeStaleSourcesInput,
  type AffirmReviewItemInput,
  type AiReviewActionStore,
  type ResolveReviewIssueInput,
} from "./review-actions.handlers";
import {
  isActiveStage,
  quotaScopeFor,
  startAiAnalysisHandler,
  usageSummaryHandler,
  utcMonthOf,
  AI_WORKSPACE_NOT_EDITABLE,
  type AiCallerScope,
  type AiQuotaScope,
  type AiRunDeps,
  type AiRunRow,
  type AiRunStage,
} from "./runs.handlers";

/* ------------------------------------------------------------------ DTOs */

/**
 * Presentation phases. The persisted lifecycle is unchanged; this is only the
 * browser's coarse view of it, so no internal stage name crosses the boundary.
 */
export type AiWorkspacePhase =
  "preparing" | "analyzing" | "validating" | "applying" | "succeeded" | "failed";

export interface AiWorkspaceRunDto {
  runId: string;
  phase: AiWorkspacePhase;
  active: boolean;
  sourceCount: number;
  pageCount: number;
  reviewIssueCount: number;
  completedAt: string | null;
}

export interface AiWorkspaceAllowanceDto {
  scope: AiQuotaScope;
  limit: number;
  used: number;
  remaining: number;
  /**
   * When the allowance next becomes available: the first instant of the next
   * UTC month for an account, and the temporary workspace's own expiry for a
   * guest. Deterministic server-side; the browser never computes it.
   */
  resetAt: string | null;
}

export interface AiWorkspaceStateDto {
  /** A successful AI analysis exists for this scope. */
  hasAnalysis: boolean;
  activeRun: AiWorkspaceRunDto | null;
  latestRun: AiWorkspaceRunDto | null;
  lastSuccessfulRunId: string | null;
  sourceState: "none" | "current" | "stale";
  /**
   * The authoritative current source-set fingerprint. It crosses to the
   * browser for one reason only: it is the optimistic precondition an approved
   * Task 2 acknowledgment echoes back. The server re-derives it either way, so
   * it never becomes authoritative.
   */
  sourceSetFingerprint: string | null;
  reviewIssueCount: number;
  staleSourceAcknowledged: boolean;
  allowance: AiWorkspaceAllowanceDto;
  failure: AiFailurePresentation | null;
}

/**
 * Phase 9G — Task 5. Whether the deliberate action that made this request owns
 * the execution of a newly created run, or simply rejoined a run that was
 * already active. Derived on the server from persisted lifecycle facts; it
 * exposes no stage name, no provider detail and no new authority.
 */
export type AiExecutionDisposition = "start_execution" | "reconnect";

export interface AiAnalysisRequestDto extends AiWorkspaceStateDto {
  executionDisposition: AiExecutionDisposition;
}

/* ------------------------------------------------------------ store shape */

/** A run row plus the trusted failure facts the registry selects from. */
export interface AiWorkspaceRunRecord extends AiRunRow {
  failureStage: string | null;
  failureCategory: string | null;
  failureCode: string | null;
  /** True once the provider-start boundary was crossed for this run. */
  allowanceConsumed: boolean;
}

export interface AiWorkspaceSnapshot {
  lastSuccessfulRunId: string | null;
  /** Server-derived fingerprint of the currently selected documents. */
  currentSourceSetFingerprint: string | null;
  sourceState: "none" | "current" | "stale";
  acknowledgedSourceFingerprint: string | null;
  outstandingReviewIssueCount: number;
  /** Temporary workspaces only; null for a saved analysis. */
  guestWorkspaceExpiresAt: string | null;
}

export interface AiWorkspaceStore extends AiReviewActionStore {
  loadWorkspaceSnapshot(caller: AiCallerScope): Promise<AiWorkspaceSnapshot>;
  findLatestRunForScope(scope: {
    revisionId: string | null;
    guestWorkspaceId: string | null;
  }): Promise<AiWorkspaceRunRecord | null>;
}

export interface AiWorkspaceDeps extends Omit<AiRunDeps, "store"> {
  store: AiWorkspaceStore;
}

/* ------------------------------------------------------------- internals */

function phaseOf(stage: AiRunStage): AiWorkspacePhase {
  switch (stage) {
    case "created":
    case "extracting":
    case "preflight_ready":
      return "preparing";
    case "analyzing":
      return "analyzing";
    case "validating":
      return "validating";

    case "applying":
      return "applying";
    case "succeeded":
      return "succeeded";
    default:
      return "failed";
  }
}

/** Exhaustive by construction: only these fields ever cross to the browser. */
function runDto(run: AiWorkspaceRunRecord): AiWorkspaceRunDto {
  return {
    runId: run.id,
    phase: phaseOf(run.stage),
    active: isActiveStage(run.stage),
    sourceCount: run.sourceCount,
    pageCount: run.pageCount,
    reviewIssueCount: run.reviewIssueCount,
    completedAt: run.completedAt,
  };
}

function scopeOf(caller: AiCallerScope): {
  revisionId: string | null;
  guestWorkspaceId: string | null;
} {
  return caller.kind === "revision"
    ? { revisionId: caller.revisionId, guestWorkspaceId: null }
    : { revisionId: null, guestWorkspaceId: caller.guestWorkspaceId };
}

/** First instant of the next UTC month. */
function nextUtcMonthStart(now: Date): string {
  const month = utcMonthOf(now);
  const [year, monthNumber] = month.split("-").map(Number) as [number, number, number];
  return new Date(
    Date.UTC(monthNumber === 12 ? year + 1 : year, monthNumber === 12 ? 0 : monthNumber, 1),
  ).toISOString();
}

/**
 * Re-proves that the caller still owns an editable scope before anything is
 * read. Knowing a revision id or a run id proves nothing on its own.
 */
async function assertEditableScope(store: AiWorkspaceStore, caller: AiCallerScope): Promise<void> {
  if (caller.kind === "revision") {
    const revision = await store.findEditableRevision(caller.revisionId, caller.userId);
    if (!revision) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
    return;
  }
  const workspace = await store.findActiveGuestWorkspace(caller.guestTokenHash);
  if (!workspace) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
}

/* ---------------------------------------------------------------- reads */

/**
 * The one authoritative workspace read.
 *
 * Safe to repeat indefinitely: it creates nothing, charges nothing, writes
 * nothing and contacts no provider.
 */
export async function aiWorkspaceStateHandler(
  deps: AiWorkspaceDeps,
  caller: AiCallerScope,
): Promise<AiWorkspaceStateDto> {
  await assertEditableScope(deps.store, caller);

  const scope = scopeOf(caller);
  const [snapshot, latest, usage] = await Promise.all([
    deps.store.loadWorkspaceSnapshot(caller),
    deps.store.findLatestRunForScope(scope),
    usageSummaryHandler({ ...deps, store: deps.store }, caller),
  ]);

  const active = latest && isActiveStage(latest.stage) ? latest : null;
  const hasAnalysis = snapshot.lastSuccessfulRunId !== null;

  // A failure presentation exists only for a terminal failed run, and it is
  // selected from persisted lifecycle facts — never from persisted copy.
  const presented =
    latest && !isActiveStage(latest.stage) && latest.stage !== "succeeded"
      ? presentAiFailure({
          failureCategory: latest.failureCategory,
          failureCode: latest.failureCode,
          hadPriorSuccessfulAnalysis: hasAnalysis,
          allowanceConsumed: latest.allowanceConsumed,
        })
      : null;

  // "No analyses remaining" is a statement about right now, not about the
  // month that run failed in. The immutable run stays exactly as recorded; the
  // presentation defers to the authoritative current allowance, so a UTC-month
  // reset cannot leave the browser holding two contradictory truths.
  const failure =
    presented && presented.category === "allowance_exhausted" && usage.remaining > 0
      ? null
      : presented;

  return {
    hasAnalysis,
    activeRun: active ? runDto(active) : null,
    latestRun: latest ? runDto(latest) : null,
    lastSuccessfulRunId: snapshot.lastSuccessfulRunId,
    sourceState: snapshot.sourceState,
    sourceSetFingerprint: snapshot.currentSourceSetFingerprint,
    reviewIssueCount: snapshot.outstandingReviewIssueCount,
    staleSourceAcknowledged:
      snapshot.acknowledgedSourceFingerprint !== null &&
      snapshot.acknowledgedSourceFingerprint === snapshot.currentSourceSetFingerprint,
    allowance: {
      scope: usage.scope,
      limit: usage.limit,
      used: usage.used,
      remaining: usage.remaining,
      resetAt:
        quotaScopeFor(caller) === "authenticated"
          ? nextUtcMonthStart(deps.now())
          : snapshot.guestWorkspaceExpiresAt,
    },
    failure,
  };
}

/* --------------------------------------------------------------- actions */

/**
 * The deliberate Analyze / Re-analyze request.
 *
 * It delegates to the frozen Phase 9C creation boundary, so an owner scope
 * that already has an active run gets that run back: a second click never
 * starts a second analysis. Execution stays a separate, explicit call — this
 * operation contacts no provider and reserves no allowance.
 */
export async function requestAiAnalysisHandler(
  deps: AiWorkspaceDeps,
  caller: AiCallerScope,
): Promise<AiAnalysisRequestDto> {
  await assertEditableScope(deps.store, caller);

  // Server-derived disposition. The browser must never decide whether it is
  // starting a new analysis or rejoining one already running: it cannot see
  // run history, and elapsed time, run ids and React state prove nothing.
  const before = await deps.store.findLatestRunForScope(scopeOf(caller));
  const reconnect = before !== null && isActiveStage(before.stage);

  await startAiAnalysisHandler({ ...deps, store: deps.store }, caller);
  const state = await aiWorkspaceStateHandler(deps, caller);
  return { ...state, executionDisposition: reconnect ? "reconnect" : "start_execution" };
}

/** Yellow affirmation. The accepted Task 2 handler decides everything. */
export async function affirmAiReviewItemAction(
  deps: AiWorkspaceDeps,
  caller: AiCallerScope,
  input: AffirmReviewItemInput,
): Promise<AiWorkspaceStateDto> {
  await affirmReviewItemHandler({ store: deps.store }, caller, input);
  return aiWorkspaceStateHandler(deps, caller);
}

/** Manual resolution of one red issue. */
export async function resolveAiReviewIssueAction(
  deps: AiWorkspaceDeps,
  caller: AiCallerScope,
  input: ResolveReviewIssueInput,
): Promise<AiWorkspaceStateDto> {
  await resolveReviewIssueHandler({ store: deps.store }, caller, input);
  return aiWorkspaceStateHandler(deps, caller);
}

/** Stale-source acknowledgment against the displayed fingerprint. */
export async function acknowledgeAiStaleSourcesAction(
  deps: AiWorkspaceDeps,
  caller: AiCallerScope,
  input: AcknowledgeStaleSourcesInput,
): Promise<AiWorkspaceStateDto> {
  await acknowledgeStaleSourcesHandler({ store: deps.store }, caller, input);
  return aiWorkspaceStateHandler(deps, caller);
}
