/**
 * Phase 9C — AI run orchestration foundation, as dependency-injected handlers.
 *
 * Non-generative. Nothing in this module extracts a PDF, builds a request,
 * counts tokens, reserves allowance or calls OpenAI: Phase 9F owns that
 * orchestration. What is settled here is the part that must be right *before*
 * generation is attached — who owns a run, which allowance scope applies, what
 * the browser is allowed to see, and what a second click does.
 *
 * Authority rules that hold everywhere in this module:
 *   - caller identity is derived by the server (session bearer token and the
 *     HttpOnly guest credential) and is never read from the request payload;
 *   - the browser supplies only a requested resource target (a revision id, a
 *     run id) and never an owner id, a guest token hash or a quota limit;
 *   - the trusted database routines decide creation, allowance and lifecycle.
 *
 * Browser-safe: no Supabase client, no service-role code, no server-only
 * import. The store boundary is injected.
 */

/* ------------------------------------------------------------- identity */

/**
 * Server-derived internal caller identity. The browser cannot manufacture
 * this object: every field is produced by the server from the session token
 * or the HttpOnly guest credential, after the resource target was verified.
 */
export type AiCallerScope =
  | {
      kind: "revision";
      userId: string;
      revisionId: string;
      contractId: string;
    }
  | {
      kind: "guest";
      guestTokenHash: string;
      guestWorkspaceId: string;
      /** Set when a real session exists while working in a temporary workspace. */
      authenticatedUserId: string | null;
    };

export type AiQuotaScope = "authenticated" | "guest";

/** A signed-in caller in a temporary workspace spends the account allowance. */
export function quotaScopeFor(caller: AiCallerScope): AiQuotaScope {
  if (caller.kind === "revision") return "authenticated";
  return caller.authenticatedUserId ? "authenticated" : "guest";
}

/* ------------------------------------------------------------------ DTOs */

export type AiRunStage =
  | "created"
  | "extracting"
  | "preflight_ready"
  | "analyzing"
  | "validating"
  | "applying"
  | "succeeded"
  | "preflight_failed"
  | "api_failed"
  | "response_invalid"
  | "application_failed";

export interface AiRunStatusDto {
  runId: string;
  stage: AiRunStage;
  sourceCount: number;
  pageCount: number;
  inputTokens: number | null;
  remainingAllowance: number;
  reviewIssueCount: number;
  completedAt: string | null;
  safeError: string | null;
}

export interface AiUsageSummaryDto {
  scope: AiQuotaScope;
  limit: number;
  used: number;
  remaining: number;
  /** First day of the UTC month the account allowance is counted in. */
  utcMonth: string | null;
}

/* -------------------------------------------------------------- boundary */

/** Internal run row. Never returned to the browser. */
export interface AiRunRow {
  id: string;
  stage: AiRunStage;
  revisionId: string | null;
  guestWorkspaceId: string | null;
  ownerUserId: string | null;
  guestTokenHash: string | null;
  quotaScope: AiQuotaScope;
  sourceCount: number;
  pageCount: number;
  inputTokens: number | null;
  reviewIssueCount: number;
  completedAt: string | null;
  safeMessage: string | null;
}

export interface AiRunCreateArgs {
  runId: string;
  ownerUserId: string | null;
  guestTokenHash: string | null;
  revisionId: string | null;
  guestWorkspaceId: string | null;
  expectedLockVersion: number | null;
  quotaScope: AiQuotaScope;
  sourceSetFingerprint: string;
  preRunCanonicalInputs: unknown;
  preRunAiState: unknown;
  model: string;
  reasoningEffort: string;
  promptVersion: string;
  outputSchemaVersion: string;
  guidanceRegistryHash: string;
}

