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

import { readGuestCookie } from "@/lib/arc/persistence/guest";

import {
  documentReadUrlHandler,
  finalizeUploadHandler,
  initiateUploadHandler,
  type DocumentCaller,
  type DocumentDeps,
} from "./documents.handlers";
import {
  SOURCE_DOCUMENT_TYPES,
  type DocumentReadUrlResult,
  type FinalizeUploadResult,
  type UploadIntentDto,
} from "./types";

function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

async function guestCaller(): Promise<DocumentCaller> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
  return { kind: "guest", token: readGuestCookie(request.headers.get("cookie"), secure) };
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
});

export const initiateGuestDocumentUpload = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => initiateInput.parse(data))
  .handler(async ({ data }): Promise<UploadIntentDto> =>
    initiateUploadHandler(await deps(), await guestCaller(), data),
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
