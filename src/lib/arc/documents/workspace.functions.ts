/**
 * Phase 8C — server functions for the authenticated Source Documents
 * workspace.
 *
 * The browser sends ids and the metadata a person is allowed to choose. It
 * never sends an owner id, a storage path or a lock version it did not receive
 * from the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import {
  SOURCE_CONFLICT_MESSAGE,
  SOURCE_DOCUMENT_TYPES,
  type DocumentWorkspaceDto,
  type SourceMutationResult,
} from "./types";

async function store() {
  // Server-only module, loaded inside the handler so it never enters the
  // client graph.
  const { documentWorkspaceStore } = await import("./workspace.store.server");
  return documentWorkspaceStore();
}

async function isConflict(error: unknown): Promise<boolean> {
  const { SourceLockConflictError } = await import("./workspace.store.server");
  return error instanceof SourceLockConflictError;
}

/** Turns a trusted mutation into a stable, user-safe outcome. */
async function mutation(run: () => Promise<number | null>): Promise<SourceMutationResult> {
  try {
    return { ok: true, lockVersion: await run() };
  } catch (error) {
    if (await isConflict(error)) {
      return { ok: false, reason: "conflict", message: SOURCE_CONFLICT_MESSAGE };
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

const uuid = z.string().uuid();

export const loadDocumentWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ contractId: uuid, revisionId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<DocumentWorkspaceDto> =>
    (await store()).loadWorkspace({ userId: context.userId, ...data }),
  );

const selectionInput = z.object({
  revisionId: uuid,
  sourceDocumentId: uuid,
  expectedLockVersion: z.number().int().nonnegative(),
});

export const attachSourceDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => selectionInput.parse(data))
  .handler(async ({ data, context }): Promise<SourceMutationResult> =>
    mutation(async () => (await store()).attach({ userId: context.userId, ...data })),
  );

export const removeSourceDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => selectionInput.parse(data))
  .handler(async ({ data, context }): Promise<SourceMutationResult> =>
    mutation(async () => (await store()).remove({ userId: context.userId, ...data })),
  );

const metadataInput = z.object({
  sourceDocumentId: uuid,
  displayName: z.string().trim().min(1).max(255),
  documentType: z.enum(SOURCE_DOCUMENT_TYPES).nullable(),
  effectiveDate: z.string().date().nullable(),
});

export const updateSourceDocumentDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => metadataInput.parse(data))
  .handler(async ({ data, context }): Promise<SourceMutationResult> =>
    mutation(async () => {
      await (await store()).updateMetadata({ userId: context.userId, ...data });
      return null;
    }),
  );

export const setSourceDocumentArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ sourceDocumentId: uuid, archived: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<SourceMutationResult> =>
    mutation(async () => {
      await (await store()).setArchived({ userId: context.userId, ...data });
      return null;
    }),
  );

export const deleteSourceDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        sourceDocumentId: uuid,
        expectedLockVersion: z.number().int().nonnegative().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SourceMutationResult> =>
    mutation(async () => (await store()).stageDeletion({ userId: context.userId, ...data })),
  );
