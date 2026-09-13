/**
 * Phase 8B — upload initiation and finalization orchestration.
 *
 * The handlers under test are the exact production ones; only the database and
 * Storage boundaries are substituted, so these are assertions about ARC's real
 * orchestration rather than about mocks.
 */

import { describe, expect, it, vi } from "vitest";

import { hashGuestToken } from "@/lib/arc/persistence/guest";

import {
  finalizeUploadHandler,
  initiateUploadHandler,
  type DocumentDeps,
  type DocumentStorage,
  type DocumentStore,
  type IntentRow,
} from "../documents.handlers";
import { MAX_DOCUMENT_BYTES, SOURCE_DOCUMENT_BUCKET } from "../types";
import { corruptBytes, validTextPdf } from "./pdf-fixtures";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const CONTRACT = "33333333-3333-3333-3333-333333333333";
const REVISION = "44444444-4444-4444-4444-444444444444";
const GUEST = "55555555-5555-5555-5555-555555555555";
const GUEST_TOKEN = "guest-credential-token";

interface HarnessOptions {
  intents?: IntentRow[];
  objects?: Record<string, Uint8Array>;
  guestExpired?: boolean;
  revisionStatus?: "draft" | "finalized" | "superseded";
  revisionContractId?: string;
}

function harness(options: HarnessOptions = {}) {
  const intents = new Map<string, IntentRow>();
  for (const intent of options.intents ?? []) intents.set(intent.id, intent);
  const objects: Record<string, Uint8Array> = { ...(options.objects ?? {}) };
  const deletionQueue: { path: string; reason: string }[] = [];
  const removed: string[] = [];
  const prepared: Record<string, unknown>[] = [];
  const committed: Record<string, unknown>[] = [];
  const signedTargets: string[] = [];

  const store: DocumentStore = {
    contractIsOwnedBy: vi.fn(async (contractId, userId) => contractId === CONTRACT && userId === OWNER),
    findDraftRevision: vi.fn(async (revisionId) =>
      revisionId === REVISION
        ? {
            id: REVISION,
            contractId: options.revisionContractId ?? CONTRACT,
            status: options.revisionStatus ?? "draft",
            lockVersion: 3,
          }
        : null,
    ),
    findActiveGuest: vi.fn(async (tokenHash) => {
      if (options.guestExpired) return null;
      return tokenHash ? { id: GUEST, lockVersion: 2 } : null;
    }),
    createIntent: vi.fn(async (row) => {
      intents.set(row.id, { ...row, state: "pending" } as IntentRow);
      return { id: row.id, expiresAt: row.expires_at };
    }),
    loadIntent: vi.fn(async (intentId) => intents.get(intentId) ?? null),
    markIntentFailed: vi.fn(async (intentId) => {
      const intent = intents.get(intentId);
      if (intent) intents.set(intentId, { ...intent, state: "failed" });
    }),
    queueDeletion: vi.fn(async (path, reason) => {
      deletionQueue.push({ path, reason });
    }),
    prepare: vi.fn(async (args) => {
      prepared.push(args);
      return {
        sourceDocumentId: "doc-1",
        permanentObjectPath: "documents/doc-1.pdf",
        duplicate: false,
        requiresPromotion: true,
      };
    }),
    commit: vi.fn(async (args) => {
      committed.push(args);
      return {
        sourceDocumentId: "doc-1",
        duplicate: false,
        associated: true,
        associationConflict: false,
        lockVersion: 4,
      };
    }),
    findOwnedDocument: vi.fn(async () => null),
    findGuestDocument: vi.fn(async () => null),
  };

  const storage: DocumentStorage = {
    createPendingUploadTarget: vi.fn(async (path: string) => {
      signedTargets.push(path);
      return { token: "signed-token", path };
    }),
    download: vi.fn(async (path: string) => {
      const bytes = objects[path];
      if (!bytes) throw new Error(`missing object ${path}`);
      return bytes;
    }),
    promote: vi.fn(async (from: string, to: string) => {
      objects[to] = objects[from]!;
      delete objects[from];
    }),
    remove: vi.fn(async (paths: string[]) => {
      for (const path of paths) {
        removed.push(path);
        delete objects[path];
      }
    }),
    createReadUrl: vi.fn(async () => "https://example.test/signed"),
  };

  const deps: DocumentDeps = { store, storage, now: () => new Date("2026-09-13T00:00:00.000Z") };

  return { deps, store, storage, intents, objects, deletionQueue, removed, prepared, committed, signedTargets };
}

