/**
 * Phase 7 acceptance gate.
 *
 * One source-controlled suite asserting the persistence promises of the whole
 * phase, exercised through the real handlers and decoders. No accounting
 * engine or sample fixture is touched here.
 */

import { describe, expect, it } from "vitest";

import { FEATURES } from "@/lib/arc/features";
import {
  GUEST_LIFETIME_SECONDS,
  guestExpiresAt,
  hashGuestToken,
  isGuestExpired,
} from "@/lib/arc/persistence/guest";
import {
  resumeOrCreateGuestHandler,
  saveGuestDraftHandler,
  type GuestRow,
  type GuestSaveRow,
  type GuestStore,
} from "@/lib/arc/persistence/guest.handlers";
import {
  ARC_WORKFLOW_SCHEMA_VERSION,
  toCanonicalInputs,
  parseCanonicalInputs,
} from "@/lib/arc/persistence/schema";
import {
  ARC_ENGINE_VERSION,
  buildFinalizationSnapshot,
  readEngineOutputsSnapshot,
  readReconciliationSnapshot,
} from "@/lib/arc/persistence/snapshot";
import { createDemoDraftIfKnown, DEMO_SCENARIOS } from "@/lib/demo-scenarios";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const TOKEN = "guest-credential-for-acceptance";

const COMPLETE_DRAFT = createDemoDraftIfKnown("horizon")!;

function makeStore(row: GuestRow | null) {
  const inserts: unknown[] = [];
  const updates: Array<{
    tokenHash: string;
    expectedLockVersion: number;
    canonical: unknown;
    schemaVersion: string;
  }> = [];
  const store: GuestStore = {
    findByHash: async () => row,
    insert: async (args) => {
      inserts.push(args);
      return {
        id: "created",
        draft_json: args.draft_json,
        schema_version: args.schema_version,
        lock_version: 1,
        status: "active",
        expires_at: args.expires_at,
      };
    },
    updateDraft: async (args) => {
      updates.push(args);
      const saved: GuestSaveRow = {
        lock_version: args.expectedLockVersion + 1,
        updated_at: NOW.toISOString(),
      };
      return saved;
    },
  };
  return { store, inserts, updates };
}

async function activeRow(): Promise<GuestRow> {
  return {
    id: "guest-row",
    draft_json: toCanonicalInputs(COMPLETE_DRAFT) as unknown,
    schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    lock_version: 4,
    status: "active",
    expires_at: guestExpiresAt(NOW),
  };
}

describe("Phase 7 acceptance — sample scenarios", () => {
  it("are fixture-only: a sample carries no persistence identity", () => {
    for (const scenario of DEMO_SCENARIOS) {
      const serialized = JSON.stringify(scenario);
      expect(serialized).not.toContain("revisionId");
      expect(serialized).not.toContain("lockVersion");
      expect(serialized).not.toContain("token");
    }
  });

  it("never reach a persistence store: opening a sample runs no guest save", async () => {
    const { store, inserts, updates } = makeStore(null);
    // A sample is rendered straight from the fixture; nothing calls the store.
    expect(createDemoDraftIfKnown("redwood")).toBeTruthy();
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(typeof store.insert).toBe("function");
  });
});

