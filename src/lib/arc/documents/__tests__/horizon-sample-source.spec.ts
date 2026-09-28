/**
 * Horizon New Analysis source-document parity.
 *
 * The seeding helper runs ARC's real upload handlers and the real server PDF
 * validator on the real canonical bytes; only the database and Storage
 * boundaries are substituted with an in-memory, per-workspace model.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { hashGuestToken } from "@/lib/arc/persistence/guest";
import { listRecentAnalysesHandler } from "@/lib/arc/persistence/guest-session.handlers";

import type { DocumentStorage, DocumentStore, IntentRow } from "../documents.handlers";
import {
  HORIZON_SAMPLE_DISPLAY_NAME,
  HORIZON_SAMPLE_FILENAME,
  HORIZON_SAMPLE_SHA256,
  HORIZON_SAMPLE_UNAVAILABLE,
  seedHorizonSampleSource,
  type HorizonSeedDeps,
} from "../horizon-sample-source";
import { loadHorizonSampleBytes } from "../horizon-sample-source.server";

const CANONICAL = new Uint8Array(
  readFileSync("public/samples/horizon-logistics-saas-order-form.pdf"),
);

interface Doc {
  id: string;
  workspaceId: string;
  path: string;
  sha256: string;
  displayName: string;
  originalFilename: string;
}

/** In-memory model: workspaces own their own documents and selections. */
function world() {
  const workspaces = new Map<string, { tokenHash: string }>();
  const intents = new Map<string, IntentRow & { validated?: { sha256: string } }>();
  const objects = new Map<string, Uint8Array>();
  const docs = new Map<string, Doc>();
  const selections = new Set<string>(); // `${workspaceId}:${docId}`
  const aiRuns: unknown[] = [];
  const queued: string[] = [];
  let seq = 0;

  const store: DocumentStore = {
    contractIsOwnedBy: async () => false,
    findDraftRevision: async () => null,
    findActiveGuest: async (tokenHash) => {
      for (const [id, ws] of workspaces) if (ws.tokenHash === tokenHash) return { id, lockVersion: 1 };
      return null;
    },
    createIntent: async (row) => {
      intents.set(row.id, { ...row, state: "pending" } as unknown as IntentRow);
      return { id: row.id, expiresAt: row.expires_at };
    },
    loadIntent: async (id) => intents.get(id) ?? null,
    markIntentFailed: async (id) => {
      const i = intents.get(id);
      if (i) intents.set(id, { ...i, state: "failed" });
    },
    queueDeletion: async (path) => {
      queued.push(path);
    },
    prepare: async (args) => {
      const intent = intents.get(args.intentId)!;
      const id = `doc-${++seq}`;
      const path = `documents/${id}.pdf`;
      docs.set(id, {
        id,
        workspaceId: intent.guest_workspace_id!,
        path,
        sha256: args.sha256,
        displayName: intent.display_name,
        originalFilename: intent.original_filename,
      });
      intents.set(args.intentId, { ...intent, state: "prepared", resolved_source_document_id: id } as IntentRow);
      return { sourceDocumentId: id, permanentObjectPath: path, duplicate: false, requiresPromotion: true };
    },
    commit: async (args) => {
      const intent = intents.get(args.intentId)!;
      const id = intent.resolved_source_document_id!;
      selections.add(`${intent.guest_workspace_id}:${id}`);
      intents.set(args.intentId, { ...intent, state: "finalized" });
      return { sourceDocumentId: id, duplicate: false, associated: true, associationConflict: false, lockVersion: 2 };
    },
    findOwnedDocument: async () => null,
    findGuestDocument: async (docId, workspaceId) => {
      const d = docs.get(docId);
      return d && d.workspaceId === workspaceId
        ? { id: d.id, storageObjectPath: d.path, originalFilename: d.originalFilename }
        : null;
    },
  };

  const storage: DocumentStorage = {
    createPendingUploadTarget: async (path) => ({ token: "t", path }),
    download: async (path) => {
      const b = objects.get(path);
      if (!b) throw new Error("missing");
      return b;
    },
    promote: async (from, to) => {
      objects.set(to, objects.get(from)!);
      objects.delete(from);
    },
    exists: async (path) => objects.has(path),
    remove: async (paths) => {
      for (const p of paths) objects.delete(p);
    },
    createReadUrl: async ({ objectPath }) => `signed:${objectPath}`,
  };

  /** Mirrors the relational cascade + queue triggers of a workspace delete. */
  const deleteWorkspace = vi.fn(async (id: string, tokenHash: string) => {
    const ws = workspaces.get(id);
    if (!ws || ws.tokenHash !== tokenHash) return;
    for (const d of [...docs.values()]) {
      if (d.workspaceId === id) {
        queued.push(d.path);
        docs.delete(d.id);
        selections.delete(`${id}:${d.id}`);
      }
    }
    for (const i of [...intents.values()]) {
      if (i.guest_workspace_id === id) {
        queued.push(i.pending_object_path);
        intents.delete(i.id);
      }
    }
    workspaces.delete(id);
  });

  function deps(overrides: Partial<HorizonSeedDeps> = {}): HorizonSeedDeps {
    return {
      documents: { store, storage, now: () => new Date("2026-09-28T00:00:00Z") },
      loadBytes: async () => CANONICAL,
      uploadPending: async (path, bytes) => {
        objects.set(path, bytes);
      },
      deleteWorkspace,
      removeObjects: storage.remove,
      ...overrides,
    };
  }

  async function addWorkspace(id: string) {
    const token = `token-${id}`;
    const tokenHash = await hashGuestToken(token);
    workspaces.set(id, { tokenHash });
    return { analysisId: id, token, tokenHash };
  }

  return { workspaces, docs, selections, objects, queued, aiRuns, storage, store, deps, addWorkspace, deleteWorkspace };
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("Horizon New Analysis source document", () => {
  it("bundles the single tracked canonical PDF and pins its full SHA-256", async () => {
    expect(HORIZON_SAMPLE_SHA256).toHaveLength(64);
    expect(sha(CANONICAL)).toBe(HORIZON_SAMPLE_SHA256);
    const bundled = await loadHorizonSampleBytes();
    expect(sha(bundled)).toBe(HORIZON_SAMPLE_SHA256);
  });

  it("includes the canonical document in the new analysis immediately", async () => {
    const w = world();
    const ws = await w.addWorkspace("ws-a");
    const { sourceDocumentId } = await seedHorizonSampleSource(w.deps(), ws);

    const doc = w.docs.get(sourceDocumentId)!;
    expect(doc.displayName).toBe(HORIZON_SAMPLE_DISPLAY_NAME);
    expect(doc.originalFilename).toBe(HORIZON_SAMPLE_FILENAME);
    expect(doc.workspaceId).toBe("ws-a");
    expect(w.selections.has(`ws-a:${sourceDocumentId}`)).toBe(true);
    // The stored private object is exactly the canonical content.
    expect(sha(w.objects.get(doc.path)!)).toBe(HORIZON_SAMPLE_SHA256);
    expect(doc.sha256).toBe(HORIZON_SAMPLE_SHA256);
    // Deterministic seeding: no AI run of any kind.
    expect(w.aiRuns).toHaveLength(0);
  });

  it("gives every Horizon analysis its own independent copy", async () => {
    const w = world();
    const a = await seedHorizonSampleSource(w.deps(), await w.addWorkspace("ws-a"));
    const b = await seedHorizonSampleSource(w.deps(), await w.addWorkspace("ws-b"));
    const da = w.docs.get(a.sourceDocumentId)!;
    const db = w.docs.get(b.sourceDocumentId)!;
    expect(da.id).not.toBe(db.id);
    expect(da.path).not.toBe(db.path);
    expect(await w.store.findGuestDocument(da.id, "ws-b")).toBeNull();

    // Removing one workspace leaves the other's copy intact.
    await w.deleteWorkspace("ws-a", w.workspaces.get("ws-a")!.tokenHash);
    expect(w.docs.has(da.id)).toBe(false);
    expect(w.docs.has(db.id)).toBe(true);
    expect(w.objects.has(db.path)).toBe(true);
  });

  it("fails closed on non-canonical bytes and removes the new workspace", async () => {
    const w = world();
    const ws = await w.addWorkspace("ws-a");
    const tampered = CANONICAL.slice();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    await expect(
      seedHorizonSampleSource(w.deps({ loadBytes: async () => tampered }), ws),
    ).rejects.toThrow(HORIZON_SAMPLE_UNAVAILABLE);
    expect(w.workspaces.has("ws-a")).toBe(false);
    expect(w.docs.size).toBe(0);
  });

  it("compensates when seeding fails after the workspace and intent exist", async () => {
    const w = world();
    const ws = await w.addWorkspace("ws-a");
    const sibling = await w.addWorkspace("ws-sibling");
    await expect(
      seedHorizonSampleSource(
        w.deps({
          uploadPending: async (path, bytes) => {
            w.objects.set(path, bytes);
            throw new Error("storage went away mid-upload");
          },
        }),
        ws,
      ),
    ).rejects.toThrow(HORIZON_SAMPLE_UNAVAILABLE);
    expect(w.deleteWorkspace).toHaveBeenCalledWith("ws-a", ws.tokenHash);
    expect(w.workspaces.has("ws-a")).toBe(false);
    expect(w.workspaces.has("ws-sibling")).toBe(true);
    expect(w.docs.size).toBe(0);
    expect(w.selections.size).toBe(0);
    // The pending object is removed now and was also durably queued.
    expect([...w.objects.keys()].filter((k) => k.startsWith("pending/"))).toHaveLength(0);
    expect(w.queued.some((p) => p.startsWith("pending/"))).toBe(true);
    expect(sibling.analysisId).toBe("ws-sibling");
  });

  it("compensates when finalization fails after the document is prepared", async () => {
    const w = world();
    const ws = await w.addWorkspace("ws-a");
    const commit = w.store.commit;
    w.store.commit = async () => {
      throw new Error("commit failed");
    };
    await expect(seedHorizonSampleSource(w.deps(), ws)).rejects.toThrow(HORIZON_SAMPLE_UNAVAILABLE);
    w.store.commit = commit;
    expect(w.workspaces.has("ws-a")).toBe(false);
    expect(w.docs.size).toBe(0);
    expect(w.queued.some((p) => p.startsWith("documents/"))).toBe(true);
  });

  it("still fails the click when compensation itself fails", async () => {
    const w = world();
    const ws = await w.addWorkspace("ws-a");
    await expect(
      seedHorizonSampleSource(
        w.deps({
          loadBytes: async () => new Uint8Array([1, 2, 3]),
          deleteWorkspace: async () => {
            throw new Error("db down");
          },
        }),
        ws,
      ),
    ).rejects.toThrow(HORIZON_SAMPLE_UNAVAILABLE);
  });
});

describe("Recent Analyses keeps the Horizon sample label (exact origin)", () => {
  it("shows Sample — Horizon for sample:horizon even with a source document", async () => {
    const token = "session-token";
    const now = new Date("2026-09-28T00:00:00Z");
    const later = "2026-09-28T09:00:00Z";
    const rows = [
      { id: "h", origin: "sample:horizon", firstSourceName: HORIZON_SAMPLE_DISPLAY_NAME },
      { id: "u", origin: "upload", firstSourceName: "My contract.pdf" },
      { id: "b", origin: "blank", firstSourceName: null },
      { id: "x", origin: "sample:horizonx", firstSourceName: "Other.pdf" },
    ].map((r, i) => ({
      ...r,
      draft_json: null,
      updated_at: new Date(now.getTime() - i * 1000).toISOString(),
      expires_at: later,
      runStages: [],
      reviewItems: null,
    }));
    const store = {
      resolveSession: async () => ({ id: "s", expiresAt: later }),
      listSummaries: async () => rows,
    };
    const list = await listRecentAnalysesHandler(
      {
        store: store as never,
        now: () => now,
        reviewNeeded: () => false,
        sampleLabel: (origin) => (origin === "sample:horizon" ? "Horizon Logistics" : null),
      },
      { sessionToken: token },
    );
    const byId = Object.fromEntries(list.map((r) => [r.analysisId, r]));
    expect(byId["h"]!.source).toBe("Sample — Horizon Logistics");
    expect(byId["h"]!.status).toBe("Draft");
    expect(byId["u"]!.source).toBe("My contract.pdf");
    expect(byId["b"]!.source).toBe("No source document");
    expect(byId["x"]!.source).toBe("Other.pdf");
  });
});