function intentRow(overrides: Partial<IntentRow> = {}): IntentRow {
  return {
    id: "intent-1",
    contract_id: CONTRACT,
    guest_workspace_id: null,
    target_revision_id: REVISION,
    pending_object_path: "pending/intent-1.pdf",
    permanent_object_path: null,
    state: "pending",
    expires_at: "2026-09-13T01:00:00.000Z",
    original_filename: "agreement.pdf",
    display_name: "Master agreement",
    ...overrides,
  };
}

describe("upload initiation", () => {
  it("refuses a contract the caller does not own", async () => {
    const { deps, storage } = harness();
    await expect(
      initiateUploadHandler(deps, { kind: "user", userId: OTHER }, {
        contractId: CONTRACT,
        originalFilename: "a.pdf",
        displayName: "A",
      }),
    ).rejects.toThrow();
    expect(storage.createPendingUploadTarget).not.toHaveBeenCalled();
  });

  it("refuses a revision belonging to another contract", async () => {
    const { deps } = harness({ revisionContractId: "99999999-9999-9999-9999-999999999999" });
    await expect(
      initiateUploadHandler(deps, { kind: "user", userId: OWNER }, {
        contractId: CONTRACT,
        revisionId: REVISION,
        originalFilename: "a.pdf",
        displayName: "A",
      }),
    ).rejects.toThrow();
  });

  it("refuses a finalized revision as an upload target", async () => {
    const { deps } = harness({ revisionStatus: "finalized" });
    await expect(
      initiateUploadHandler(deps, { kind: "user", userId: OWNER }, {
        contractId: CONTRACT,
        revisionId: REVISION,
        originalFilename: "a.pdf",
        displayName: "A",
      }),
    ).rejects.toThrow();
  });

  it("assigns the pending path server-side and signs exactly that path", async () => {
    const { deps, signedTargets, store } = harness();
    const dto = await initiateUploadHandler(deps, { kind: "user", userId: OWNER }, {
      contractId: CONTRACT,
      revisionId: REVISION,
      originalFilename: "agreement.pdf",
      displayName: "Master agreement",
      // A browser-chosen path is not part of the input contract and must not
      // reach Storage.
      ...({ pendingObjectPath: "pending/attacker.pdf" } as Record<string, never>),
    });

    expect(dto.bucket).toBe(SOURCE_DOCUMENT_BUCKET);
    expect(dto.path).toBe(`pending/${dto.intentId}.pdf`);
    expect(signedTargets).toEqual([`pending/${dto.intentId}.pdf`]);
    expect(dto.token).toBe("signed-token");
    const created = vi.mocked(store.createIntent).mock.calls[0]![0];
    expect(created.pending_object_path).toBe(`pending/${dto.intentId}.pdf`);
    expect(created.contract_id).toBe(CONTRACT);
    expect(created.guest_workspace_id).toBeNull();
  });

  it("derives the guest workspace from the credential alone", async () => {
    const { deps, store } = harness();
    const dto = await initiateUploadHandler(deps, { kind: "guest", token: GUEST_TOKEN }, {
      originalFilename: "a.pdf",
      displayName: "A",
    });

    expect(store.findActiveGuest).toHaveBeenCalledWith(await hashGuestToken(GUEST_TOKEN));
    const created = vi.mocked(store.createIntent).mock.calls[0]![0];
    expect(created.guest_workspace_id).toBe(GUEST);
    expect(created.contract_id).toBeNull();
    expect(dto.path).toBe(`pending/${dto.intentId}.pdf`);
  });

  it("refuses an expired temporary workspace", async () => {
    const { deps, storage } = harness({ guestExpired: true });
    await expect(
      initiateUploadHandler(deps, { kind: "guest", token: GUEST_TOKEN }, {
        originalFilename: "a.pdf",
        displayName: "A",
      }),
    ).rejects.toThrow(/temporary workspace/i);
    expect(storage.createPendingUploadTarget).not.toHaveBeenCalled();
  });
});

