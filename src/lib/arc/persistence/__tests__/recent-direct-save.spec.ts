/**
 * Package 3D-T — one-click "Save to My Contracts" from Recent Analyses.
 * It is only another entry point into the authoritative migration.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { saveRecentAnalysisHandler } from "../guest.handlers";
import { hashGuestToken } from "../guest";
import { ARC_WORKFLOW_SCHEMA_VERSION, toCanonicalInputs } from "../schema";

const EMPTY = createEmptyDraft();
const draftFor = (customerName: string, contractNumber = "") =>
  toCanonicalInputs({
    ...EMPTY,
    contract: { ...EMPTY.contract, customerName, contractNumber },
  }) as unknown;

const MIGRATED = {
  customer_id: "c0000000-0000-4000-8000-000000000001",
  contract_id: "c0000000-0000-4000-8000-000000000002",
  analysis_id: "c0000000-0000-4000-8000-000000000003",
  revision_id: "c0000000-0000-4000-8000-000000000004",
};

type Row = {
  id: string;
  token_hash: string;
  status: string;
  lock_version: number;
  expires_at: string;
  draft_json: unknown;
  schema_version: string;
};

/** In-memory session with several temporary analyses and one durable save. */
async function world() {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const rows: Row[] = [];
  for (const [token, name] of [
    ["tok-06", "Test 06 Customer"],
    ["tok-03", "Test 03 Customer"],
    ["tok-hz", "Horizon Logistics"],
    ["tok-empty", ""],
  ] as const) {
    rows.push({
      id: token,
      token_hash: await hashGuestToken(token),
      status: "active",
      lock_version: 3,
      expires_at: future,
      draft_json: draftFor(name, name ? "N-1" : ""),
      schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    });
  }
  const contracts: string[] = [];
  const calls: Record<string, unknown>[] = [];
  const aiRuns: unknown[] = [];
  const deps = {
    store: { findByHash: async (h: string) => rows.find((r) => r.token_hash === h) ?? null },
    now: () => new Date(),
    userId: "u0000000-0000-4000-8000-000000000009",
    migrateTransaction: async (args: Record<string, unknown>) => {
      calls.push(args);
      const row = rows.find((r) => r.token_hash === args["p_token_hash"])!;
      // The real transaction is idempotent for an already-migrated row.
      if (row.status !== "migrated") {
        if (row.lock_version !== args["p_expected_lock_version"]) {
          return { data: null, error: { code: "PT409", message: "conflict" } };
        }
        row.status = "migrated";
        contracts.push(row.id);
      }
      return { data: [MIGRATED], error: null };
    },
  };
  const recent = () => rows.filter((r) => r.status === "active").map((r) => r.id);
  return { rows, deps: deps as never, contracts, calls, aiRuns, recent };
}

describe("direct save from Recent Analyses", () => {
  it("a complete analysis saves at once and leaves Recent; siblings stay", async () => {
    const w = await world();
    const result = await saveRecentAnalysisHandler(w.deps, { token: "tok-06" });
    expect(result.ok).toBe(true);
    expect(w.contracts).toEqual(["tok-06"]);
    expect(w.recent()).toEqual(["tok-03", "tok-hz", "tok-empty"]);
    // Same suggestion as the in-workspace dialog, new customer by Step 1 name.
    expect(w.calls[0]).toMatchObject({
      p_contract_title: "Test 06 Customer — N-1",
      p_new_customer_name: "Test 06 Customer",
      p_existing_customer_id: null,
      p_expected_lock_version: 3,
    });
    expect(w.aiRuns).toHaveLength(0);
  });

  it("a repeat or double click never files a second contract", async () => {
    const w = await world();
    const [a, b] = await Promise.all([
      saveRecentAnalysisHandler(w.deps, { token: "tok-06" }),
      saveRecentAnalysisHandler(w.deps, { token: "tok-06" }),
    ]);
    const c = await saveRecentAnalysisHandler(w.deps, { token: "tok-06" });
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(w.contracts).toEqual(["tok-06"]);
  });

  it("missing customer name: nothing is created and Step 1 is named", async () => {
    const w = await world();
    const result = await saveRecentAnalysisHandler(w.deps, { token: "tok-empty" });
    expect(result).toMatchObject({ ok: false, code: "incomplete", destination: "step1" });
    if (!result.ok) expect(result.reason).toMatch(/customer name in Step 1/);
    expect(w.calls).toHaveLength(0);
    expect(w.rows.find((r) => r.id === "tok-empty")!.status).toBe("active");
  });

  it("a foreign or unknown analysis cannot be saved", async () => {
    const w = await world();
    expect((await saveRecentAnalysisHandler(w.deps, { token: null })).ok).toBe(false);
    expect((await saveRecentAnalysisHandler(w.deps, { token: "someone-else" })).ok).toBe(false);
    expect(w.calls).toHaveLength(0);
  });

  it("an expired analysis cannot be saved", async () => {
    const w = await world();
    w.rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    const result = await saveRecentAnalysisHandler(w.deps, { token: "tok-06" });
    expect(result).toMatchObject({ ok: false, code: "expired" });
    expect(w.calls).toHaveLength(0);
  });

  it("uses the one authoritative transaction, requires sign-in, never clears the cookie", () => {
    const source = readFileSync("src/lib/arc/persistence/guest.functions.ts", "utf8");
    expect(source.match(/arc_migrate_guest_workspace_by_token_v\d/g)).toHaveLength(1);
    const fn = source.slice(source.indexOf("export const saveRecentAnalysis"));
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain("migrationDeps(context.userId)");
    expect(fn).not.toMatch(/clearGuestCookie|Set-Cookie|ai_runs|reserve/);
  });
});
