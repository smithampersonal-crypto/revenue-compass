/**
 * Phase 8B — source-document orchestration, as dependency-injected handlers.
 *
 * The `createServerFn` wrappers call these exact functions; the database and
 * Storage boundaries are the only substituted parts, so tests exercise real
 * production orchestration.
 *
 * Authority rules that hold everywhere in this module:
 *   - the browser never supplies an owner id, a guest workspace id, a storage
 *     path, a bucket, or any validated fact;
 *   - identity comes from the Phase 7 authenticated context or the HttpOnly
 *     guest credential;
 *   - the accepted Phase 8A trusted transactions decide duplication,
 *     recording, association and lock versions.
 */

import { hashGuestToken } from "@/lib/arc/persistence/guest";

import {
  DOCUMENT_NOT_AVAILABLE,
  GUEST_WORKSPACE_UNAVAILABLE,
  SIGNED_READ_TTL_SECONDS,
  SOURCE_DOCUMENT_BUCKET,
  UPLOAD_INTENT_TTL_SECONDS,
  type FinalizeUploadResult,
  type DocumentReadUrlResult,
  type PdfValidationResult,
  type SourceDocumentType,
  type UploadIntentDto,
} from "./types";

/* ------------------------------------------------------------- boundaries */

export interface IntentRow {
  id: string;
  contract_id: string | null;
  guest_workspace_id: string | null;
  target_revision_id: string | null;
  pending_object_path: string;
  /** Reserved permanent path, set by the trusted prepare transaction. */
  permanent_object_path: string | null;
  /** The document the prepare transaction resolved this upload to. */
  resolved_source_document_id: string | null;
  /** Authoritative duplicate verdict recorded at prepare time. */
  is_duplicate: boolean | null;
  state: string;
  expires_at: string;
  original_filename: string;
  display_name: string;
}

export interface IntentInsert {
  id: string;
  contract_id: string | null;
  guest_workspace_id: string | null;
  target_revision_id: string | null;
  pending_object_path: string;
  original_filename: string;
  display_name: string;
  document_type: string | null;
  effective_date: string | null;
  expires_at: string;
}

export interface PrepareResult {
  sourceDocumentId: string;
  permanentObjectPath: string | null;
  duplicate: boolean;
  requiresPromotion: boolean;
}

export interface CommitResult {
  sourceDocumentId: string;
  duplicate: boolean;
  associated: boolean;
  associationConflict: boolean;
  lockVersion: number | null;
}

export interface OwnedDocumentRow {
  id: string;
  storageObjectPath: string;
  originalFilename: string;
}

export interface DocumentStore {
  contractIsOwnedBy(contractId: string, userId: string): Promise<boolean>;
  findDraftRevision(
    revisionId: string,
  ): Promise<{ id: string; contractId: string; status: string; lockVersion: number } | null>;
  /** Active, unexpired workspace for this credential hash — or null. */
  findActiveGuest(tokenHash: string): Promise<{ id: string; lockVersion: number } | null>;
  createIntent(row: IntentInsert): Promise<{ id: string; expiresAt: string }>;
  loadIntent(intentId: string): Promise<IntentRow | null>;
  markIntentFailed(intentId: string): Promise<void>;
  queueDeletion(objectPath: string, reason: string): Promise<void>;
  prepare(args: {
    intentId: string;
    ownerUserId: string | null;
    guestTokenHash: string | null;
    sha256: string;
    byteSize: number;
    pageCount: number;
  }): Promise<PrepareResult>;
  commit(args: {
    intentId: string;
    ownerUserId: string | null;
    guestTokenHash: string | null;
    expectedLockVersion: number | null;
  }): Promise<CommitResult>;
  findOwnedDocument(documentId: string, userId: string): Promise<OwnedDocumentRow | null>;
  findGuestDocument(documentId: string, workspaceId: string): Promise<OwnedDocumentRow | null>;
}

export interface DocumentStorage {
  createPendingUploadTarget(objectPath: string): Promise<{ token: string; path: string }>;
  download(objectPath: string): Promise<Uint8Array>;
  promote(pendingPath: string, permanentPath: string): Promise<void>;
  exists(objectPath: string): Promise<boolean>;
  remove(objectPaths: string[]): Promise<void>;
  createReadUrl(args: {
    objectPath: string;
    originalFilename: string;
    disposition: "view" | "download";
  }): Promise<string>;
}