describe("upload finalization", () => {
  it("downloads exactly the pending object recorded by the intent", async () => {
    const { deps, storage } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });

    const result = await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(storage.download).toHaveBeenCalledWith("pending/intent-1.pdf");
    expect(result).toMatchObject({ ok: true, sourceDocumentId: "doc-1", lockVersion: 4 });
  });

  it("judges the actual bytes, not the declared type, and records nothing invalid", async () => {
    const { deps, store, removed, intents } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": corruptBytes() },
    });

    const result = await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_pdf" });
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
    expect(removed).toEqual(["pending/intent-1.pdf"]);
    expect(intents.get("intent-1")!.state).toBe("failed");
  });

  it("queues the pending blob for deletion when immediate removal fails", async () => {
    const { deps, storage, deletionQueue } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": corruptBytes() },
    });
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("storage unavailable"));

    await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(deletionQueue).toEqual([
      { path: "pending/intent-1.pdf", reason: "validation_failed" },
    ]);
  });

  it("promotes a new document to documents/<id>.pdf", async () => {
    const { deps, storage, objects } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });

    await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(storage.promote).toHaveBeenCalledWith("pending/intent-1.pdf", "documents/doc-1.pdf");
    expect(objects["documents/doc-1.pdf"]).toBeDefined();
    expect(objects["pending/intent-1.pdf"]).toBeUndefined();
  });

  it("recovers from a lost promotion response by verifying the permanent object", async () => {
    const { deps, storage } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });
    // The move already happened; the response was lost.
    vi.mocked(storage.promote).mockRejectedValueOnce(new Error("Object not found"));
    vi.mocked(storage.exists ?? (() => undefined));

    const result = await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(result).toMatchObject({ ok: true });
    expect(storage.exists).toHaveBeenCalledWith("documents/doc-1.pdf");
  });

  it("reuses an existing same-scope document and cleans the redundant pending blob", async () => {
    const { deps, store, removed } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });
    vi.mocked(store.prepare).mockResolvedValueOnce({
      sourceDocumentId: "existing-doc",
      permanentObjectPath: null,
      duplicate: true,
      requiresPromotion: false,
    });
    vi.mocked(store.commit).mockResolvedValueOnce({
      sourceDocumentId: "existing-doc",
      duplicate: true,
      associated: true,
      associationConflict: false,
      lockVersion: 4,
    });

    const { deps: _unused } = { deps };
    const result = await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(result).toMatchObject({ ok: true, sourceDocumentId: "existing-doc", duplicate: true });
    // No second permanent object, and the existing document's details are not
    // touched: only the accepted 8A lifecycle decides metadata.
    expect(deps.storage.promote).not.toHaveBeenCalled();
    expect(removed).toEqual(["pending/intent-1.pdf"]);
  });

  it("reports an association conflict without claiming the document was selected", async () => {
    const { deps, store } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });
    vi.mocked(store.commit).mockResolvedValueOnce({
      sourceDocumentId: "doc-1",
      duplicate: false,
      associated: false,
      associationConflict: true,
      lockVersion: 9,
    });

    const result = await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      associated: false,
      associationConflict: true,
      lockVersion: 9,
    });
  });

  it("retrying a finalized intent reads back state without re-validating or promoting", async () => {
    const { deps, store, storage } = harness({
      intents: [intentRow({ state: "finalized", permanent_object_path: "documents/doc-1.pdf" })],
    });
    vi.mocked(store.commit).mockResolvedValueOnce({
      sourceDocumentId: "doc-1",
      duplicate: false,
      associated: true,
      associationConflict: false,
      lockVersion: 4,
    });

    const result = await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(result).toMatchObject({ ok: true, associated: true, lockVersion: 4 });
    expect(storage.download).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
    expect(storage.promote).not.toHaveBeenCalled();
  });

  it("passes the guest credential hash, never a browser-supplied identity", async () => {
    const { deps, prepared, committed } = harness({
      intents: [
        intentRow({ contract_id: null, guest_workspace_id: GUEST, target_revision_id: null }),
      ],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });

    await finalizeUploadHandler(deps, { kind: "guest", token: GUEST_TOKEN }, {
      intentId: "intent-1",
      expectedLockVersion: 2,
    });

    const hash = await hashGuestToken(GUEST_TOKEN);
    expect(prepared[0]).toMatchObject({ intentId: "intent-1", guestTokenHash: hash, ownerUserId: null });
    expect(committed[0]).toMatchObject({ guestTokenHash: hash, ownerUserId: null });
  });

  it("refuses to finalize an intent belonging to someone else", async () => {
    const { deps, storage } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });

    await expect(
      finalizeUploadHandler(deps, { kind: "user", userId: OTHER }, {
        intentId: "intent-1",
        expectedLockVersion: 3,
      }),
    ).rejects.toThrow();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload before parsing", async () => {
    const { deps, store } = harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": new Uint8Array(MAX_DOCUMENT_BYTES + 1) },
    });

    const result = await finalizeUploadHandler(deps, { kind: "user", userId: OWNER }, {
      intentId: "intent-1",
      expectedLockVersion: 3,
    });

    expect(result).toMatchObject({ ok: false, code: "too_large" });
    expect(store.prepare).not.toHaveBeenCalled();
  });
});
