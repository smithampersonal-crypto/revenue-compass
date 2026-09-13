/**
 * Phase 8B — retry and durable-cleanup invariants.
 *
 * Three failure states are asserted here against the real orchestration:
 *   - a prepared intent resumes without re-downloading or re-validating bytes;
 *   - cleanup of a pending blob can never be silently abandoned;
 *   - a failed intent is terminal and can never be resurrected.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  finalizeUploadHandler,
  type DocumentDeps,
  type DocumentStorage,
  type DocumentStore,
  type IntentRow,
} from "../documents.handlers";
import { corruptBytes, validTextPdf } from "./pdf-fixtures";

const OWNER = "11111111-1111-1111-1111-111111111111";
const CONTRACT = "33333333-3333-3333-3333-333333333333";
const REVISION = "44444444-4444-4444-4444-444444444444";

interface HarnessOptions {
  intents?: IntentRow[];
  objects?: Record<string, Uint8Array>;
}

function harness(options: HarnessOptions = {}) {
  const intents = new Map<string, IntentRow>();
  for (const intent of options.intents ?? []) intents.set(intent.id, intent);
  const objects: Record<string, Uint8Array> = { ...(options.objects ?? {}) };
  const deletionQueue: { path: string; reason: string }[] = [];
  const removed: string[] = [];
  const committed: Record<string, unknown>[] = [];

  const store: DocumentStore = {
    contractIsOwnedBy: vi.fn(
      async (contractId, userId) => contractId === CONTRACT && userId === OWNER,
    ),
    findDraftRevision: vi.fn(async () => ({
      id: REVISION,
      contractId: CONTRACT,
      status: "draft",
      lockVersion: 3,
    })),
    findActiveGuest: vi.fn(async () => null),
    createIntent: vi.fn(async (row) => ({ id: row.id, expiresAt: row.expires_at })),
    loadIntent: vi.fn(async (intentId) => intents.get(intentId) ?? null),
    markIntentFailed: vi.fn(async (intentId) => {
      const intent = intents.get(intentId);
      if (intent) intents.set(intentId, { ...intent, state: "failed" });
    }),
    queueDeletion: vi.fn(async (path, reason) => {
      // Conflict-safe by construction: the same bucket/path is one job.
      if (!deletionQueue.some((job) => job.path === path)) deletionQueue.push({ path, reason });
    }),
    prepare: vi.fn(async () => ({
      sourceDocumentId: "doc-1",
      permanentObjectPath: "documents/doc-1.pdf",
      duplicate: false,
      requiresPromotion: true,
    })),
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
    createPendingUploadTarget: vi.fn(async (path: string) => ({ token: "signed-token", path })),
    download: vi.fn(async (path: string) => {
      const bytes = objects[path];
      if (!bytes) throw new Error(`missing object ${path}`);
      return bytes;
    }),
    promote: vi.fn(async (from: string, to: string) => {
      const bytes = objects[from];
      if (!bytes) throw new Error("Object not found");
      objects[to] = bytes;
      delete objects[from];
    }),
    remove: vi.fn(async (paths: string[]) => {
      for (const path of paths) {
        removed.push(path);
        delete objects[path];
      }
    }),
    exists: vi.fn(async (path: string) => path in objects),
    createReadUrl: vi.fn(async () => "https://example.test/signed"),
  };

  const deps: DocumentDeps = { store, storage, now: () => new Date("2026-09-13T00:00:00.000Z") };
  return { deps, store, storage, intents, objects, deletionQueue, removed, committed };
}

function intentRow(overrides: Partial<IntentRow> = {}): IntentRow {
  return {
    id: "intent-1",
    contract_id: CONTRACT,
    guest_workspace_id: null,
    target_revision_id: REVISION,
    pending_object_path: "pending/intent-1.pdf",
    permanent_object_path: null,
    resolved_source_document_id: null,
    is_duplicate: null,
    state: "pending",
    expires_at: "2026-09-13T01:00:00.000Z",
    original_filename: "agreement.pdf",
    display_name: "Master agreement",
    ...overrides,
  };
}

describe("prepared-state resume", () => {
  it("commits a promoted-but-uncommitted upload without re-downloading or re-validating", async () => {
    // Validation succeeded, prepare succeeded, the object was promoted, and
    // only the commit was lost. The pending blob is already gone.
    const { deps, store, storage, committed } = harness({
      intents: [
        intentRow({
          state: "prepared",
          permanent_object_path: "documents/doc-1.pdf",
          resolved_source_document_id: "doc-1",
          is_duplicate: false,
        }),
      ],
      objects: { "documents/doc-1.pdf": validTextPdf() },
    });

    const result = await finalizeUploadHandler(
      deps,
      { kind: "user", userId: OWNER },
      { intentId: "intent-1", expectedLockVersion: 3 },
    );

    expect(result).toMatchObject({ ok: true, sourceDocumentId: "doc-1", lockVersion: 4 });
    // No bytes are fetched and nothing is validated a second time: the
    // prepared state is the server's own proof that validation passed.
    expect(storage.download).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
    // Exactly one document, and exactly one lock movement.
    expect(store.commit).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([
      {
        intentId: "intent-1",
        ownerUserId: OWNER,
        guestTokenHash: null,
        expectedLockVersion: 3,
      },
    ]);
  });

  it("resumes promotion when the pending object is still the only copy", async () => {
    const { deps, store, storage, objects } = harness({
      intents: [
        intentRow({
          state: "prepared",
          permanent_object_path: "documents/doc-1.pdf",
          resolved_source_document_id: "doc-1",
          is_duplicate: false,
        }),
      ],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });

    const result = await finalizeUploadHandler(
      deps,
      { kind: "user", userId: OWNER },
      { intentId: "intent-1", expectedLockVersion: 3 },
    );

    expect(result).toMatchObject({ ok: true, sourceDocumentId: "doc-1" });
    expect(storage.promote).toHaveBeenCalledWith("pending/intent-1.pdf", "documents/doc-1.pdf");
    expect(objects["documents/doc-1.pdf"]).toBeDefined();
    expect(objects["pending/intent-1.pdf"]).toBeUndefined();
    expect(storage.download).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
  });

  it("resumes a prepared duplicate by cleaning the redundant pending object only", async () => {
    const { deps, store, storage, removed } = harness({
      intents: [
        intentRow({
          state: "prepared",
          permanent_object_path: null,
          resolved_source_document_id: "existing-doc",
          is_duplicate: true,
        }),
      ],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });
    vi.mocked(store.commit).mockResolvedValueOnce({
      sourceDocumentId: "existing-doc",
      duplicate: true,
      associated: true,
      associationConflict: false,
      lockVersion: 4,
    });

    const result = await finalizeUploadHandler(
      deps,
      { kind: "user", userId: OWNER },
      { intentId: "intent-1", expectedLockVersion: 3 },
    );

    expect(result).toMatchObject({ ok: true, sourceDocumentId: "existing-doc", duplicate: true });
    expect(storage.promote).not.toHaveBeenCalled();
    expect(removed).toEqual(["pending/intent-1.pdf"]);
    expect(storage.download).not.toHaveBeenCalled();
  });
});

describe("durable cleanup", () => {
  it("queues a durable deletion job when immediate removal fails, and continues", async () => {
    const { deps, storage, deletionQueue } = harness({
      intents: [
        intentRow({
          state: "prepared",
          permanent_object_path: null,
          resolved_source_document_id: "existing-doc",
          is_duplicate: true,
        }),
      ],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("storage unavailable"));
    vi.mocked(deps.store.commit).mockResolvedValueOnce({
      sourceDocumentId: "existing-doc",
      duplicate: true,
      associated: true,
      associationConflict: false,
      lockVersion: 4,
    });

    const result = await finalizeUploadHandler(
      deps,
      { kind: "user", userId: OWNER },
      { intentId: "intent-1", expectedLockVersion: 3 },
    );

    expect(result).toMatchObject({ ok: true });
    expect(deletionQueue).toEqual([{ path: "pending/intent-1.pdf", reason: "duplicate_upload" }]);
  });

  it("treats an already-queued bucket/path as a handled retry", async () => {
    const { deps, storage, deletionQueue, store } = harness({
      intents: [
        intentRow({
          state: "prepared",
          permanent_object_path: null,
          resolved_source_document_id: "existing-doc",
          is_duplicate: true,
        }),
      ],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });
    await store.queueDeletion("pending/intent-1.pdf", "duplicate_upload");
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("storage unavailable"));
    vi.mocked(store.commit).mockResolvedValueOnce({
      sourceDocumentId: "existing-doc",
      duplicate: true,
      associated: true,
      associationConflict: false,
      lockVersion: 4,
    });

    const result = await finalizeUploadHandler(
      deps,
      { kind: "user", userId: OWNER },
      { intentId: "intent-1", expectedLockVersion: 3 },
    );

    expect(result).toMatchObject({ ok: true });
    expect(deletionQueue).toHaveLength(1);
  });

  it("fails loudly when neither immediate removal nor the durable queue succeeds", async () => {
    const { deps, storage, store } = harness({
      intents: [
        intentRow({
          state: "prepared",
          permanent_object_path: null,
          resolved_source_document_id: "existing-doc",
          is_duplicate: true,
        }),
      ],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("storage unavailable"));
    vi.mocked(store.queueDeletion).mockRejectedValueOnce(new Error("queue unavailable"));

    // Cleanup that cannot be established anywhere is never reported as done.
    await expect(
      finalizeUploadHandler(
        deps,
        { kind: "user", userId: OWNER },
        { intentId: "intent-1", expectedLockVersion: 3 },
      ),
    ).rejects.toThrow(/unavailable/i);
    expect(store.commit).not.toHaveBeenCalled();
  });

  it("uses conflict-safe insertion for the deletion queue", () => {
    const source = readFileSync("src/lib/arc/documents/documents.store.server.ts", "utf8");
    expect(source).toContain("storage_bucket,storage_object_path");
    expect(source).toContain("ignoreDuplicates: true");
  });
});

describe("failed intents are terminal", () => {
  it("never re-validates, re-prepares or commits a failed intent", async () => {
    const { deps, store, storage } = harness({
      intents: [intentRow({ state: "failed" })],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });

    await expect(
      finalizeUploadHandler(
        deps,
        { kind: "user", userId: OWNER },
        { intentId: "intent-1", expectedLockVersion: 3 },
      ),
    ).rejects.toThrow();

    expect(storage.download).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it("rejects an intent in an unrecognised state", async () => {
    const { deps, store } = harness({
      intents: [intentRow({ state: "expired" })],
      objects: { "pending/intent-1.pdf": validTextPdf() },
    });

    await expect(
      finalizeUploadHandler(
        deps,
        { kind: "user", userId: OWNER },
        { intentId: "intent-1", expectedLockVersion: 3 },
      ),
    ).rejects.toThrow();
    expect(store.prepare).not.toHaveBeenCalled();
  });
});

describe("validation-failure durability", () => {
  function invalidHarness() {
    return harness({
      intents: [intentRow()],
      objects: { "pending/intent-1.pdf": corruptBytes() },
    });
  }

  async function finalize(deps: DocumentDeps) {
    return finalizeUploadHandler(
      deps,
      { kind: "user", userId: OWNER },
      { intentId: "intent-1", expectedLockVersion: 3 },
    );
  }

  it("marks the intent terminal before reporting a validation rejection", async () => {
    const { deps, store, intents, removed } = invalidHarness();

    const result = await finalize(deps);

    expect(result).toMatchObject({ ok: false, code: "invalid_pdf" });
    expect(store.markIntentFailed).toHaveBeenCalledWith("intent-1");
    expect(intents.get("intent-1")?.state).toBe("failed");
    expect(removed).toEqual(["pending/intent-1.pdf"]);
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it("returns a server failure, never a validation result, when the terminal state cannot be persisted", async () => {
    const { deps, store, intents } = invalidHarness();
    vi.mocked(store.markIntentFailed).mockRejectedValueOnce(new Error("intent store unavailable"));

    // An unpersisted rejection must never look like an ordinary invalid PDF:
    // the intent would still be pending and could be reprocessed.
    await expect(finalize(deps)).rejects.toThrow(/unavailable/i);
    expect(intents.get("intent-1")?.state).toBe("pending");
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it("still reports the validation rejection when cleanup falls back to the durable queue", async () => {
    const { deps, storage, intents, deletionQueue } = invalidHarness();
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("storage unavailable"));

    const result = await finalize(deps);

    expect(result).toMatchObject({ ok: false, code: "invalid_pdf" });
    expect(intents.get("intent-1")?.state).toBe("failed");
    expect(deletionQueue).toEqual([
      { path: "pending/intent-1.pdf", reason: "validation_failed" },
    ]);
  });

  it("fails openly, yet keeps the intent terminal, when cleanup cannot be established at all", async () => {
    const { deps, storage, store, intents } = invalidHarness();
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("storage unavailable"));
    vi.mocked(store.queueDeletion).mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(finalize(deps)).rejects.toThrow(/unavailable/i);
    // The intent is never reopened: the rejection stands even though the
    // orphaned blob still needs attention.
    expect(intents.get("intent-1")?.state).toBe("failed");
  });

  it("never reprocesses the terminal intent on a later retry", async () => {
    const { deps, store, storage } = invalidHarness();
    await finalize(deps);
    vi.mocked(storage.download).mockClear();

    await expect(finalize(deps)).rejects.toThrow();

    expect(storage.download).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });
});
