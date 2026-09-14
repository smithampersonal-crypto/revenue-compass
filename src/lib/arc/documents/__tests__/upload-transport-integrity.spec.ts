/**
 * Phase 8E acceptance — transport integrity of an uploaded PDF.
 *
 * A PDF that a visitor uploaded successfully once was later rejected as
 * unreadable. The document was never at fault: the bytes the server read back
 * from private storage were not the bytes that were uploaded.
 *
 * These assertions run the real `finalizeUploadHandler` and the real PDF
 * validator; only the database and Storage boundaries are substituted.
 */

import { describe, expect, it, vi } from "vitest";

import {
  finalizeUploadHandler,
  type DocumentDeps,
  type DocumentStorage,
  type DocumentStore,
  type IntentRow,
  type UploadReadDiagnostic,
} from "../documents.handlers";
import { buildPdf, passwordProtectedPdf } from "./pdf-fixtures";

const OWNER = "11111111-1111-1111-1111-111111111111";
const CONTRACT = "33333333-3333-3333-3333-333333333333";
const REVISION = "44444444-4444-4444-4444-444444444444";
const PENDING = "pending/intent-1.pdf";

const encoder = new TextEncoder();

/** A four-page text PDF padded to exactly the uploaded file's byte profile. */
function horizonVelaProfilePdf(): Uint8Array {
  const base = buildPdf({ pages: 4, text: "SaaS sales contract package Horizon Vela" });
  const target = 47_654;
  if (base.byteLength >= target) return base;
  const padded = new Uint8Array(target);
  padded.set(base, 0);
  // Trailing padding after %%EOF: ignored by every conforming reader.
  padded.fill(0x20, base.byteLength);
  return padded;
}

/** Full-size bytes that open with a PDF signature but cannot be parsed. */
function headerValidGarbage(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(encoder.encode("%PDF-1.4\n"), 0);
  bytes.fill(0x41, 9);
  return bytes;
}

interface HarnessOptions {
  /** One entry per read-back attempt, in order. */
  reads: Uint8Array[];
  declaredByteSize?: number | null;
}