export interface AiRunStore {
  /** Draft revision owned by this user, through analysis → contract → customer. */
  findEditableRevision(
    revisionId: string,
    userId: string,
  ): Promise<{ id: string; contractId: string; lockVersion: number } | null>;
  /** Active, unexpired temporary workspace for this credential hash. */
  findActiveGuestWorkspace(
    tokenHash: string,
  ): Promise<{ id: string; lockVersion: number } | null>;
  findActiveRunForScope(scope: {
    revisionId: string | null;
    guestWorkspaceId: string | null;
  }): Promise<AiRunRow | null>;
  findRun(runId: string): Promise<AiRunRow | null>;
  /** Trusted `arc_create_ai_run`; returns the surviving active run id. */
  createRun(args: AiRunCreateArgs): Promise<string>;
  monthlyUsage(userId: string, utcMonth: string): Promise<number>;
  guestConsumed(guestWorkspaceId: string): Promise<number>;
}

export interface AiRunLimits {
  guestRunLimit: number;
  userMonthlyRunLimit: number;
  model: string;
  reasoningEffort: string;
  promptVersion: string;
  outputSchemaVersion: string;
  guidanceRegistryHash: string;
}

export interface AiRunDeps {
  store: AiRunStore;
  limits: AiRunLimits;
  now: () => Date;
  newRunId: () => string;
}

export const AI_RUN_NOT_AVAILABLE = "That AI analysis is not available.";
export const AI_WORKSPACE_NOT_EDITABLE =
  "This analysis is not open for editing, so an AI analysis cannot be started.";

/** First day of the caller's UTC month, as `YYYY-MM-DD`. */
export function utcMonthOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

const ACTIVE_STAGES: ReadonlySet<AiRunStage> = new Set<AiRunStage>([
  "created",
  "extracting",
  "preflight_ready",
  "analyzing",
  "validating",
  "applying",
]);

export function isActiveStage(stage: AiRunStage): boolean {
  return ACTIVE_STAGES.has(stage);
}

/* -------------------------------------------------------- authorization */

/**
 * A run is readable only by the scope that owns it. Knowing a run's UUID
 * proves nothing.
 */
export function runBelongsToCaller(run: AiRunRow, caller: AiCallerScope): boolean {
  if (caller.kind === "revision") {
    return run.revisionId === caller.revisionId && run.ownerUserId === caller.userId;
  }
  return (
    run.guestWorkspaceId === caller.guestWorkspaceId &&
    run.guestTokenHash === caller.guestTokenHash
  );
}

async function remainingAllowance(deps: AiRunDeps, caller: AiCallerScope): Promise<number> {
  const summary = await usageSummaryHandler(deps, caller);
  return summary.remaining;
}

function statusDto(run: AiRunRow, remaining: number): AiRunStatusDto {
  // Exhaustive by construction: only these fields ever cross to the browser.
  return {
    runId: run.id,
    stage: run.stage,
    sourceCount: run.sourceCount,
    pageCount: run.pageCount,
    inputTokens: run.inputTokens,
    remainingAllowance: remaining,
    reviewIssueCount: run.reviewIssueCount,
    completedAt: run.completedAt,
    safeError: run.safeMessage,
  };
}

/* ----------------------------------------------------------- operations */

/**
 * Phase 9C `startAiAnalysis`: establishes the run foundation only.
 *
 * An owner scope that already has an active run gets that same run back — a
 * second click never starts a second analysis. The partial unique indexes in
 * Postgres are the final backstop; this reuse is deliberate control flow, not
 * error recovery.
 */