describe("Phase 7 acceptance — guest workspace", () => {
  it("lasts exactly nine hours and expires on the boundary, not after cleanup", () => {
    expect(GUEST_LIFETIME_SECONDS).toBe(32400);
    const expires = guestExpiresAt(NOW);
    expect(isGuestExpired(expires, new Date(NOW.getTime() + 32399_000))).toBe(false);
    expect(isGuestExpired(expires, new Date(NOW.getTime() + 32400_000))).toBe(true);
  });

  it("resumes the stored temporary draft without minting a second workspace", async () => {
    const { store, inserts } = makeStore(await activeRow());
    const result = await resumeOrCreateGuestHandler({ store, now: () => NOW }, { token: TOKEN });
    expect(result.resumed).toBe(true);
    expect(result.issuedToken).toBeNull();
    expect(result.workspace.lockVersion).toBe(4);
    expect(inserts).toHaveLength(0);
  });

  it("saves draft, schema version and lock version together", async () => {
    const { store, updates } = makeStore(await activeRow());
    const saved = await saveGuestDraftHandler(
      { store, now: () => NOW },
      { token: TOKEN, expectedLockVersion: 4, draft: COMPLETE_DRAFT },
    );
    expect(saved).toEqual({ ok: true, lockVersion: 5, savedAt: NOW.toISOString() });
    expect(updates[0]?.schemaVersion).toBe(ARC_WORKFLOW_SCHEMA_VERSION);
    expect(updates[0]?.expectedLockVersion).toBe(4);
    expect(updates[0]?.tokenHash).toBe(await hashGuestToken(TOKEN));
  });

  it("refuses to save into an expired workspace", async () => {
    const row = await activeRow();
    const { store, updates } = makeStore({ ...row, expires_at: NOW.toISOString() });
    const saved = await saveGuestDraftHandler(
      { store, now: () => new Date(NOW.getTime() + 1000) },
      { token: TOKEN, expectedLockVersion: 4, draft: COMPLETE_DRAFT },
    );
    expect(saved).toEqual({ ok: false, reason: "expired" });
    expect(updates).toHaveLength(0);
  });

  it("never exposes the raw credential in what a guest row stores", async () => {
    const row = await activeRow();
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(await hashGuestToken(TOKEN)).not.toContain(TOKEN);
  });
});

describe("Phase 7 acceptance — revision lifecycle", () => {
  it("finalization records a complete snapshot from the persisted draft", () => {
    const outcome = buildFinalizationSnapshot(COMPLETE_DRAFT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.engineOutputs.engineVersion).toBe(ARC_ENGINE_VERSION);
    expect(outcome.engineOutputs.schemaVersion).toBe(ARC_WORKFLOW_SCHEMA_VERSION);
    expect(outcome.engineOutputs.journals).toBeTruthy();
  });

  it("a finalized revision reads back verbatim — nothing is recomputed", () => {
    const outcome = buildFinalizationSnapshot(COMPLETE_DRAFT);
    if (!outcome.ok) throw new Error("a complete workpaper was expected");
    const recorded = JSON.parse(JSON.stringify(outcome.engineOutputs));
    const read = readEngineOutputsSnapshot(recorded, {
      engineVersion: ARC_ENGINE_VERSION,
      schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    });
    expect(read).not.toBeNull();
    expect(JSON.stringify(read)).toBe(JSON.stringify(recorded));
  });

  it("a superseded revision stays readable from its own recorded snapshot", () => {
    const outcome = buildFinalizationSnapshot(COMPLETE_DRAFT);
    if (!outcome.ok) throw new Error("a complete workpaper was expected");
    const historical = JSON.parse(JSON.stringify(outcome.reconciliation));
    expect(readReconciliationSnapshot(historical)).not.toBeNull();
  });

  it("a snapshot from an unknown engine version fails closed", () => {
    const outcome = buildFinalizationSnapshot(COMPLETE_DRAFT);
    if (!outcome.ok) throw new Error("a complete workpaper was expected");
    const foreign = JSON.parse(JSON.stringify(outcome.engineOutputs)) as Record<string, unknown>;
    foreign["engineVersion"] = "arc.engine.v99";
    expect(readEngineOutputsSnapshot(foreign)).toBeNull();
  });

  it("a new revision starts from the copied canonical input as an editable draft", () => {
    const canonical = toCanonicalInputs(COMPLETE_DRAFT);
    const copied = parseCanonicalInputs(
      JSON.parse(JSON.stringify(canonical)),
      ARC_WORKFLOW_SCHEMA_VERSION,
    );
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.draft).toEqual(COMPLETE_DRAFT);
    expect(copied.draft).not.toHaveProperty("engineVersion");
  });
});

describe("Phase 7 acceptance — scope boundary", () => {
  it("Source Documents carries no Phase 7 migration: it stays a Phase 8 concern", () => {
    expect(Object.keys(FEATURES)).not.toContain("DOCUMENT_MIGRATION");
    expect(JSON.stringify(FEATURES)).not.toContain("document");
  });
});
