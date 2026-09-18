/**
 * Phase 9G — Task 9. Three more safe server functions, on exactly the accepted
 * Task 3 pattern: a resource target, the fingerprint of what was displayed, and
 * nothing else authoritative.
 *
 *   - open the source page behind one citation of one review item;
 *   - read the approved Guidance behind one review item;
 *   - restore the draft to the exact pre-run snapshot of the offered run.
 *
 * Both edges are sanitised by `workspace.boundary`, so only allowlisted ARC
 * copy can cross back. No provider is contacted and no allowance is consumed
 * by any of them.
 */

import { createServerFn } from "@tanstack/react-start";

import { GUIDANCE_REGISTRY_HASH } from "@/lib/arc/guidance/registry";

import {
  restoreAiAnalysisHandler,
  type AiRestoreDeps,
  type AiRestoreResultDto,
} from "./restore.handlers";
import {
  aiReviewEvidenceLinkHandler,
  aiReviewGuidanceHandler,
  type AiEvidenceLinkDto,
  type AiReviewGuidanceDto,
} from "./review-evidence.handlers";
import {
  parseCitationIndex,
  parseRestoreRunId,
  parseReviewItemTarget,
  parseRevisionTarget,
  safeWorkspaceCall,
} from "./workspace.boundary";
import type { AiWorkspaceDeps } from "./workspace.handlers";
import type { AiCallerScope } from "./runs.handlers";

async function workspaceDeps(): Promise<AiWorkspaceDeps> {
  const [{ createAiWorkspaceStore }, { AI_LIMITS }] = await Promise.all([
    import("./workspace.store.server"),
    import("./config.server"),
  ]);
  return {
    store: await createAiWorkspaceStore(),
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
 * A short-lived signed view link for the page a citation points at. The
 * document identity is resolved server-side from the validated review item.
 */
export const openAiReviewEvidence = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      reviewItemId: string;
      expectedReviewFingerprint: string;
      citationIndex: number;
      revisionId?: string | null;
    }) => ({
      ...parseReviewItemTarget(input),
      citationIndex: parseCitationIndex(input),
      revisionId: parseRevisionTarget(input),
    }),
  )
  .handler(async ({ data }): Promise<AiEvidenceLinkDto> =>
    safeWorkspaceCall(async () => {
      const deps = await workspaceDeps();
      const { createAiEvidenceDocumentAccess } = await import("./review-evidence.store.server");
      return aiReviewEvidenceLinkHandler(
        { store: deps.store, documents: await createAiEvidenceDocumentAccess() },
        await callerFor(deps, data.revisionId),
        {
          reviewItemId: data.reviewItemId,
          expectedReviewFingerprint: data.expectedReviewFingerprint,
          citationIndex: data.citationIndex,
        },
      );
    }),
  );

/** The approved Guidance the AI consulted for one review point. */
export const getAiReviewGuidance = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      reviewItemId: string;
      expectedReviewFingerprint: string;
      revisionId?: string | null;
    }) => ({
      ...parseReviewItemTarget(input),
      revisionId: parseRevisionTarget(input),
    }),
  )
  .handler(async ({ data }): Promise<AiReviewGuidanceDto> =>
    safeWorkspaceCall(async () => {
      const deps = await workspaceDeps();
      const { createAiGuidanceAccess } = await import("./review-evidence.store.server");
      return aiReviewGuidanceHandler(
        { store: deps.store, guidance: createAiGuidanceAccess() },
        await callerFor(deps, data.revisionId),
        {
          reviewItemId: data.reviewItemId,
          expectedReviewFingerprint: data.expectedReviewFingerprint,
        },
      );
    }),
  );

/** The deliberate whole-run restore, against the run the browser confirmed. */
export const restoreAiAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: { expectedRunId: string; revisionId?: string | null }) => ({
    expectedRunId: parseRestoreRunId(input),
    revisionId: parseRevisionTarget(input),
  }))
  .handler(async ({ data }): Promise<AiRestoreResultDto> =>
    safeWorkspaceCall(async () => {
      const deps = (await workspaceDeps()) as AiRestoreDeps;
      return restoreAiAnalysisHandler(deps, await callerFor(deps, data.revisionId), {
        expectedRunId: data.expectedRunId,
      });
    }),
  );
