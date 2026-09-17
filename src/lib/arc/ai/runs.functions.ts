/**
 * Phase 9C — the only AI run surface the browser may call.
 *
 * Exactly three functions exist: start, poll, allowance. There is no raw table
 * API, no structured-result API and no allowance-reservation API reachable
 * from the browser.
 *
 * Non-generative: `startAiAnalysis` establishes the run foundation and returns
 * a safe status. It does not extract PDFs, run preflight, reserve allowance,
 * set `openai_started_at` or contact OpenAI — Phase 9F owns that.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { GUIDANCE_REGISTRY_HASH } from "@/lib/arc/guidance/registry";
import type { AiRunExecutionStore } from "./orchestrator";
import {
  runStatusHandler,
  startAiAnalysisHandler,
  usageSummaryHandler,
  type AiCallerScope,
  type AiRunDeps,
  type AiRunStatusDto,
  type AiUsageSummaryDto,
} from "./runs.handlers";

async function runDeps(): Promise<AiRunDeps & { store: AiRunExecutionStore }> {
  const [{ createAiRunStore }, { AI_LIMITS }] = await Promise.all([
    import("./runs.store.server"),
    import("./config.server"),
  ]);
  return {
    store: await createAiRunStore(),
    limits: {
      // Server-controlled. The browser cannot raise its own allowance.
      guestRunLimit: AI_LIMITS.guestRunLimit,
      userMonthlyRunLimit: AI_LIMITS.userMonthlyRunLimit,
      model: AI_LIMITS.model,
      reasoningEffort: AI_LIMITS.reasoningEffort,
      promptVersion: AI_LIMITS.promptVersion,
      outputSchemaVersion: AI_LIMITS.outputSchemaVersion,
      guidanceRegistryHash: GUIDANCE_REGISTRY_HASH,
    },
    now: () => new Date(),
    newRunId: () => crypto.randomUUID(),
  };
}

/**
 * One shared caller-resolution implementation lives in `caller.server.ts`, so
 * the run surface and the Phase 9G workspace surface cannot drift into two
 * subtly different authentication rules. Behaviour is unchanged.
 */
async function callerFor(
  deps: AiRunDeps,
  requestedRevisionId: string | null,
): Promise<AiCallerScope> {
  const { resolveAiCallerFromRequest } = await import("./caller.server");
  return resolveAiCallerFromRequest(deps.store, requestedRevisionId);
}

const revisionTarget = (input: { revisionId?: string | null } | undefined) =>
  z
    .string()
    .uuid()
    .nullable()
    .parse(input?.revisionId ?? null);

/**
 * Creates, or re-returns, the one active run for the caller's owner scope.
 *
 * The only accepted input is the requested resource target. Fingerprint,
 * pre-run snapshots, lock version, owner identity and quota limits are all
 * server-derived, so hostile extra payload fields are simply discarded.
 */
export const startAiAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: { revisionId?: string | null } | undefined) => ({
    revisionId: revisionTarget(input),
  }))
  .handler(async ({ data }): Promise<AiRunStatusDto> => {
    const deps = await runDeps();
    const caller = await callerFor(deps, data.revisionId);
    return startAiAnalysisHandler(deps, caller);
  });

/**
 * Phase 9F — runs one created analysis to a terminal stage.
 *
 * Separate from `startAiAnalysis` so a lost response never starts a second
 * analysis: this call is re-entrant and a run that is no longer `created`
 * simply returns its current status.
 */
export const executeAiAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: { runId: string; revisionId?: string | null }) => ({
    runId: z.string().uuid().parse(input?.runId),
    revisionId: revisionTarget(input),
  }))
  .handler(async ({ data }): Promise<AiRunStatusDto> => {
    const deps = await runDeps();
    const caller = await callerFor(deps, data.revisionId);
    const [{ executeAiRunHandler }, { createExecutionBoundaries }] = await Promise.all([
      import("./orchestrator"),
      import("./orchestrator.server"),
    ]);
    return executeAiRunHandler({ ...deps, ...(await createExecutionBoundaries()) }, caller, {
      runId: data.runId,
    });
  });

/** Safe polling for a run the caller owns. */
export const getAiRunStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { runId: string; revisionId?: string | null }) => ({
    runId: z.string().uuid().parse(input?.runId),
    revisionId: revisionTarget(input),
  }))
  .handler(async ({ data }): Promise<AiRunStatusDto> => {
    const deps = await runDeps();
    const caller = await callerFor(deps, data.revisionId);
    return runStatusHandler(deps, caller, { runId: data.runId });
  });

/** The caller's own remaining allowance; never another account's. */
export const getAiUsageSummary = createServerFn({ method: "POST" })
  .inputValidator((input: { revisionId?: string | null } | undefined) => ({
    revisionId: revisionTarget(input),
  }))
  .handler(async ({ data }): Promise<AiUsageSummaryDto> => {
    const deps = await runDeps();
    const caller = await callerFor(deps, data.revisionId);
    return usageSummaryHandler(deps, caller);
  });
