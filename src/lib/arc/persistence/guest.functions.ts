/**
 * Phase 7E — guest workspace server functions.
 *
 * Guest CRUD is server-only: `guest_workspaces` grants no direct anon or
 * authenticated access, so every read and write here runs through the
 * service-role client, loaded inside the handler. Authorization is the
 * HttpOnly cookie credential and the row's `expires_at`, checked on every
 * call.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkflowDraft } from "@/lib/asc606-workflow";

import { createDemoDraftIfKnown, getDemoScenario, isDemoScenarioId } from "@/lib/demo-scenarios";

import { buildGuestCookie } from "./guest";
import {
  GUEST_ANALYSIS_UNAVAILABLE,
  migrateGuestWorkspaceHandler,
  resumeGuestAnalysisHandler,
  saveGuestDraftHandler,
  type GuestMigrationResult,
  type GuestSaveResult,
  type GuestStore,
} from "./guest.handlers";
import {
  createAnalysisHandler,
  isNewAnalysisOrigin,
  listRecentAnalysesHandler,
  type RecentAnalysisDto,
} from "./guest-session.handlers";

export type { RecentAnalysisDto } from "./guest-session.handlers";

export interface GuestWorkspaceDto {
  kind: "guest";
  draft: WorkflowDraft;
  lockVersion: number;
  /** When this temporary workspace and its credential stop working. */
  expiresAt: string;
  schemaVersion: string;
  resumed: boolean;
}

async function setCookieHeader(value: string) {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Set-Cookie", value);
}

/**
 * Service-role store. Never reachable from the browser: the implementation is
 * a server-only module, loaded inside the handler.
 */
async function guestStore(): Promise<GuestStore> {
  const { createGuestStore } = await import("./guest.store.server");
  return createGuestStore();
}

/** Package 3D-T: the derived credential of the analysis this call names. */
async function analysisToken(analysisId: string) {
  const { resolveRequestAnalysisToken } = await import("./guest-request.server");
  return resolveRequestAnalysisToken(analysisId);
}

const analysisIdSchema = z.string().uuid();

/**
 * Opens one temporary analysis of the visitor's browser session. Never creates
 * anything: a missing, expired, saved or foreign analysis is unavailable.
 */
export const resumeGuestWorkspace = createServerFn({ method: "POST" })
  .inputValidator((input: { analysisId: string }) => ({
    analysisId: analysisIdSchema.safeParse(input?.analysisId).success
      ? (input.analysisId as string)
      : null,
  }))
  .handler(async ({ data }): Promise<GuestWorkspaceDto> => {
    if (!data.analysisId) throw new Error(GUEST_ANALYSIS_UNAVAILABLE);
    const { token } = await analysisToken(data.analysisId);
    const workspace = await resumeGuestAnalysisHandler(
      { store: await guestStore(), now: () => new Date() },
      { token },
    );
    if (!workspace) throw new Error(GUEST_ANALYSIS_UNAVAILABLE);
    return {
      kind: "guest",
      draft: workspace.draft,
      lockVersion: workspace.lockVersion,
      expiresAt: workspace.expiresAt,
      schemaVersion: workspace.schemaVersion,
      resumed: true,
    };
  });

/**
 * Package 3D-T: creates exactly one new temporary analysis. POST only, and
 * only ever called from an explicit button — never from a loader, prefetch or
 * render. A live browser session (and its remaining allowance) is reused.
 */
export const createTemporaryAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: { origin: string }) => {
    const origin = input?.origin;
    if (!isNewAnalysisOrigin(origin)) throw new Error("Unknown way to start an analysis.");
    if (origin.startsWith("sample:") && !isDemoScenarioId(origin.slice("sample:".length))) {
      throw new Error("Unknown sample.");
    }
    return { origin };
  })
  .handler(async ({ data }): Promise<{ analysisId: string }> => {
    const { readGuestRequestContext } = await import("./guest-request.server");
    const { createGuestSessionStore } = await import("./guest-session.store.server");
    const context = await readGuestRequestContext();
    const draft = data.origin.startsWith("sample:")
      ? createDemoDraftIfKnown(data.origin.slice("sample:".length))
      : null;
    const result = await createAnalysisHandler(
      { store: await createGuestSessionStore(), now: () => new Date() },
      { sessionToken: context.sessionToken, origin: data.origin, draft },
    );
    if (result.issuedToken)
      await setCookieHeader(buildGuestCookie(result.issuedToken, context.secure));
    return { analysisId: result.analysisId };
  });

