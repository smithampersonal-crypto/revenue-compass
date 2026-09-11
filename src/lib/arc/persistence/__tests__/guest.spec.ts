/**
 * Phase 7E — guest credential, cookie, expiry and migration-request rules,
 * plus the dependency-injected guest handlers the production server functions
 * call.
 */

import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  GUEST_COOKIE_DEV_NAME,
  GUEST_COOKIE_SECURE_NAME,
  GUEST_LIFETIME_SECONDS,
  buildGuestCookie,
  clearGuestCookie,
  createGuestToken,
  guestExpiresAt,
  hashGuestToken,
  isGuestExpired,
  readGuestCookie,
  suggestedContractTitle,
  validateMigrationRequest,
} from "../guest";
import {
  migrateGuestWorkspaceHandler,
  resumeOrCreateGuestHandler,
  saveGuestDraftHandler,
  type GuestRow,
  type GuestStore,
} from "../guest.handlers";
import { ARC_WORKFLOW_SCHEMA_VERSION, toCanonicalInputs } from "../schema";

const NOW = new Date("2026-03-01T09:00:00.000Z");

function draftFor(customerName: string, contractNumber = ""): WorkflowDraft {
  const draft = createEmptyDraft();
  return {
    ...draft,
    contract: { ...draft.contract, customerName, contractNumber },
  };
}

function rowFor(overrides: Partial<GuestRow> = {}): GuestRow {
  return {
    id: "guest-1",
    draft_json: toCanonicalInputs(draftFor("Northwind Systems", "C-1001")) as unknown,
    schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    lock_version: 3,
    status: "active",
    expires_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
    ...overrides,
  };
}

interface Recorder {
  store: GuestStore;
  inserted: unknown[];
  updates: unknown[];
  lookups: string[];
}

function storeFor(row: GuestRow | null): Recorder {
  const recorder: Recorder = {
    inserted: [],
    updates: [],
    lookups: [],
    store: {
      findByHash: async (hash) => {
        recorder.lookups.push(hash);
        return row;
      },
      insert: async (created) => {
        recorder.inserted.push(created);
        return rowFor({ ...created, id: "new-guest", lock_version: 1, status: "active" });
      },
      updateDraft: async (args) => {
        recorder.updates.push(args);
        return { lock_version: args.expectedLockVersion + 1, updated_at: NOW.toISOString() };
      },
    },
  };
  return recorder;
}

/* ------------------------------------------------------------ credential -- */

