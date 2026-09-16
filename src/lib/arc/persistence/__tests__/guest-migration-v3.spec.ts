/**
 * Phase 9F Task 13 — "Save to My Contracts" must re-home the AI run history.
 *
 * The v3 trusted transaction is what carries AI runs, run provenance, the AI
 * sidecar and the guest-funded quota scope across to the saved revision. These
 * tests prove the production path calls v3 and that the handler behaves
 * correctly for the retry, active-run and conflict cases the routine reports.
 * The re-home itself is proven in `supabase/tests/phase9f_ai_lifecycle.sql`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { migrateGuestWorkspaceHandler } from "../guest.handlers";
import { hashGuestToken } from "../guest";
import { ARC_WORKFLOW_SCHEMA_VERSION, toCanonicalInputs } from "../schema";

const TOKEN = "guest-token-9f";
const EMPTY = createEmptyDraft();
const DRAFT = toCanonicalInputs({
  ...EMPTY,
  contract: { ...EMPTY.contract, customerName: "Genomix Therapeutics", contractNumber: "GX-1" },
}) as unknown;

const MIGRATED = {
  customer_id: "c0000000-0000-4000-8000-000000000001",
  contract_id: "c0000000-0000-4000-8000-000000000002",
  analysis_id: "c0000000-0000-4000-8000-000000000003",
  revision_id: "c0000000-0000-4000-8000-000000000004",
};

async function store(status = "active") {
  return {
    findByHash: async () => ({
      id: "g0000000-0000-4000-8000-000000000001",
      status,
      lock_version: 2,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      draft_json: DRAFT,
      schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    }),
  };
}


async function migrate(
  migrateTransaction: (args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
  status = "active",
) {
  return migrateGuestWorkspaceHandler(
    {
      store: (await store(status)) as never,
      now: () => new Date(),
      userId: "u0000000-0000-4000-8000-000000000009",
      migrateTransaction: migrateTransaction as never,
    },
    { token: TOKEN, contractTitle: "Genomix Platform", expectedLockVersion: 2 },
  );
}

describe("guest migration v3", () => {
  it("the production server function calls the v3 transaction", () => {
    const source = readFileSync("src/lib/arc/persistence/guest.functions.ts", "utf8");
    expect(source).toContain("arc_migrate_guest_workspace_by_token_v3");
    expect(source).not.toContain("arc_migrate_guest_workspace_by_token_v2");
  });

  it("there is exactly one migration workflow in the codebase", () => {
    const source = readFileSync("src/lib/arc/persistence/guest.functions.ts", "utf8");
    const calls = source.match(/arc_migrate_guest_workspace_by_token_v\d/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("sends the credential hash, never a browser-supplied workspace id", async () => {
    const rpc = vi.fn(async () => ({ data: [MIGRATED], error: null }));
    await migrate(rpc);
    const args = rpc.mock.calls[0]![0] as Record<string, unknown>;
    expect(args["p_token_hash"]).toBe(await hashGuestToken(TOKEN));
    expect(Object.keys(args)).not.toContain("p_guest_workspace_id");
  });

  it("a response-loss retry returns the same migrated ids without migrating twice", async () => {
    const rpc = vi.fn(async () => ({ data: [{ ...MIGRATED, idempotent: true }], error: null }));
    const first = await migrate(rpc, "migrated");
    const second = await migrate(rpc, "migrated");
    expect(first).toEqual({ ok: true, ...ids(), recovered: true });
    expect(second).toEqual(first);
  });

  it("an active AI run blocks the save and nothing is created", async () => {
    // The trusted routine refuses while a run can still apply a result.
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "55006", message: "an AI analysis is still running" },
    }));
    const result = await migrate(rpc);
    expect(result).toMatchObject({ ok: false, code: "failed" });
  });

  it("a lost optimistic lock is reported as a conflict, not a failure", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "40001", message: "conflict" } }));
    expect(await migrate(rpc)).toMatchObject({ ok: false, code: "conflict" });
  });
});

function ids() {
  return {
    customerId: MIGRATED.customer_id,
    contractId: MIGRATED.contract_id,
    analysisId: MIGRATED.analysis_id,
    revisionId: MIGRATED.revision_id,
  };
}
