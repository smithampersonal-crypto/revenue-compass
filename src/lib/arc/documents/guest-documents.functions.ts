/**
 * Phase 8B — source-document server functions for temporary workspaces.
 *
 * Authorization is the HttpOnly guest credential and the workspace's own
 * `expires_at`, checked on every call. The workspace id is never an
 * authorization credential and the raw credential never appears in a URL or a
 * response body.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { scopedToCaller } from "./caller-scope";

import {
  documentReadUrlHandler,
  finalizeUploadHandler,
  initiateUploadHandler,
  type DocumentCaller,
  type DocumentDeps,
} from "./documents.handlers";
import {
  GUEST_SOURCE_CONFLICT_MESSAGE,
  GUEST_WORKSPACE_UNAVAILABLE,
  MAX_DOCUMENT_BYTES,
  SOURCE_DOCUMENT_TYPES,
  type DocumentReadUrlResult,
  type FinalizeUploadResult,
  type GuestDocumentWorkspaceDto,
  type SourceMutationResult,
  type UploadIntentDto,
} from "./types";

/**
 * Package 3D-T: the derived credential of the temporary analysis this call
 * names (request header), proven against the HttpOnly session cookie. Null —
 * and therefore refused downstream — when the session does not own it.
 */
async function guestCaller(): Promise<DocumentCaller> {
  const { resolveRequestAnalysisToken } =
    await import("@/lib/arc/persistence/guest-request.server");
  const { token } = await resolveRequestAnalysisToken();
  return { kind: "guest", token };
}

/**
 * Uploading happens inside an analysis that already exists: since Package 3D-T
 * a temporary analysis is only ever created by an explicit button, never as a
 * side effect of an upload.
 */
async function ensureGuestCaller(): Promise<DocumentCaller> {
  return guestCaller();
}

async function deps(): Promise<DocumentDeps> {
  // Server-only module, loaded inside the handler so it never enters the
  // client graph.
  const { documentStorage, documentStore } = await import("./documents.store.server");
  return { store: await documentStore(), storage: documentStorage, now: () => new Date() };
}

const initiateInput = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(255),
  documentType: z.enum(SOURCE_DOCUMENT_TYPES).optional(),
  effectiveDate: z.string().date().optional(),
  // Transport-integrity expectation only; the server's own read decides facts.
  declaredByteSize: z.number().int().positive().max(MAX_DOCUMENT_BYTES).optional(),
});

export const initiateGuestDocumentUpload = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => initiateInput.parse(data))
  .handler(async ({ data }): Promise<UploadIntentDto> =>
    // Uploading may be the visitor's first action, so start a temporary
    // workspace when they do not have one yet.
    initiateUploadHandler(await deps(), await ensureGuestCaller(), data),
  );

const finalizeInput = z.object({
  intentId: z.string().uuid(),
  expectedLockVersion: z.number().int().nonnegative().optional(),
});

export const finalizeGuestDocumentUpload = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => finalizeInput.parse(data))
  .handler(async ({ data }): Promise<FinalizeUploadResult> =>
    finalizeUploadHandler(await deps(), await guestCaller(), data),
  );

const readInput = z.object({
  sourceDocumentId: z.string().uuid(),
  disposition: z.enum(["view", "download"]),
});

export const getGuestDocumentReadUrl = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => readInput.parse(data))
  .handler(async ({ data }): Promise<DocumentReadUrlResult> =>
    documentReadUrlHandler(await deps(), await guestCaller(), data),
  );

/* --------------------------------- Phase 8E — temporary workspace documents */

async function guestTokenHash(ensure = false): Promise<string> {
  const caller = ensure ? await ensureGuestCaller() : await guestCaller();
  const token = caller.kind === "guest" ? caller.token : null;
  if (!token) throw new Error(GUEST_WORKSPACE_UNAVAILABLE);
  const { hashGuestToken } = await import("@/lib/arc/persistence/guest");
  return hashGuestToken(token);
}

async function guestStore() {
  // Server-only module, loaded inside the handler so it never enters the
  // client graph.
  const { guestDocumentWorkspaceStore } = await import("./guest-workspace.store.server");
  return guestDocumentWorkspaceStore();
}

async function isGuestConflict(error: unknown): Promise<boolean> {
  const { GuestSourceLockConflictError } = await import("./guest-workspace.store.server");
  return error instanceof GuestSourceLockConflictError;
}

/** Turns a trusted mutation into a stable, user-safe outcome. */
async function guestMutation(run: () => Promise<number | null>): Promise<SourceMutationResult> {
  try {
    return { ok: true, lockVersion: await run() };
  } catch (error) {
    if (await isGuestConflict(error)) {
      return { ok: false, reason: "conflict", message: GUEST_SOURCE_CONFLICT_MESSAGE };
    }
    return {
      ok: false,
      reason: "failed",
      message:
        error instanceof Error && error.message
          ? error.message
          : "That change could not be completed.",
    };
  }
}

export const loadGuestDocumentWorkspace = createServerFn({ method: "POST" }).handler(
  async (): Promise<GuestDocumentWorkspaceDto> =>
    // Opening the documents area starts the temporary workspace if needed, so
    // the area is usable before anything has been typed into the analysis.
    (await guestStore()).loadWorkspace(await guestTokenHash(true)),
);

const guestSelectionInput = z.object({
  sourceDocumentId: z.string().uuid(),
  expectedLockVersion: z.number().int().nonnegative(),
});

export const attachGuestSourceDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => guestSelectionInput.parse(data))
  .handler(async ({ data }): Promise<SourceMutationResult> =>
    guestMutation(async () =>
      (await guestStore()).attach(scopedToCaller({ tokenHash: await guestTokenHash() }, data)),
    ),
  );

export const removeGuestSourceDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => guestSelectionInput.parse(data))
  .handler(async ({ data }): Promise<SourceMutationResult> =>
    guestMutation(async () =>
      (await guestStore()).remove(scopedToCaller({ tokenHash: await guestTokenHash() }, data)),
    ),
  );

export const deleteGuestSourceDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        sourceDocumentId: z.string().uuid(),
        expectedLockVersion: z.number().int().nonnegative().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<SourceMutationResult> =>
    guestMutation(async () =>
      (await guestStore()).stageDeletion(
        scopedToCaller({ tokenHash: await guestTokenHash() }, data),
      ),
    ),
  );