/** Package 3D-T: the visitor's live temporary analyses, newest first. No cap. */
export const listRecentAnalyses = createServerFn({ method: "POST" }).handler(
  async (): Promise<RecentAnalysisDto[]> => {
    const { readGuestRequestContext } = await import("./guest-request.server");
    const { createGuestSessionStore } = await import("./guest-session.store.server");
    const { normalizePersistedReviewPayload } = await import("@/lib/arc/ai/review-normalization");
    const context = await readGuestRequestContext();
    return listRecentAnalysesHandler(
      {
        store: await createGuestSessionStore(),
        now: () => new Date(),
        reviewNeeded: (raw) => {
          if (raw === null || raw === undefined) return false;
          const review = normalizePersistedReviewPayload(raw);
          return (
            review.malformed ||
            review.items.some((item) => item.state === "yellow" || item.state === "red")
          );
        },
        sampleLabel: (origin) => {
          const id = origin.slice("sample:".length);
          return isDemoScenarioId(id) ? getDemoScenario(id).customer : null;
        },
      },
      { sessionToken: context.sessionToken },
    );
  },
);

/** Optimistically locked autosave for the credential's temporary workspace. */
export const saveGuestDraft = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { analysisId: string; expectedLockVersion: number; draft: WorkflowDraft }) => ({
      analysisId: analysisIdSchema.parse(input?.analysisId),
      expectedLockVersion: z.number().int().min(1).parse(input?.expectedLockVersion),
      draft: input.draft,
    }),
  )
  .handler(async ({ data }): Promise<GuestSaveResult> => {
    const { token } = await analysisToken(data.analysisId);
    const store = await guestStore();

    return saveGuestDraftHandler(
      {
        store,
        now: () => new Date(),
        // Phase 9G Task 4. Ownership stays credential-bound; a signed-in
        // accountant working inside a temporary workspace is recorded as the
        // named actor on the review event, never as its owner.
        reconcileAutosave: async (args) => {
          const { autosaveWithReconciliation } =
            await import("@/lib/arc/ai/autosave-reconciliation.handlers");
          const { createAutosaveReconciliationStore } =
            await import("@/lib/arc/ai/autosave.store.server");
          const { readOptionalSessionUserId } = await import("@/lib/arc/ai/caller.server");

          const saveDraftOnly = async () => {
            const saved = await store.updateDraft({
              tokenHash: args.guestTokenHash,
              expectedLockVersion: args.expectedLockVersion,
              canonical: args.canonical,
              schemaVersion: args.schemaVersion,
            });
            if (!saved) return null;
            return { lockVersion: saved.lock_version, savedAt: saved.updated_at };
          };

          const outcome = await autosaveWithReconciliation(
            {
              store: await createAutosaveReconciliationStore(saveDraftOnly),
              now: () => new Date(),
            },
            {
              scope: {
                revisionId: null,
                guestWorkspaceId: args.guestWorkspaceId,
                ownerUserId: null,
                guestTokenHash: args.guestTokenHash,
                actorUserId: await readOptionalSessionUserId(),
              },
              expectedLockVersion: args.expectedLockVersion,
              nextDraft: args.nextDraft,
              canonical: args.canonical,
              schemaVersion: args.schemaVersion,
            },
          );
          if (!outcome.ok) {
            // Contention is reported as its own retryable outcome; every other
            // failure keeps the existing conflict/reload behaviour.
            return outcome.reason === "contention"
              ? { ok: false, reason: "contention" }
              : { ok: false, reason: "conflict" };
          }
          return { ok: true, lockVersion: outcome.lockVersion, savedAt: outcome.savedAt };
        },
      },
      { token, expectedLockVersion: data.expectedLockVersion, draft: data.draft },
    );
  });

/**
 * Explicit "Save this analysis": the signed-in caller turns their temporary
 * workspace into a saved customer, contract, analysis and revision 1 in one
 * trusted transaction. Signing in alone never triggers this.
 *
 * The browser-session cookie is never cleared by a save (Package 3D-T).
 */
export const migrateGuestWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      analysisId: string;
      contractTitle: string;
      expectedLockVersion: number;
      existingCustomerId?: string | null;
    }) => ({
      analysisId: analysisIdSchema.parse(input?.analysisId),
      contractTitle: z
        .string()
        .max(300)
        .parse(input?.contractTitle ?? ""),
      // The browser supplies only the version of the temporary workspace it has
      // seen accepted; the credential and the draft itself stay server-side.
      expectedLockVersion: z.number().int().min(1).parse(input?.expectedLockVersion),
      // A customer the caller claims to own. Ownership is proven in the
      // trusted transaction, never here.
      existingCustomerId: z
        .string()
        .uuid()
        .nullable()
        .optional()
        .parse(input?.existingCustomerId ?? null),
    }),
  )
  .handler(async ({ data, context }): Promise<GuestMigrationResult> => {
    const { token } = await analysisToken(data.analysisId);
    const result = await migrateGuestWorkspaceHandler(
      {
        store: await guestStore(),
        now: () => new Date(),
        userId: context.userId,
        migrateTransaction: async (args) => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return supabaseAdmin.rpc("arc_migrate_guest_workspace_by_token_v3", args as never);
        },
      },
      {
        token,
        contractTitle: data.contractTitle,
        expectedLockVersion: data.expectedLockVersion,
        existingCustomerId: data.existingCustomerId ?? null,
      },
    );

    // Package 3D-T: the session cookie survives saving. It still authorizes the
    // session's other analyses and its remaining allowance until it expires.
    return result;
  });