export interface DocumentDeps {
  store: DocumentStore;
  storage: DocumentStorage;
  now(): Date;
  /** Overridable only for tests; production uses the server PDF validator. */
  validate?: (bytes: Uint8Array) => Promise<PdfValidationResult>;
  /** Overridable only for tests; production uses crypto.randomUUID(). */
  newId?: () => string;
}

export type DocumentCaller =
  { kind: "user"; userId: string } | { kind: "guest"; token: string | null };

export interface InitiateUploadInput {
  contractId?: string | undefined;
  revisionId?: string | undefined;
  originalFilename: string;
  displayName: string;
  documentType?: SourceDocumentType | undefined;
  effectiveDate?: string | undefined;
}

/* ------------------------------------------------------------- utilities */

function unavailable(): never {
  throw new Error(DOCUMENT_NOT_AVAILABLE);
}

function guestUnavailable(): never {
  throw new Error(GUEST_WORKSPACE_UNAVAILABLE);
}

async function resolveGuest(deps: DocumentDeps, token: string | null) {
  if (!token) guestUnavailable();
  const tokenHash = await hashGuestToken(token);
  const workspace = await deps.store.findActiveGuest(tokenHash);
  if (!workspace) guestUnavailable();
  return { tokenHash, workspace };
}

function pendingPath(intentId: string): string {
  return `pending/${intentId}.pdf`;
}

async function defaultValidate(bytes: Uint8Array): Promise<PdfValidationResult> {
  const { validatePdfBytes } = await import("./validation.server");
  return validatePdfBytes(bytes);
}

/* ------------------------------------------------------------- initiation */

export async function initiateUploadHandler(
  deps: DocumentDeps,
  caller: DocumentCaller,
  input: InitiateUploadInput,
): Promise<UploadIntentDto> {
  const originalFilename = input.originalFilename?.trim() ?? "";
  const displayName = input.displayName?.trim() ?? "";
  if (!originalFilename || !displayName) {
    throw new Error("A file name and a document name are required.");
  }

  let contractId: string | null = null;
  let guestWorkspaceId: string | null = null;
  let targetRevisionId: string | null = null;

  if (caller.kind === "user") {
    if (!input.contractId) unavailable();
    if (!(await deps.store.contractIsOwnedBy(input.contractId, caller.userId))) unavailable();
    contractId = input.contractId;

    if (input.revisionId) {
      const revision = await deps.store.findDraftRevision(input.revisionId);
      // The revision must belong to this contract and still be editable.
      if (!revision || revision.contractId !== contractId) unavailable();
      if (revision.status !== "draft") {
        throw new Error("That revision is final, so documents cannot be added to it.");
      }
      targetRevisionId = revision.id;
    }
  } else {
    const { workspace } = await resolveGuest(deps, caller.token);
    guestWorkspaceId = workspace.id;
  }

  const intentId = (deps.newId ?? (() => globalThis.crypto.randomUUID()))();
  const path = pendingPath(intentId);
  const expiresAt = new Date(deps.now().getTime() + UPLOAD_INTENT_TTL_SECONDS * 1000).toISOString();

  const created = await deps.store.createIntent({
    id: intentId,
    contract_id: contractId,
    guest_workspace_id: guestWorkspaceId,
    target_revision_id: targetRevisionId,
    // Server-assigned, always. The browser cannot name an object.
    pending_object_path: path,
    original_filename: originalFilename,
    display_name: displayName,
    document_type: input.documentType ?? null,
    effective_date: input.effectiveDate ?? null,
    expires_at: expiresAt,
  });

  const target = await deps.storage.createPendingUploadTarget(path);

  return {
    intentId: created.id,
    bucket: SOURCE_DOCUMENT_BUCKET,
    path: target.path,
    token: target.token,
    expiresAt: created.expiresAt,
  };
}

/* ----------------------------------------------------------- finalization */

async function authorizeIntent(
  deps: DocumentDeps,
  caller: DocumentCaller,
  intent: IntentRow,
): Promise<{ ownerUserId: string | null; guestTokenHash: string | null }> {
  if (intent.contract_id) {
    if (caller.kind !== "user") unavailable();
    if (!(await deps.store.contractIsOwnedBy(intent.contract_id, caller.userId))) unavailable();
    return { ownerUserId: caller.userId, guestTokenHash: null };
  }

  if (caller.kind !== "guest") unavailable();
  const { tokenHash, workspace } = await resolveGuest(deps, caller.token);
  if (workspace.id !== intent.guest_workspace_id) guestUnavailable();
  return { ownerUserId: null, guestTokenHash: tokenHash };
}

