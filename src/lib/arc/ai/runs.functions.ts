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
import { readGuestCookie } from "@/lib/arc/persistence/guest";

import {
  deriveAiCaller,
  runStatusHandler,
  startAiAnalysisHandler,
  usageSummaryHandler,
  type AiCallerRequest,
  type AiCallerScope,
  type AiRunDeps,
  type AiRunStatusDto,
  type AiUsageSummaryDto,
} from "./runs.handlers";

/** True on https; local http development falls back to a non-`__Host-` name. */
function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Optional session identity.
 *
 * An AI run can be started from a saved analysis (session required) or from a
 * temporary workspace (session optional), so the bearer token is verified when
 * present instead of being required by middleware. An absent or invalid token
 * simply yields an anonymous caller; it never upgrades one.
 */
async function verifiedUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token.split(".").length !== 3) return null;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}

async function runDeps(): Promise<AiRunDeps> {
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
 * Builds the caller from server-held evidence only: the verified session
 * subject and the hash of the HttpOnly credential. `requestedRevisionId` is a
 * resource target, and ownership of it is proven inside `deriveAiCaller`.
 */
async function callerFor(
  deps: AiRunDeps,
  requestedRevisionId: string | null,
): Promise<AiCallerScope> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
  const rawToken = readGuestCookie(request.headers.get("cookie"), secure);

  const identity: AiCallerRequest = {
    authenticatedUserId: await verifiedUserId(request),
    guestTokenHash: rawToken
      ? await (await import("@/lib/arc/persistence/guest")).hashGuestToken(rawToken)
      : null,
    requestedRevisionId,
  };
  return deriveAiCaller(deps.store, identity);
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
