/**
 * Phase 9G — Task 3. The safe AI workspace surface the browser may call.
 *
 * Five functions: one read, one deliberate analysis request and the three
 * accepted Task 2 review actions. There is no generic "write AI state"
 * function, no bulk red resolution, no raw table API and no provider API.
 *
 * Every input is a resource target, a review item identity, an approved
 * enumerated choice or the fingerprint of what the browser displayed. Owner
 * identity, actor identity, quota, lock versions, timestamps, source
 * fingerprints and provider configuration are all derived on the server, so
 * hostile extra payload fields are simply discarded.
 *
 * Both edges are sanitised by `workspace.boundary`: input is parsed by pure
 * helpers that refuse with settled ARC copy, and every handler runs inside
 * `safeWorkspaceCall`, so nothing but an allowlisted ARC message can cross the
 * RPC boundary back to the browser.
 */

import { createServerFn } from "@tanstack/react-start";

import { GUIDANCE_REGISTRY_HASH } from "@/lib/arc/guidance/registry";

import {
  parseAffirmationMethod,
  parseManualRedReason,
  parseReviewItemTarget,
  parseReviewNote,
  parseRevisionTarget,
  parseSourceFingerprint,
  safeWorkspaceCall,
} from "./workspace.boundary";
import {
  acknowledgeAiStaleSourcesAction,
  affirmAiReviewItemAction,
  aiWorkspaceStateHandler,
  requestAiAnalysisHandler,
  resolveAiReviewIssueAction,
  type AiWorkspaceDeps,
  type AiWorkspaceStateDto,
} from "./workspace.handlers";
import type { AiCallerScope } from "./runs.handlers";

async function workspaceDeps(): Promise<AiWorkspaceDeps> {
  const [{ createAiWorkspaceStore }, { AI_LIMITS }] = await Promise.all([
    import("./workspace.store.server"),
    import("./config.server"),
  ]);
  return {
    store: await createAiWorkspaceStore(),
    // Server-controlled. The browser cannot raise its own allowance or choose
    // any part of the provider configuration.
    limits: { ...AI_LIMITS, guidanceRegistryHash: GUIDANCE_REGISTRY_HASH },
    now: () => new Date(),
    newRunId: () => crypto.randomUUID(),
  };
}

async function callerFor(
  deps: AiWorkspaceDeps,
  requestedRevisionId: string | null,
): Promise<AiCallerScope> {
  const { resolveAiCallerFromRequest } = await import("./caller.server");
  return resolveAiCallerFromRequest(deps.store, requestedRevisionId);
}

/**
 * The one authoritative workspace read. Side-effect free: it starts nothing,
 * charges nothing, writes nothing and contacts no provider, so it is safe to
 * poll indefinitely.
 */
export const getAiWorkspaceState = createServerFn({ method: "POST" })
  .inputValidator((input: { revisionId?: string | null } | undefined) => ({
    revisionId: parseRevisionTarget(input),
  }))
  .handler(async ({ data }): Promise<AiWorkspaceStateDto> =>
    safeWorkspaceCall(async () => {
      const deps = await workspaceDeps();
      return aiWorkspaceStateHandler(deps, await callerFor(deps, data.revisionId));
    }),
  );

/**
 * The deliberate Analyze / Re-analyze request. Never triggered by an edit, a
 * navigation or a read; a second click during an active run reuses that run.
 */
export const requestAiAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: { revisionId?: string | null } | undefined) => ({
    revisionId: parseRevisionTarget(input),
  }))
  .handler(async ({ data }): Promise<AiWorkspaceStateDto> =>
    safeWorkspaceCall(async () => {
      const deps = await workspaceDeps();
      return requestAiAnalysisHandler(deps, await callerFor(deps, data.revisionId));
    }),
  );

/** Yellow affirmation of one displayed conclusion. */
export const affirmAiReviewItem = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      reviewItemId: string;
      expectedReviewFingerprint: string;
      method?: string;
      revisionId?: string | null;
    }) => ({
      ...parseReviewItemTarget(input),
      method: parseAffirmationMethod(input),
      revisionId: parseRevisionTarget(input),
    }),
  )
  .handler(async ({ data }): Promise<AiWorkspaceStateDto> =>
    safeWorkspaceCall(async () => {
      const deps = await workspaceDeps();
      return affirmAiReviewItemAction(deps, await callerFor(deps, data.revisionId), {
        reviewItemId: data.reviewItemId,
        expectedReviewFingerprint: data.expectedReviewFingerprint,
        method: data.method,
      });
    }),
  );

/** Manual resolution of one red AI review issue. */
export const resolveAiReviewIssue = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      reviewItemId: string;
      expectedReviewFingerprint: string;
      reason: string;
      note?: string | null;
      revisionId?: string | null;
    }) => ({
      ...parseReviewItemTarget(input),
      reason: parseManualRedReason(input),
      note: parseReviewNote(input),
      revisionId: parseRevisionTarget(input),
    }),
  )
  .handler(async ({ data }): Promise<AiWorkspaceStateDto> =>
    safeWorkspaceCall(async () => {
      const deps = await workspaceDeps();
      return resolveAiReviewIssueAction(deps, await callerFor(deps, data.revisionId), {
        reviewItemId: data.reviewItemId,
        expectedReviewFingerprint: data.expectedReviewFingerprint,
        reason: data.reason,
        note: data.note,
      });
    }),
  );

/**
 * Stale-source acknowledgment. The browser echoes the fingerprint it showed;
 * the trusted routine re-derives the authoritative one and fails closed.
 */
export const acknowledgeAiStaleSources = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { expectedSourceSetFingerprint: string; revisionId?: string | null }) => ({
      expectedSourceSetFingerprint: parseSourceFingerprint(input),
      revisionId: parseRevisionTarget(input),
    }),
  )
  .handler(async ({ data }): Promise<AiWorkspaceStateDto> =>
    safeWorkspaceCall(async () => {
      const deps = await workspaceDeps();
      return acknowledgeAiStaleSourcesAction(deps, await callerFor(deps, data.revisionId), {
        expectedSourceSetFingerprint: data.expectedSourceSetFingerprint,
      });
    }),
  );
