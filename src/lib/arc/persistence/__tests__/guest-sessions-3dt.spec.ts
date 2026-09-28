/**
 * Package 3D-T — browser sessions, derived per-analysis credentials, legacy
 * upgrade, explicit creation, Recent Analyses and the safe Continue path.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { continueWithoutSignInPath } from "../../redirect";
import { deriveAnalysisToken, hashGuestToken, isAnalysisId } from "../guest";
import {
  createAnalysisHandler,
  listRecentAnalysesHandler,
  recentAnalysisStatus,
  resolveAnalysisToken,
  type GuestAnalysisRow,
  type GuestAnalysisSummaryRow,
  type GuestSessionStore,
} from "../guest-session.handlers";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const LATER = new Date(NOW.getTime() + 9 * 3_600_000).toISOString();

interface Memory {
  sessions: Array<{ id: string; token_hash: string; expires_at: string }>;
  rows: Array<GuestAnalysisRow & { origin: string; draft_json: unknown; updated_at: string }>;
  upgrades: number;
  summaries: Map<string, Partial<GuestAnalysisSummaryRow>>;
}

function memoryStore(memory: Memory): GuestSessionStore {
  let seq = 0;
  return {
    resolveSession: async (hash) => {
      let session = memory.sessions.find((s) => s.token_hash === hash);
      if (!session) {
        // Lazy legacy wrap, as arc_resolve_guest_session does.
        const legacy = memory.rows.find(
          (r) => r.token_hash === hash && r.session_id === null && r.status === "active",
        );
        if (legacy) {
          session = { id: `s-${++seq}`, token_hash: hash, expires_at: legacy.expires_at };
          memory.sessions.push(session);
          legacy.session_id = session.id;
        }
      }
      if (!session || Date.parse(session.expires_at) <= NOW.getTime()) return null;
      return { id: session.id, expiresAt: session.expires_at };
    },
    createSession: async (row) => {
      const session = { id: `s-${++seq}`, ...row };
      memory.sessions.push(session);
      return { id: session.id, expiresAt: session.expires_at };
    },
    findAnalysis: async (id) => memory.rows.find((r) => r.id === id) ?? null,
    upgradeLegacy: async ({ sessionHash, workspaceId, newTokenHash }) => {
      const session = memory.sessions.find((s) => s.token_hash === sessionHash);
      const row = memory.rows.find((r) => r.id === workspaceId);
      if (!session || !row || row.session_id !== session.id) return false;
      if (row.credential_kind === "derived") return row.token_hash === newTokenHash;
      if (row.token_hash !== sessionHash) return false;
      memory.upgrades += 1;
      row.token_hash = newTokenHash;
      row.credential_kind = "derived";
      return true;
    },
    insertAnalysis: async (row) => {
      memory.rows.push({
        ...row,
        status: "active",
        updated_at: new Date(NOW.getTime() + memory.rows.length * 1000).toISOString(),
      });
      return {
        id: row.id,
        draft_json: row.draft_json,
        schema_version: row.schema_version,
        lock_version: 1,
        status: "active",
        expires_at: row.expires_at,
      };
    },
    listSummaries: async (sessionId) =>
      memory.rows
        .filter((r) => r.session_id === sessionId && r.status === "active")
        .map((r) => ({
          id: r.id,
          origin: r.origin,
          draft_json: r.draft_json,
          updated_at: r.updated_at,
          expires_at: r.expires_at,
          firstSourceName: null,
          runStages: [],
          reviewItems: null,
          ...memory.summaries.get(r.id),
        })),
  };
}

function setup() {
  const memory: Memory = { sessions: [], rows: [], upgrades: 0, summaries: new Map() };
  let ids = 0;
  let tokens = 0;
  const deps = {
    store: memoryStore(memory),
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    newToken: () => `session-token-${++tokens}-${"x".repeat(40)}`,
  };
  return { memory, deps };
}

describe("derived per-analysis credentials", () => {
  it("is deterministic per (session, analysis) and distinct across both", async () => {
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    expect(await deriveAnalysisToken("s1", a)).toBe(await deriveAnalysisToken("s1", a));
    expect(await deriveAnalysisToken("s1", a)).not.toBe(await deriveAnalysisToken("s1", b));
    expect(await deriveAnalysisToken("s1", a)).not.toBe(await deriveAnalysisToken("s2", a));
    expect(await deriveAnalysisToken("s1", a)).not.toBe("s1");
  });

  it("accepts only UUID analysis ids", () => {
    expect(isAnalysisId("00000000-0000-4000-8000-000000000001")).toBe(true);
    for (const bad of ["", "1", "../x", null, 5, "00000000-0000-4000-8000-00000000000g"]) {
      expect(isAnalysisId(bad)).toBe(false);
    }
  });
});

describe("explicit creation", () => {
  it("starts a session only when there is none and reuses it afterwards", async () => {
    const { memory, deps } = setup();
    const first = await createAnalysisHandler(deps, { sessionToken: null, origin: "blank", draft: null });
    expect(first.issuedToken).not.toBeNull();
    const second = await createAnalysisHandler(deps, {
      sessionToken: first.issuedToken,
      origin: "upload",
      draft: null,
    });
    expect(second.issuedToken).toBeNull();
    expect(second.analysisId).not.toBe(first.analysisId);
    expect(memory.sessions).toHaveLength(1);
    expect(memory.rows).toHaveLength(2);
    // Each analysis dies with its session, never later.
    expect(memory.rows.every((r) => r.expires_at === memory.sessions[0]!.expires_at)).toBe(true);
    expect(memory.rows.every((r) => r.credential_kind === "derived")).toBe(true);
    // No row stores the session credential or its hash.
    const sessionHash = await hashGuestToken(first.issuedToken!);
    expect(memory.rows.some((r) => r.token_hash === sessionHash)).toBe(false);
  });

  it("each call creates exactly one analysis", async () => {
    const { memory, deps } = setup();
    const { issuedToken } = await createAnalysisHandler(deps, {
      sessionToken: null,
      origin: "blank",
      draft: null,
    });
    for (let i = 0; i < 4; i += 1) {
      await createAnalysisHandler(deps, { sessionToken: issuedToken, origin: "blank", draft: null });
    }
    expect(memory.rows).toHaveLength(5);
  });

  it("replaces an expired session instead of extending it", async () => {
    const { memory, deps } = setup();
    memory.sessions.push({
      id: "old",
      token_hash: await hashGuestToken("expired-token"),
      expires_at: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const result = await createAnalysisHandler(deps, {
      sessionToken: "expired-token",
      origin: "blank",
      draft: null,
    });
    expect(result.issuedToken).not.toBeNull();
    expect(memory.rows[0]!.session_id).not.toBe("old");
  });

  it("seeds a sample analysis with the supplied draft", async () => {
    const { memory, deps } = setup();
    const draft = createEmptyDraft();
    draft.contract.customerName = "Horizon Logistics";
    await createAnalysisHandler(deps, { sessionToken: null, origin: "sample:horizon", draft });
    expect(memory.rows[0]!.origin).toBe("sample:horizon");
    expect((memory.rows[0]!.draft_json as { contract: { customerName: string } }).contract.customerName).toBe(
      "Horizon Logistics",
    );
  });
});

describe("resolving an analysis credential", () => {
  it("returns the derived credential only for the owning session", async () => {
    const { deps } = setup();
    const mine = await createAnalysisHandler(deps, { sessionToken: null, origin: "blank", draft: null });
    const theirs = await createAnalysisHandler(deps, { sessionToken: null, origin: "blank", draft: null });

    const token = await resolveAnalysisToken(deps, {
      sessionToken: mine.issuedToken,
      analysisId: mine.analysisId,
    });
    expect(token).toBe(await deriveAnalysisToken(mine.issuedToken!, mine.analysisId));

    // Cross-session access is refused.
    expect(
      await resolveAnalysisToken(deps, { sessionToken: mine.issuedToken, analysisId: theirs.analysisId }),
    ).toBeNull();
    // Unknown, malformed and missing inputs fail closed.
    expect(
      await resolveAnalysisToken(deps, {
        sessionToken: mine.issuedToken,
        analysisId: "00000000-0000-4000-8000-00000000ffff",
      }),
    ).toBeNull();
    expect(await resolveAnalysisToken(deps, { sessionToken: mine.issuedToken, analysisId: "x" })).toBeNull();
    expect(await resolveAnalysisToken(deps, { sessionToken: null, analysisId: mine.analysisId })).toBeNull();
    expect(
      await resolveAnalysisToken(deps, { sessionToken: "forged", analysisId: mine.analysisId }),
    ).toBeNull();
  });

  it("refuses a derived row whose stored hash does not match", async () => {
    const { memory, deps } = setup();
    const mine = await createAnalysisHandler(deps, { sessionToken: null, origin: "blank", draft: null });
    memory.rows[0]!.token_hash = "tampered";
    expect(
      await resolveAnalysisToken(deps, { sessionToken: mine.issuedToken, analysisId: mine.analysisId }),
    ).toBeNull();
  });

  it("upgrades a legacy workspace once, atomically and idempotently", async () => {
    const { memory, deps } = setup();
    const cookie = "legacy-cookie-credential";
    const id = "00000000-0000-4000-8000-0000000000aa";
    memory.rows.push({
      id,
      session_id: null,
      credential_kind: "legacy",
      token_hash: await hashGuestToken(cookie),
      status: "active",
      expires_at: LATER,
      origin: "blank",
      draft_json: {},
      updated_at: NOW.toISOString(),
    });
    const expected = await deriveAnalysisToken(cookie, id);
    expect(await resolveAnalysisToken(deps, { sessionToken: cookie, analysisId: id })).toBe(expected);
    expect(await resolveAnalysisToken(deps, { sessionToken: cookie, analysisId: id })).toBe(expected);
    expect(memory.upgrades).toBe(1);
    expect(memory.sessions).toHaveLength(1);
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0]!.credential_kind).toBe("derived");
    // The session keeps the legacy workspace's original expiry.
    expect(memory.sessions[0]!.expires_at).toBe(LATER);
  });

  it("keeps a saved legacy row reachable for the idempotent save retry", async () => {
    const { memory, deps } = setup();
    const cookie = "legacy-cookie-credential";
    const id = "00000000-0000-4000-8000-0000000000bb";
    const hash = await hashGuestToken(cookie);
    memory.sessions.push({ id: "s-legacy", token_hash: hash, expires_at: LATER });
    memory.rows.push({
      id,
      session_id: "s-legacy",
      credential_kind: "legacy",
      token_hash: hash,
      status: "migrated",
      expires_at: LATER,
      origin: "blank",
      draft_json: {},
      updated_at: NOW.toISOString(),
    });
    expect(await resolveAnalysisToken(deps, { sessionToken: cookie, analysisId: id })).toBe(cookie);
    expect(memory.upgrades).toBe(0);
  });
});

describe("Recent Analyses", () => {
  const listDeps = (deps: ReturnType<typeof setup>["deps"]) => ({
    ...deps,
    reviewNeeded: (raw: unknown) => raw === "needs-review",
    sampleLabel: (origin: string) => (origin === "sample:horizon" ? "Horizon Logistics" : null),
  });

  it("lists only this session's live analyses, newest first, without a cap", async () => {
    const { memory, deps } = setup();
    const { issuedToken } = await createAnalysisHandler(deps, {
      sessionToken: null,
      origin: "blank",
      draft: null,
    });
    for (let i = 0; i < 24; i += 1) {
      await createAnalysisHandler(deps, { sessionToken: issuedToken, origin: "blank", draft: null });
    }
    await createAnalysisHandler(deps, { sessionToken: null, origin: "blank", draft: null });
    memory.rows[3]!.status = "migrated";

    const list = await listRecentAnalysesHandler(listDeps(deps), { sessionToken: issuedToken });
    expect(list).toHaveLength(24);
    const stamps = list.map((item) => Date.parse(item.updatedAt));
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    expect(await listRecentAnalysesHandler(listDeps(deps), { sessionToken: null })).toEqual([]);
    expect(await listRecentAnalysesHandler(listDeps(deps), { sessionToken: "forged" })).toEqual([]);
  });

  it("labels, sources and statuses each analysis", async () => {
    const { memory, deps } = setup();
    const draft = createEmptyDraft();
    draft.contract.customerName = "Horizon Logistics";
    const sample = await createAnalysisHandler(deps, {
      sessionToken: null,
      origin: "sample:horizon",
      draft,
    });
    const token = sample.issuedToken;
    const blank = await createAnalysisHandler(deps, { sessionToken: token, origin: "blank", draft: null });
    const running = await createAnalysisHandler(deps, { sessionToken: token, origin: "upload", draft: null });
    const review = await createAnalysisHandler(deps, { sessionToken: token, origin: "upload", draft: null });
    memory.summaries.set(running.analysisId, { firstSourceName: "MSA.pdf", runStages: ["analyzing"] });
    memory.summaries.set(review.analysisId, {
      firstSourceName: "MSA.pdf",
      runStages: ["succeeded"],
      reviewItems: "needs-review",
    });

    const byId = new Map(
      (await listRecentAnalysesHandler(listDeps(deps), { sessionToken: token })).map((i) => [
        i.analysisId,
        i,
      ]),
    );
    expect(byId.get(sample.analysisId)).toMatchObject({
      label: "Horizon Logistics",
      source: "Sample — Horizon Logistics",
      status: "Draft",
    });
    expect(byId.get(blank.analysisId)).toMatchObject({ label: "Untitled analysis", status: "Not analyzed" });
    expect(byId.get(running.analysisId)).toMatchObject({
      source: "MSA.pdf",
      status: "Analysis in progress",
    });
    expect(byId.get(review.analysisId)).toMatchObject({ status: "Review needed" });
  });

  it("derives status with in-progress taking precedence", () => {
    expect(
      recentAnalysisStatus({ origin: "blank", hasSource: true, runStages: ["created"], reviewNeeded: true }),
    ).toBe("Analysis in progress");
    expect(
      recentAnalysisStatus({ origin: "blank", hasSource: false, runStages: ["succeeded"], reviewNeeded: false }),
    ).toBe("Draft");
    expect(
      recentAnalysisStatus({ origin: "blank", hasSource: false, runStages: ["api_failed"], reviewNeeded: false }),
    ).toBe("Not analyzed");
    expect(
      recentAnalysisStatus({ origin: "sample:apex", hasSource: false, runStages: [], reviewNeeded: false }),
    ).toBe("Draft");
  });
});

describe("Continue without signing in", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("returns to a safe internal analysis path with an analysis id", () => {
    expect(continueWithoutSignInPath(`/analysis?a=${id}&save=1`)).toBe(`/analysis?a=${id}&save=1`);
    expect(continueWithoutSignInPath(`/analysis/documents?a=${id}`)).toBe(`/analysis/documents?a=${id}`);
  });
  it("falls back to Recent Analyses for anything else", () => {
    for (const next of [
      undefined,
      "",
      "/analysis",
      "/analysis?a=nope",
      "/analysis/new",
      "/workspace",
      "https://evil.example/analysis?a=" + id,
      "//evil.example/analysis?a=" + id,
      "/javascript:alert(1)",
      "/analysis\\evil",
    ]) {
      expect(continueWithoutSignInPath(next)).toBe("/recent");
    }
  });
});