function harness(options: HarnessOptions) {
  const reads = [...options.reads];
  const objects: Record<string, Uint8Array> = { [PENDING]: reads[0]! };
  const removed: string[] = [];
  const diagnostics: { intentId: string; attempts: UploadReadDiagnostic[] }[] = [];
  const intents = new Map<string, IntentRow>();

  intents.set("intent-1", {
    id: "intent-1",
    contract_id: CONTRACT,
    guest_workspace_id: null,
    target_revision_id: REVISION,
    pending_object_path: PENDING,
    permanent_object_path: null,
    resolved_source_document_id: null,
    is_duplicate: null,
    state: "pending",
    expires_at: "2026-09-14T02:00:00.000Z",
    original_filename: "SaaS_Sales_Contract_Package_Horizon_Vela.pdf",
    display_name: "SaaS_Sales_Contract_Package_Horizon_Vela",
    declared_byte_size: options.declaredByteSize ?? null,
  });

  const store: DocumentStore = {
    contractIsOwnedBy: vi.fn(async (contractId, userId) => contractId === CONTRACT && userId === OWNER),
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
    queueDeletion: vi.fn(async () => undefined),
    prepare: vi.fn(async () => ({
      sourceDocumentId: "doc-1",
      permanentObjectPath: "documents/doc-1.pdf",
      duplicate: false,
      requiresPromotion: true,
    })),
    commit: vi.fn(async () => ({
      sourceDocumentId: "doc-1",
      duplicate: false,
      associated: true,
      associationConflict: false,
      lockVersion: 4,
    })),
    findOwnedDocument: vi.fn(async () => null),
    findGuestDocument: vi.fn(async () => null),
    recordUploadDiagnostics: vi.fn(async (intentId, attempts) => {
      diagnostics.push({ intentId, attempts });
    }),
  };

  let readIndex = 0;
  const storage: DocumentStorage = {
    createPendingUploadTarget: vi.fn(async (path: string) => ({ token: "signed-token", path })),
    download: vi.fn(async () => {
      const bytes = reads[Math.min(readIndex, reads.length - 1)]!;
      readIndex += 1;
      return bytes;
    }),
    promote: vi.fn(async (from: string, to: string) => {
      objects[to] = objects[from] ?? new Uint8Array();
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

  const deps: DocumentDeps = { store, storage, now: () => new Date("2026-09-14T00:30:00.000Z") };
  return { deps, store, storage, intents, objects, removed, diagnostics };
}

async function finalize(deps: DocumentDeps) {
  return finalizeUploadHandler(
    deps,
    { kind: "user", userId: OWNER },
    { intentId: "intent-1", expectedLockVersion: 3 },
  );
}

describe("an unfinished upload is never reported as a bad PDF", () => {
  it("reports upload_incomplete when the read-back is shorter than the declared file", async () => {
    const complete = horizonVelaProfilePdf();
    const short = complete.subarray(0, 12_000);
    const { deps, store } = harness({ reads: [short, short], declaredByteSize: 47_654 });

    const result = await finalize(deps);

    expect(result).toMatchObject({ ok: false, code: "upload_incomplete" });
    expect(result).not.toMatchObject({ code: "invalid_pdf" });
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it("reports upload_incomplete for an empty read-back", async () => {
    const { deps } = harness({ reads: [new Uint8Array(), new Uint8Array()], declaredByteSize: null });

    expect(await finalize(deps)).toMatchObject({ ok: false, code: "upload_incomplete" });
  });
});

describe("one read-back retry", () => {
  it("succeeds when a short first read is followed by a complete valid read", async () => {
    const complete = horizonVelaProfilePdf();
    const { deps, storage } = harness({
      reads: [complete.subarray(0, 9_000), complete],
      declaredByteSize: complete.byteLength,
    });

    const result = await finalize(deps);

    expect(result).toMatchObject({ ok: true, sourceDocumentId: "doc-1" });
    expect(storage.download).toHaveBeenCalledTimes(2);
  });

  it("succeeds when a full-sized header-valid first read is unreadable and the second read is valid", async () => {
    const complete = horizonVelaProfilePdf();
    const { deps, storage } = harness({
      reads: [headerValidGarbage(complete.byteLength), complete],
      declaredByteSize: complete.byteLength,
    });

    const result = await finalize(deps);

    expect(result).toMatchObject({ ok: true, sourceDocumentId: "doc-1" });
    expect(storage.download).toHaveBeenCalledTimes(2);
  });

  it("creates exactly one document and one permanent object when the retry succeeds", async () => {
    const complete = horizonVelaProfilePdf();
    const { deps, store, storage, objects } = harness({
      reads: [complete.subarray(0, 5_000), complete],
      declaredByteSize: complete.byteLength,
    });

    await finalize(deps);

    expect(store.prepare).toHaveBeenCalledTimes(1);
    expect(store.commit).toHaveBeenCalledTimes(1);
    expect(storage.promote).toHaveBeenCalledTimes(1);
    expect(Object.keys(objects)).toEqual(["documents/doc-1.pdf"]);
  });

  it("reports a genuine invalid_pdf when identical full-sized bytes fail twice", async () => {
    const garbage = headerValidGarbage(20_000);
    const { deps, store, storage, intents } = harness({
      reads: [garbage, garbage],
      declaredByteSize: garbage.byteLength,
    });

    const result = await finalize(deps);

    expect(result).toMatchObject({ ok: false, code: "invalid_pdf" });
    expect(storage.download).toHaveBeenCalledTimes(2);
    // Phase 8B lifecycle is unchanged: terminal first, then cleanup.
    expect(intents.get("intent-1")?.state).toBe("failed");
    expect(store.markIntentFailed).toHaveBeenCalledWith("intent-1");
    expect(store.prepare).not.toHaveBeenCalled();
  });

  it("never retries a semantic rejection", async () => {
    const protectedPdf = passwordProtectedPdf();
    const first = harness({ reads: [protectedPdf, protectedPdf] });
    expect(await finalize(first.deps)).toMatchObject({ ok: false, code: "password_protected" });
    expect(first.storage.download).toHaveBeenCalledTimes(1);

    const imageOnly = buildPdf({ pages: 2, text: "" });
    const second = harness({ reads: [imageOnly, imageOnly] });
    expect(await finalize(second.deps)).toMatchObject({ ok: false, code: "no_extractable_text" });
    expect(second.storage.download).toHaveBeenCalledTimes(1);
  });
});

describe("diagnostics", () => {
  it("records both attempts, including the first failure, when the retry succeeds", async () => {
    const complete = horizonVelaProfilePdf();
    const { deps, diagnostics } = harness({
      reads: [complete.subarray(0, 4_000), complete],
      declaredByteSize: complete.byteLength,
    });

    await finalize(deps);

    expect(diagnostics).toHaveLength(1);
    const attempts = diagnostics[0]!.attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt: 1,
      declaredByteSize: complete.byteLength,
      observedByteSize: 4_000,
      pdfSignature: true,
      code: "upload_incomplete",
    });
    expect(attempts[1]).toMatchObject({
      attempt: 2,
      observedByteSize: complete.byteLength,
      code: null,
    });
    // Technical facts only: no PDF text, no raw bytes.
    for (const attempt of attempts) {
      expect(attempt.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(attempt).sort()).toEqual([
        "attempt",
        "code",
        "declaredByteSize",
        "observedByteSize",
        "pdfSignature",
        "sha256",
      ]);
    }
  });

  it("never blocks an upload when diagnostics cannot be written", async () => {
    const complete = horizonVelaProfilePdf();
    const { deps, store } = harness({
      reads: [complete.subarray(0, 4_000), complete],
      declaredByteSize: complete.byteLength,
    });
    vi.mocked(store.recordUploadDiagnostics!).mockRejectedValueOnce(new Error("diagnostics down"));

    expect(await finalize(deps)).toMatchObject({ ok: true });
  });
});

describe("the uploaded file itself", () => {
  it("accepts the Horizon/Vela profile: 47,654 bytes, four pages", async () => {
    const complete = horizonVelaProfilePdf();
    expect(complete.byteLength).toBe(47_654);

    const { deps, store } = harness({ reads: [complete], declaredByteSize: 47_654 });

    expect(await finalize(deps)).toMatchObject({ ok: true, sourceDocumentId: "doc-1" });
    expect(store.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ byteSize: 47_654, pageCount: 4 }),
    );
  });
});