/** Retry-safe promotion: a lost response is confirmed, not re-attempted blindly. */
async function promoteSafely(
  deps: DocumentDeps,
  pendingObjectPath: string,
  permanentObjectPath: string,
): Promise<void> {
  try {
    await deps.storage.promote(pendingObjectPath, permanentObjectPath);
  } catch (error) {
    if (!(await deps.storage.exists(permanentObjectPath))) throw error;
    // The object is already where it belongs: an earlier attempt succeeded.
  }
}

/** Immediate removal when possible, otherwise the accepted deletion queue. */
async function discardPendingObject(
  deps: DocumentDeps,
  objectPath: string,
  reason: string,
): Promise<void> {
  try {
    await deps.storage.remove([objectPath]);
  } catch {
    await deps.store.queueDeletion(objectPath, reason).catch(() => undefined);
  }
}

export async function finalizeUploadHandler(
  deps: DocumentDeps,
  caller: DocumentCaller,
  input: { intentId: string; expectedLockVersion?: number | undefined },
): Promise<FinalizeUploadResult> {
  const intent = await deps.store.loadIntent(input.intentId);
  if (!intent) unavailable();

  const identity = await authorizeIntent(deps, caller, intent);
  const expectedLockVersion = input.expectedLockVersion ?? null;

  // A finalized intent is pure read-back: no download, no validation, no
  // promotion, no association, no lock movement.
  if (intent.state === "finalized") {
    const committed = await deps.store.commit({
      intentId: intent.id,
      ...identity,
      expectedLockVersion,
    });
    return {
      ok: true,
      sourceDocumentId: committed.sourceDocumentId,
      duplicate: committed.duplicate,
      associated: committed.associated,
      associationConflict: committed.associationConflict,
      lockVersion: committed.lockVersion,
    };
  }

  const bytes = await deps.storage.download(intent.pending_object_path);
  const validated = await (deps.validate ?? defaultValidate)(bytes);

  if (!validated.ok) {
    // Nothing invalid is ever recorded as a Source Document, and no private
    // blob is abandoned.
    await discardPendingObject(deps, intent.pending_object_path, "validation_failed");
    await deps.store.markIntentFailed(intent.id).catch(() => undefined);
    return { ok: false, code: validated.code, message: validated.message };
  }

  const prepared = await deps.store.prepare({
    intentId: intent.id,
    ...identity,
    sha256: validated.sha256,
    byteSize: validated.byteSize,
    pageCount: validated.pageCount,
  });

  if (prepared.requiresPromotion && prepared.permanentObjectPath) {
    await promoteSafely(deps, intent.pending_object_path, prepared.permanentObjectPath);
  } else {
    // Duplicate (or an already promoted retry): never a second permanent copy.
    await discardPendingObject(deps, intent.pending_object_path, "duplicate_upload");
  }

  const committed = await deps.store.commit({
    intentId: intent.id,
    ...identity,
    expectedLockVersion,
  });

  return {
    ok: true,
    sourceDocumentId: committed.sourceDocumentId,
    duplicate: committed.duplicate,
    associated: committed.associated,
    associationConflict: committed.associationConflict,
    lockVersion: committed.lockVersion,
  };
}

/* --------------------------------------------------------------- reading */

export async function documentReadUrlHandler(
  deps: DocumentDeps,
  caller: DocumentCaller,
  input: { sourceDocumentId: string; disposition: "view" | "download" },
): Promise<DocumentReadUrlResult> {
  let document: OwnedDocumentRow | null = null;

  if (caller.kind === "user") {
    document = await deps.store.findOwnedDocument(input.sourceDocumentId, caller.userId);
  } else {
    const { workspace } = await resolveGuest(deps, caller.token);
    document = await deps.store.findGuestDocument(input.sourceDocumentId, workspace.id);
  }

  // Neutral for foreign and unknown ids alike: no path, no metadata, no link.
  if (!document) unavailable();

  const url = await deps.storage.createReadUrl({
    objectPath: document.storageObjectPath,
    originalFilename: document.originalFilename,
    disposition: input.disposition,
  });

  return { url, expiresInSeconds: SIGNED_READ_TTL_SECONDS };
}