export async function startAiAnalysisHandler(
  deps: AiRunDeps,
  caller: AiCallerScope,
  input: { sourceSetFingerprint?: string; preRunCanonicalInputs?: unknown } = {},
): Promise<AiRunStatusDto> {
  const scope =
    caller.kind === "revision"
      ? { revisionId: caller.revisionId, guestWorkspaceId: null }
      : { revisionId: null, guestWorkspaceId: caller.guestWorkspaceId };

  const existing = await deps.store.findActiveRunForScope(scope);
  if (existing && isActiveStage(existing.stage)) {
    return statusDto(existing, await remainingAllowance(deps, caller));
  }

  const quotaScope = quotaScopeFor(caller);
  const runId = await deps.store.createRun({
    runId: deps.newRunId(),
    // Identity is taken from the derived caller, never from `input`.
    ownerUserId:
      caller.kind === "revision" ? caller.userId : (caller.authenticatedUserId ?? null),
    guestTokenHash: caller.kind === "guest" ? caller.guestTokenHash : null,
    revisionId: caller.kind === "revision" ? caller.revisionId : null,
    guestWorkspaceId: caller.kind === "guest" ? caller.guestWorkspaceId : null,
    expectedLockVersion: null,
    quotaScope,
    sourceSetFingerprint: input.sourceSetFingerprint ?? "",
    preRunCanonicalInputs: input.preRunCanonicalInputs ?? {},
    preRunAiState: null,
    model: deps.limits.model,
    reasoningEffort: deps.limits.reasoningEffort,
    promptVersion: deps.limits.promptVersion,
    outputSchemaVersion: deps.limits.outputSchemaVersion,
    guidanceRegistryHash: deps.limits.guidanceRegistryHash,
  });

  const run = await deps.store.findRun(runId);
  if (!run) throw new Error(AI_RUN_NOT_AVAILABLE);
  return statusDto(run, await remainingAllowance(deps, caller));
}

/** Safe polling. A run the caller does not own is simply not available. */
export async function runStatusHandler(
  deps: AiRunDeps,
  caller: AiCallerScope,
  input: { runId: string },
): Promise<AiRunStatusDto> {
  const run = await deps.store.findRun(input.runId);
  if (!run || !runBelongsToCaller(run, caller)) throw new Error(AI_RUN_NOT_AVAILABLE);
  return statusDto(run, await remainingAllowance(deps, caller));
}

/**
 * The caller's own allowance. The scope, the limit and the counted usage are
 * all decided server-side; the browser cannot ask about another account.
 */
export async function usageSummaryHandler(
  deps: AiRunDeps,
  caller: AiCallerScope,
): Promise<AiUsageSummaryDto> {
  const scope = quotaScopeFor(caller);
  if (scope === "authenticated") {
    const userId = caller.kind === "revision" ? caller.userId : caller.authenticatedUserId!;
    const utcMonth = utcMonthOf(deps.now());
    const used = await deps.store.monthlyUsage(userId, utcMonth);
    const limit = deps.limits.userMonthlyRunLimit;
    return { scope, limit, used, remaining: Math.max(limit - used, 0), utcMonth };
  }
  const workspaceId = (caller as Extract<AiCallerScope, { kind: "guest" }>).guestWorkspaceId;
  const used = await deps.store.guestConsumed(workspaceId);
  const limit = deps.limits.guestRunLimit;
  return { scope, limit, used, remaining: Math.max(limit - used, 0), utcMonth: null };
}

/* ------------------------------------------------- caller derivation */

export interface AiCallerRequest {
  /** Verified session subject, or null for an anonymous visitor. */
  authenticatedUserId: string | null;
  /** SHA-256 of the HttpOnly guest credential, or null. */
  guestTokenHash: string | null;
  /** Resource the browser asked for. Never an ownership claim. */
  requestedRevisionId: string | null;
}

/**
 * Turns a verified session and credential into an internal caller scope.
 *
 * Ownership is always re-resolved here: a requested revision id is only a
 * target, and it is accepted solely when the persistence chain
 * revision → analysis → contract → customer → owner resolves to this session.
 */
export async function deriveAiCaller(
  store: AiRunStore,
  request: AiCallerRequest,
): Promise<AiCallerScope> {
  if (request.requestedRevisionId) {
    if (!request.authenticatedUserId) throw new Error(AI_RUN_NOT_AVAILABLE);
    const revision = await store.findEditableRevision(
      request.requestedRevisionId,
      request.authenticatedUserId,
    );
    if (!revision) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
    return {
      kind: "revision",
      userId: request.authenticatedUserId,
      revisionId: revision.id,
      contractId: revision.contractId,
    };
  }

  if (!request.guestTokenHash) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
  const workspace = await store.findActiveGuestWorkspace(request.guestTokenHash);
  if (!workspace) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
  return {
    kind: "guest",
    guestTokenHash: request.guestTokenHash,
    guestWorkspaceId: workspace.id,
    authenticatedUserId: request.authenticatedUserId,
  };
}