describe("guest credential", () => {
  it("is opaque, random and carries well over 32 bytes of entropy", () => {
    const a = createGuestToken();
    const b = createGuestToken();
    expect(a).not.toEqual(b);
    // base64url of 48 random bytes
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it("is stored only as a SHA-256 hash", async () => {
    const token = createGuestToken();
    const hash = await hashGuestToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(await hashGuestToken(token)).toEqual(hash);
  });
});

describe("guest cookie", () => {
  it("uses __Host- with Secure, SameSite=Lax, Path=/ and a nine-hour Max-Age", () => {
    const cookie = buildGuestCookie("abc", true);
    expect(cookie).toContain(`${GUEST_COOKIE_SECURE_NAME}=abc`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${GUEST_LIFETIME_SECONDS}`);
    expect(GUEST_LIFETIME_SECONDS).toBe(9 * 60 * 60);
    // `__Host-` is only honoured without a Domain attribute (Phase 7F).
    expect(cookie).not.toMatch(/;\s*Domain=/i);
    expect(cookie).toBe(
      "__Host-arc_guest=abc; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=32400",
    );
  });

  it("falls back to a development-safe name on local http, still HttpOnly", () => {
    const cookie = buildGuestCookie("abc", false);
    expect(cookie).toContain(`${GUEST_COOKIE_DEV_NAME}=abc`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("Secure");
  });

  it("reads only its own cookie name and clears with Max-Age=0", () => {
    const header = `other=1; ${GUEST_COOKIE_SECURE_NAME}=tok-9; sb-access=zzz`;
    expect(readGuestCookie(header, true)).toBe("tok-9");
    expect(readGuestCookie(header, false)).toBeNull();
    expect(readGuestCookie(null, true)).toBeNull();
    expect(clearGuestCookie(true)).toContain("Max-Age=0");
  });
});

describe("guest expiry", () => {
  it("is exactly nine hours from creation", () => {
    expect(guestExpiresAt(NOW)).toBe("2026-03-01T18:00:00.000Z");
  });

  it("treats a reached expiry as unauthorized regardless of cleanup", () => {
    expect(isGuestExpired("2026-03-01T09:00:00.000Z", NOW)).toBe(true);
    expect(isGuestExpired("2026-03-01T08:59:59.000Z", NOW)).toBe(true);
    expect(isGuestExpired("2026-03-01T09:00:01.000Z", NOW)).toBe(false);
    expect(isGuestExpired("not-a-date", NOW)).toBe(true);
  });
});

/* ------------------------------------------------------- resume / create -- */

describe("resumeOrCreateGuestHandler", () => {
  it("resumes the workspace named by the credential without issuing a new one", async () => {
    const recorder = storeFor(rowFor());
    const result = await resumeOrCreateGuestHandler(
      { store: recorder.store, now: () => NOW },
      { token: "tok" },
    );
    expect(result.resumed).toBe(true);
    expect(result.issuedToken).toBeNull();
    expect(result.workspace.lockVersion).toBe(3);
    expect(result.workspace.draft.contract.customerName).toBe("Northwind Systems");
    expect(recorder.lookups[0]).toBe(await hashGuestToken("tok"));
    expect(recorder.inserted).toHaveLength(0);
  });

  it("starts a fresh workspace with no credential", async () => {
    const recorder = storeFor(null);
    const result = await resumeOrCreateGuestHandler(
      { store: recorder.store, now: () => NOW, newToken: () => "minted" },
      { token: null },
    );
    expect(result.resumed).toBe(false);
    expect(result.issuedToken).toBe("minted");
    expect(result.workspace.expiresAt).toBe(guestExpiresAt(NOW));
    // Only the hash is ever written.
    const inserted = recorder.inserted[0] as { token_hash: string };
    expect(inserted.token_hash).toBe(await hashGuestToken("minted"));
    expect(JSON.stringify(recorder.inserted)).not.toContain("minted");
  });

  it("fails closed when an active workspace cannot be read, creating nothing", async () => {
    const corrupt = storeFor(rowFor({ draft_json: { nonsense: true } }));
    await expect(
      resumeOrCreateGuestHandler(
        { store: corrupt.store, now: () => NOW, newToken: () => "must-not-be-issued" },
        { token: "tok" },
      ),
    ).rejects.toThrow(/could not be opened/i);
    expect(corrupt.inserted).toHaveLength(0);

    const unsupported = storeFor(rowFor({ schema_version: "arc.workflow.v999" }));
    await expect(
      resumeOrCreateGuestHandler(
        { store: unsupported.store, now: () => NOW, newToken: () => "must-not-be-issued" },
        { token: "tok" },
      ),
    ).rejects.toThrow(/could not be opened/i);
    expect(unsupported.inserted).toHaveLength(0);
  });

  it("never resumes an expired workspace, even when the row still exists", async () => {
    const expired = rowFor({ expires_at: new Date(NOW.getTime() - 1000).toISOString() });
    const recorder = storeFor(expired);
    const result = await resumeOrCreateGuestHandler(
      { store: recorder.store, now: () => NOW, newToken: () => "fresh" },
      { token: "tok" },
    );
    expect(result.resumed).toBe(false);
    expect(result.issuedToken).toBe("fresh");
  });
});

/* ------------------------------------------------------------------ save -- */

describe("saveGuestDraftHandler", () => {
  it("saves with the expected lock version and advances it", async () => {
    const recorder = storeFor(rowFor());
    const result = await saveGuestDraftHandler(
      { store: recorder.store, now: () => NOW },
      { token: "tok", expectedLockVersion: 3, draft: draftFor("Northwind Systems") },
    );
    expect(result).toEqual({ ok: true, lockVersion: 4, savedAt: NOW.toISOString() });
    // Draft, schema version and lock version always move together.
    expect(recorder.updates[0]).toMatchObject({
      expectedLockVersion: 3,
      schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    });
    const update = recorder.updates[0] as { canonical: { schemaVersion?: string } };
    expect(update.canonical).toBeTruthy();
  });

  it("reports a conflict when the lock version no longer matches", async () => {
    const recorder = storeFor(rowFor());
    recorder.store.updateDraft = async () => null;
    const result = await saveGuestDraftHandler(
      { store: recorder.store, now: () => NOW },
      { token: "tok", expectedLockVersion: 1, draft: draftFor("Northwind Systems") },
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("refuses to save without a credential or after expiry", async () => {
    const active = storeFor(rowFor());
    expect(
      await saveGuestDraftHandler(
        { store: active.store, now: () => NOW },
        { token: null, expectedLockVersion: 3, draft: draftFor("X") },
      ),
    ).toEqual({ ok: false, reason: "expired" });

    const expired = storeFor(rowFor({ expires_at: new Date(NOW.getTime() - 1).toISOString() }));
    expect(
      await saveGuestDraftHandler(
        { store: expired.store, now: () => NOW },
        { token: "tok", expectedLockVersion: 3, draft: draftFor("X") },
      ),
    ).toEqual({ ok: false, reason: "expired" });
    expect(expired.updates).toHaveLength(0);
  });

  it("never persists a malformed draft", async () => {
    const recorder = storeFor(rowFor());
    await expect(
      saveGuestDraftHandler(
        { store: recorder.store, now: () => NOW },
        { token: "tok", expectedLockVersion: 3, draft: { nonsense: true } },
      ),
    ).rejects.toThrow();
    expect(recorder.updates).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- migration -- */

describe("validateMigrationRequest", () => {
  it("blocks a blank customer name with a Step 1 message", () => {
    const check = validateMigrationRequest({ customerName: "  ", contractTitle: "Anything" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("Step 1");
  });

  it("requires a contract title", () => {
    expect(validateMigrationRequest({ customerName: "Acme", contractTitle: " " }).ok).toBe(false);
  });

  it("suggests a starting contract name from Step 1", () => {
    expect(suggestedContractTitle({ customerName: "Acme", contractNumber: "C-9" })).toBe(
      "Acme — C-9",
    );
    expect(suggestedContractTitle({ customerName: "Acme", contractNumber: "" })).toBe("Acme");
  });
});

describe("migrateGuestWorkspaceHandler", () => {
  const migrated = [
    {
      customer_id: "cust-1",
      contract_id: "contract-1",
      analysis_id: "analysis-1",
      revision_id: "rev-1",
      idempotent: false,
    },
  ];

  it("runs one trusted transaction keyed by the credential hash and the expected lock", async () => {
    const recorder = storeFor(rowFor());
    const calls: Record<string, unknown>[] = [];
    const result = await migrateGuestWorkspaceHandler(
      {
        store: recorder.store,
        now: () => NOW,
        userId: "user-7",
        migrateTransaction: async (args) => {
          calls.push(args);
          return { data: migrated, error: null };
        },
      },
      {
        token: "raw-credential-xyz",
        contractTitle: "Northwind — enterprise",
        expectedLockVersion: 3,
      },
    );

    expect(result).toEqual({
      ok: true,
      customerId: "cust-1",
      contractId: "contract-1",
      analysisId: "analysis-1",
      revisionId: "rev-1",
      recovered: false,
    });
    // Customer name and contract number come from the draft the expected lock
    // version protects; the browser never supplies a workspace id, and the raw
    // credential is never passed on.
    expect(calls[0]).toEqual({
      p_token_hash: await hashGuestToken("raw-credential-xyz"),
      p_owner_user_id: "user-7",
      p_expected_lock_version: 3,
      p_customer_name: "Northwind Systems",
      p_contract_title: "Northwind — enterprise",
      p_contract_number: "C-1001",
    });
    expect(JSON.stringify(calls[0])).not.toContain("raw-credential-xyz");
  });

  it("creates nothing when the temporary workspace moved on in another tab", async () => {
    const recorder = storeFor(rowFor({ lock_version: 4 }));
    let called = false;
    const result = await migrateGuestWorkspaceHandler(
      {
        store: recorder.store,
        now: () => NOW,
        userId: "user-7",
        migrateTransaction: async () => {
          called = true;
          return { data: migrated, error: null };
        },
      },
      { token: "tok", contractTitle: "Northwind", expectedLockVersion: 3 },
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
  });

  it("reports a database lock conflict as a conflict, not a failure", async () => {
    const recorder = storeFor(rowFor());
    const result = await migrateGuestWorkspaceHandler(
      {
        store: recorder.store,
        now: () => NOW,
        userId: "user-7",
        migrateTransaction: async () => ({ data: null, error: { message: "x", code: "40001" } }),
      },
      { token: "tok", contractTitle: "Northwind", expectedLockVersion: 3 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
  });

  it("recovers the same saved revision when a committed response was lost", async () => {
    // The credential still exists in the browser and the row is already
    // migrated: the retry must return the original rows, not create more.
    const recorder = storeFor(rowFor({ status: "migrated" }));
    const result = await migrateGuestWorkspaceHandler(
      {
        store: recorder.store,
        now: () => NOW,
        userId: "user-7",
        migrateTransaction: async () => ({
          data: [{ ...migrated[0]!, idempotent: true }],
          error: null,
        }),
      },
      { token: "tok", contractTitle: "Northwind", expectedLockVersion: 3 },
    );
    expect(result).toMatchObject({ ok: true, revisionId: "rev-1", recovered: true });
  });

  it("blocks a blank Step 1 customer name before anything is created", async () => {
    const recorder = storeFor(rowFor({ draft_json: toCanonicalInputs(draftFor("")) as unknown }));
    let called = false;
    const result = await migrateGuestWorkspaceHandler(
      {
        store: recorder.store,
        now: () => NOW,
        userId: "user-7",
        migrateTransaction: async () => {
          called = true;
          return { data: migrated, error: null };
        },
      },
      { token: "tok", contractTitle: "Anything", expectedLockVersion: 3 },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("keeps the guest workspace authoritative when the transaction fails", async () => {
    const recorder = storeFor(rowFor());
    const result = await migrateGuestWorkspaceHandler(
      {
        store: recorder.store,
        now: () => NOW,
        userId: "user-7",
        migrateTransaction: async () => ({ data: null, error: { message: "boom" } }),
      },
      { token: "tok", contractTitle: "Northwind", expectedLockVersion: 3 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("nothing was created");
  });

  it("refuses an expired or credential-less migration", async () => {
    const expired = storeFor(rowFor({ expires_at: new Date(NOW.getTime() - 1).toISOString() }));
    const deps = {
      store: expired.store,
      now: () => NOW,
      userId: "user-7",
      migrateTransaction: async () => ({ data: migrated, error: null }),
    };
    expect(
      (
        await migrateGuestWorkspaceHandler(deps, {
          token: "tok",
          contractTitle: "X",
          expectedLockVersion: 3,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await migrateGuestWorkspaceHandler(deps, {
          token: null,
          contractTitle: "X",
          expectedLockVersion: 3,
        })
      ).ok,
    ).toBe(false);
  });
});

describe("store failures are never mistaken for ordinary outcomes", () => {
  const failing = (message: string): GuestStore => ({
    findByHash: async () => {
      throw new Error(message);
    },
    insert: async () => {
      throw new Error(message);
    },
    updateDraft: async () => {
      throw new Error(message);
    },
  });

  it("does not mint a replacement workspace when the lookup errors", async () => {
    const store = failing("lookup down");
    let inserted = false;
    const guarded: GuestStore = {
      ...store,
      insert: async (row) => {
        inserted = true;
        return rowFor({ ...row });
      },
    };
    await expect(
      resumeOrCreateGuestHandler({ store: guarded, now: () => NOW }, { token: "tok" }),
    ).rejects.toThrow("lookup down");
    expect(inserted).toBe(false);
  });

  it("does not report a save-store error as a lock conflict", async () => {
    const store: GuestStore = { ...failing("save down"), findByHash: async () => rowFor() };
    await expect(
      saveGuestDraftHandler(
        { store, now: () => NOW },
        { token: "tok", expectedLockVersion: 3, draft: createEmptyDraft() },
      ),
    ).rejects.toThrow("save down");
  });
});
