/**
 * Phase 8B — authorization-gated View / Download links.
 *
 * The browser supplies a document id, never a Storage path. Signed links are
 * ephemeral responses: nothing here writes one into a database record, a
 * canonical input, a snapshot, or browser storage.
 */

import { describe, expect, it, vi } from "vitest";

import { hashGuestToken } from "@/lib/arc/persistence/guest";

import {
  documentReadUrlHandler,
  type DocumentDeps,
  type DocumentStorage,
  type DocumentStore,
} from "../documents.handlers";
import { SIGNED_READ_TTL_SECONDS } from "../types";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const GUEST = "55555555-5555-5555-5555-555555555555";
const GUEST_TOKEN = "guest-credential-token";
const DOCUMENT = "66666666-6666-6666-6666-666666666666";

const DOC_ROW = {
  id: DOCUMENT,
  storageObjectPath: "documents/66666666-6666-6666-6666-666666666666.pdf",
  originalFilename: "master agreement.pdf",
};

function harness(options: { guestExpired?: boolean } = {}) {
  const readCalls: unknown[] = [];
  const store = {
    contractIsOwnedBy: vi.fn(async () => true),
    findDraftRevision: vi.fn(async () => null),
    findActiveGuest: vi.fn(async () => (options.guestExpired ? null : { id: GUEST, lockVersion: 1 })),
    createIntent: vi.fn(),
    loadIntent: vi.fn(async () => null),
    markIntentFailed: vi.fn(),
    queueDeletion: vi.fn(),
    prepare: vi.fn(),
    commit: vi.fn(),
    findOwnedDocument: vi.fn(async (documentId: string, userId: string) =>
      documentId === DOCUMENT && userId === OWNER ? DOC_ROW : null,
    ),
    findGuestDocument: vi.fn(async (documentId: string, workspaceId: string) =>
      documentId === DOCUMENT && workspaceId === GUEST ? DOC_ROW : null,
    ),
  } as unknown as DocumentStore;

  const storage = {
    createPendingUploadTarget: vi.fn(),
    download: vi.fn(),
    promote: vi.fn(),
    exists: vi.fn(),
    remove: vi.fn(),
    createReadUrl: vi.fn(async (args: unknown) => {
      readCalls.push(args);
      return "https://example.test/signed?token=abc";
    }),
  } as unknown as DocumentStorage;

  const deps: DocumentDeps = { store, storage, now: () => new Date() };
  return { deps, store, storage, readCalls };
}

describe("document read access", () => {
  it("gives the owner a fifteen-minute view link", async () => {
    const { deps, readCalls } = harness();
    const result = await documentReadUrlHandler(deps, { kind: "user", userId: OWNER }, {
      sourceDocumentId: DOCUMENT,
      disposition: "view",
    });

    expect(result.url).toContain("https://");
    expect(result.expiresInSeconds).toBe(SIGNED_READ_TTL_SECONDS);
    expect(SIGNED_READ_TTL_SECONDS).toBe(900);
    expect(readCalls[0]).toMatchObject({
      objectPath: DOC_ROW.storageObjectPath,
      disposition: "view",
    });
  });

  it("uses the immutable original filename for downloads", async () => {
    const { deps, readCalls } = harness();
    await documentReadUrlHandler(deps, { kind: "user", userId: OWNER }, {
      sourceDocumentId: DOCUMENT,
      disposition: "download",
    });

    expect(readCalls[0]).toMatchObject({
      disposition: "download",
      originalFilename: "master agreement.pdf",
    });
  });

  it("gives an active temporary workspace a link to its own document", async () => {
    const { deps, store } = harness();
    const result = await documentReadUrlHandler(deps, { kind: "guest", token: GUEST_TOKEN }, {
      sourceDocumentId: DOCUMENT,
      disposition: "view",
    });

    expect(result.url).toContain("https://");
    expect(store.findActiveGuest).toHaveBeenCalledWith(await hashGuestToken(GUEST_TOKEN));
  });

  it("refuses an expired temporary workspace", async () => {
    const { deps, storage } = harness({ guestExpired: true });
    await expect(
      documentReadUrlHandler(deps, { kind: "guest", token: GUEST_TOKEN }, {
        sourceDocumentId: DOCUMENT,
        disposition: "view",
      }),
    ).rejects.toThrow();
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });

  it("refuses a foreign document in neutral language and signs nothing", async () => {
    const { deps, storage } = harness();
    await expect(
      documentReadUrlHandler(deps, { kind: "user", userId: OTHER }, {
        sourceDocumentId: DOCUMENT,
        disposition: "view",
      }),
    ).rejects.toThrow(/not available/i);

    try {
      await documentReadUrlHandler(deps, { kind: "user", userId: OTHER }, {
        sourceDocumentId: DOCUMENT,
        disposition: "view",
      });
    } catch (error) {
      const message = (error as Error).message;
      // Neutral: no path, no owner, no contract, no filename.
      expect(message).not.toContain("documents/");
      expect(message).not.toContain("master agreement");
      expect(message).not.toContain(OWNER);
    }
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });

  it("never writes a signed link into any stored record", async () => {
    const { deps, store } = harness();
    await documentReadUrlHandler(deps, { kind: "user", userId: OWNER }, {
      sourceDocumentId: DOCUMENT,
      disposition: "view",
    });

    // Reading a document performs no writes at all.
    expect(store.createIntent).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
    expect(store.queueDeletion).not.toHaveBeenCalled();
  });
});
