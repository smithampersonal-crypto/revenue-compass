/**
 * Phase 8B — source-document server functions for signed-in accountants.
 *
 * The browser sends only ids and metadata it is allowed to choose. Identity
 * comes from `requireSupabaseAuth`; ownership, storage paths and validated
 * facts are all decided on the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import {
  documentReadUrlHandler,
  finalizeUploadHandler,
  initiateUploadHandler,
  type DocumentDeps,
} from "./documents.handlers";
import { documentStorage, documentStore } from "./documents.store.server";
import {
  SOURCE_DOCUMENT_TYPES,
  type DocumentReadUrlResult,
  type FinalizeUploadResult,
  type UploadIntentDto,
} from "./types";

async function deps(): Promise<DocumentDeps> {
  return { store: await documentStore(), storage: documentStorage, now: () => new Date() };
}

const initiateInput = z.object({
  contractId: z.string().uuid(),
  revisionId: z.string().uuid().optional(),
  originalFilename: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(255),
  documentType: z.enum(SOURCE_DOCUMENT_TYPES).optional(),
  effectiveDate: z.string().date().optional(),
});

/** Reserves one pending object and returns a one-time signed upload target. */
export const initiateDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => initiateInput.parse(data))
  .handler(async ({ data, context }): Promise<UploadIntentDto> =>
    initiateUploadHandler(await deps(), { kind: "user", userId: context.userId }, data),
  );

const finalizeInput = z.object({
  intentId: z.string().uuid(),
  expectedLockVersion: z.number().int().nonnegative().optional(),
});

/** Validates the uploaded bytes and records the document, or rejects it. */
export const finalizeDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => finalizeInput.parse(data))
  .handler(async ({ data, context }): Promise<FinalizeUploadResult> =>
    finalizeUploadHandler(await deps(), { kind: "user", userId: context.userId }, data),
  );

const readInput = z.object({
  sourceDocumentId: z.string().uuid(),
  disposition: z.enum(["view", "download"]),
});

/** A short-lived signed link for a document the caller demonstrably owns. */
export const getDocumentReadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => readInput.parse(data))
  .handler(async ({ data, context }): Promise<DocumentReadUrlResult> =>
    documentReadUrlHandler(await deps(), { kind: "user", userId: context.userId }, data),
  );
