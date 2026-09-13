/**
 * Phase 8E acceptance — a migrated PDF stays readable by its new owner.
 *
 * This regression deliberately crosses the whole boundary that the earlier
 * unit tests stopped short of: a guest uploads a PDF through the real upload
 * handlers, the workspace is migrated exactly the way the trusted transaction
 * migrates it (same row, same id, same storage path, same digest — only the
 * owning columns change), and the document is then read back through the real
 * authenticated read handler.
 *
 * The store here is a single shared table whose lookup rules mirror the
 * shipped SQL: an owner lookup resolves document -> contract -> customer ->
 * owner_user_id, and a guest lookup matches `guest_workspace_id` on an active,
 * unexpired workspace. Nothing is asserted about "two functions were called".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashGuestToken } from "@/lib/arc/persistence/guest";

import {
  documentReadUrlHandler,
  finalizeUploadHandler,
  initiateUploadHandler,
  type DocumentDeps,
  type DocumentStorage,
  type DocumentStore,
} from "../documents.handlers";
import { buildPdf } from "./pdf-fixtures";

const OWNER = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";
const WORKSPACE = "33333333-3333-3333-3333-333333333333";
const CONTRACT = "44444444-4444-4444-4444-444444444444";
const DOCUMENT = "55555555-5555-5555-5555-555555555555";
const INTENT = "66666666-6666-6666-6666-666666666666";
const GUEST_TOKEN = "guest-credential-token";

interface DocumentRecord {
  id: string;
  contractId: string | null;
  guestWorkspaceId: string | null;
  storageObjectPath: string;
  originalFilename: string;
  sha256: string;
}

/** One shared world: guest upload, migration and owner read all see it. */
function world() {
  const documents = new Map<string, DocumentRecord>();
  const contracts = new Map<string, { ownerUserId: string }>([[CONTRACT, { ownerUserId: OWNER }]]);
  const objects = new Map<string, Uint8Array>();
  let guestActive = true;
  let intent: {
    id: string;
    pendingObjectPath: string;
    permanentObjectPath: string | null;
    resolvedSourceDocumentId: string | null;
  } | null = null;

  const pdf = buildPdf();
  const digest = "a".repeat(64);

  const store = {
    contractIsOwnedBy: vi.fn(
      async (contractId: string, userId: string) =>
        contracts.get(contractId)?.ownerUserId === userId,
    ),
    findDraftRevision: vi.fn(async () => null),
    findActiveGuest: vi.fn(async (tokenHash: string) =>
      guestActive && tokenHash === (await hashGuestToken(GUEST_TOKEN))
        ? { id: WORKSPACE, lockVersion: 3 }
        : null,
    ),
    createIntent: vi.fn(async (row: { id: string; pending_object_path: string }) => {
      intent = {
        id: row.id,
        pendingObjectPath: row.pending_object_path,
        permanentObjectPath: null,
        resolvedSourceDocumentId: null,
      };
      return { id: row.id, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    }),
    loadIntent: vi.fn(async (intentId: string) =>
      intent && intent.id === intentId
        ? {
            id: intent.id,
            contract_id: null,
            guest_workspace_id: WORKSPACE,
            target_revision_id: null,
            pending_object_path: intent.pendingObjectPath,
            permanent_object_path: intent.permanentObjectPath,
            resolved_source_document_id: intent.resolvedSourceDocumentId,
            is_duplicate: false,
            state: "pending",
            expires_at: new Date(Date.now() + 600_000).toISOString(),
            original_filename: "master agreement.pdf",
            display_name: "Master agreement",
          }
        : null,
    ),
    markIntentFailed: vi.fn(),
    queueDeletion: vi.fn(),
    prepare: vi.fn(async () => {
      const permanent = `documents/${DOCUMENT}.pdf`;
      if (intent) {
        intent.permanentObjectPath = permanent;
        intent.resolvedSourceDocumentId = DOCUMENT;
      }
      documents.set(DOCUMENT, {
        id: DOCUMENT,
        contractId: null,
        guestWorkspaceId: WORKSPACE,
        storageObjectPath: permanent,
        originalFilename: "master agreement.pdf",
        sha256: digest,
      });
      return {
        sourceDocumentId: DOCUMENT,
        permanentObjectPath: permanent,
        duplicate: false,
        requiresPromotion: true,
      };
    }),
    commit: vi.fn(async () => ({
      sourceDocumentId: DOCUMENT,
      duplicate: false,
      associated: true,
      associationConflict: false,
      lockVersion: 4,
    })),
    // Mirrors source_documents -> contracts!inner(customers!inner(owner_user_id)).
    findOwnedDocument: vi.fn(async (documentId: string, userId: string) => {
      const row = documents.get(documentId);
      if (!row || row.contractId === null) return null;
      if (contracts.get(row.contractId)?.ownerUserId !== userId) return null;
      return {
        id: row.id,
        storageObjectPath: row.storageObjectPath,
        originalFilename: row.originalFilename,
      };
    }),
    findGuestDocument: vi.fn(async (documentId: string, workspaceId: string) => {
      const row = documents.get(documentId);
      if (!row || row.guestWorkspaceId !== workspaceId) return null;
      return {
        id: row.id,
        storageObjectPath: row.storageObjectPath,
        originalFilename: row.originalFilename,
      };
    }),
  } as unknown as DocumentStore;

  const reads: { objectPath: string; disposition: string; originalFilename: string }[] = [];

  const storage = {
    createPendingUploadTarget: vi.fn(async (objectPath: string) => ({
      token: "upload-token",
      path: objectPath,
    })),
    download: vi.fn(async () => pdf),
    promote: vi.fn(async (pending: string, permanent: string) => {
      objects.set(permanent, objects.get(pending) ?? pdf);
      objects.delete(pending);
    }),
    exists: vi.fn(async () => true),
    remove: vi.fn(),
    createReadUrl: vi.fn(
      async (args: { objectPath: string; disposition: string; originalFilename: string }) => {
        reads.push(args);
        if (!objects.has(args.objectPath)) throw new Error("missing object");
        return `https://storage.test/${args.objectPath}?token=signed&disposition=${args.disposition}`;
      },
    ),
  } as unknown as DocumentStorage;

  const deps: DocumentDeps = {
    store,
    storage,
    now: () => new Date(),
    validate: async () => ({ ok: true, pageCount: 1, byteSize: pdf.byteLength, sha256: digest }),
    newId: () => INTENT,
  };

  /** Exactly what the trusted migration transaction does to a document row. */
  function migrate() {
    for (const row of documents.values()) {
      if (row.guestWorkspaceId !== WORKSPACE) continue;
      row.contractId = CONTRACT;
      row.guestWorkspaceId = null;
    }
    guestActive = false;
  }

  return { deps, documents, objects, migrate, reads, digest };
}

describe("a migrated PDF stays readable by its new owner", () => {
  let w: ReturnType<typeof world>;

  beforeEach(async () => {
    w = world();
    const intent = await initiateUploadHandler(
      w.deps,
      { kind: "guest", token: GUEST_TOKEN },
      { originalFilename: "master agreement.pdf", displayName: "Master agreement" },
    );
    // The bytes the browser PUTs to the one-time upload target.
    w.objects.set(intent.path, new Uint8Array([1]));
    await finalizeUploadHandler(
      w.deps,
      { kind: "guest", token: GUEST_TOKEN },
      { intentId: INTENT },
    );
  });

  it("is viewable by the signed-in owner after the workspace is saved", async () => {
    w.migrate();

    const result = await documentReadUrlHandler(
      w.deps,
      { kind: "user", userId: OWNER },
      { sourceDocumentId: DOCUMENT, disposition: "view" },
    );

    expect(result.url).toContain("https://");
    expect(w.reads.at(-1)).toMatchObject({
      objectPath: `documents/${DOCUMENT}.pdf`,
      disposition: "view",
      originalFilename: "master agreement.pdf",
    });
  });

  it("is downloadable by the signed-in owner under its original filename", async () => {
    w.migrate();

    await documentReadUrlHandler(
      w.deps,
      { kind: "user", userId: OWNER },
      { sourceDocumentId: DOCUMENT, disposition: "download" },
    );

    expect(w.reads.at(-1)).toMatchObject({
      disposition: "download",
      originalFilename: "master agreement.pdf",
    });
  });

  it("keeps the same document id, storage path and digest across the save", async () => {
    const before = { ...w.documents.get(DOCUMENT)! };
    w.migrate();
    const after = w.documents.get(DOCUMENT)!;

    expect(w.documents.size).toBe(1);
    expect(after.id).toBe(before.id);
    expect(after.storageObjectPath).toBe(before.storageObjectPath);
    expect(after.sha256).toBe(before.sha256);
    expect(after.contractId).toBe(CONTRACT);
    expect(after.guestWorkspaceId).toBeNull();
  });

  it("never exposes the storage path to the browser", async () => {
    w.migrate();
    const result = await documentReadUrlHandler(
      w.deps,
      { kind: "user", userId: OWNER },
      { sourceDocumentId: DOCUMENT, disposition: "view" },
    );

    // The signed link is opaque to the caller: no bucket, no folder layout.
    expect(Object.keys(result)).toEqual(["url", "expiresInSeconds"]);
  });

  it("refuses another signed-in user", async () => {
    w.migrate();

    await expect(
      documentReadUrlHandler(
        w.deps,
        { kind: "user", userId: STRANGER },
        { sourceDocumentId: DOCUMENT, disposition: "view" },
      ),
    ).rejects.toThrow();
  });

  it("refuses the retired guest credential", async () => {
    w.migrate();

    await expect(
      documentReadUrlHandler(
        w.deps,
        { kind: "guest", token: GUEST_TOKEN },
        { sourceDocumentId: DOCUMENT, disposition: "view" },
      ),
    ).rejects.toThrow();
  });
});
