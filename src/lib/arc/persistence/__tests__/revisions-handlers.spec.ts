/**
 * Phase 7D — direct coverage of the real production lifecycle logic.
 *
 * These are the exact handlers the `createServerFn` wrappers call, exercised
 * with deterministic doubles for the caller-scoped reader and the trusted
 * service-role transactions. No implementation is duplicated for tests, and no
 * accounting engine behaviour is asserted or changed here.
 */
import { describe, expect, it, vi } from "vitest";

import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import { createEmptyDraft } from "@/lib/asc606-workflow";

import {
  finalizeRevisionHandler,
  startNewRevisionHandler,
  type RevisionReader,
} from "../revisions.handlers";
import { toCanonicalInputs, ARC_WORKFLOW_SCHEMA_VERSION } from "../schema";
import { ARC_ENGINE_VERSION, buildFinalizationSnapshot } from "../snapshot";

const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

const COMPLETE = createDemoDraftIfKnown("horizon")!;
const CANONICAL = toCanonicalInputs(COMPLETE);

function reader(overrides: Partial<RevisionReader> = {}): RevisionReader {
  return {
    readLifecycleRevision: async () => ({
      data: {
        id: REVISION_ID,
        status: "draft",
        lock_version: 3,
        supersedes_revision_id: null,
      },
      error: null,
    }),
    readRevisionForFinalization: async () => ({
      data: {
        id: REVISION_ID,
        status: "draft",
        lock_version: 3,
        canonical_inputs: CANONICAL,
        schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
      },
      error: null,
    }),
    readSourceRevision: async () => ({
      data: {
        canonical_inputs: CANONICAL,
        schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
        status: "finalized",
      },
      error: null,
    }),
    ...overrides,
  };
}

describe("finalizeRevisionHandler", () => {
  it("accepts only a revision id and the expected lock version from the browser", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const outcome = await finalizeRevisionHandler(
      { reader: reader(), userId: USER_ID, finalizeTransaction: rpc },
      // The input type admits nothing else: engine outputs cannot be supplied.
      { revisionId: REVISION_ID, expectedLockVersion: 3 },
    );
    expect(outcome).toEqual({ ok: true, revisionId: REVISION_ID });
  });

  it("rereads the saved canonical inputs and builds the snapshot itself", async () => {
    const read = vi.fn(reader().readRevisionForFinalization);
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await finalizeRevisionHandler(
      {
        reader: reader({ readRevisionForFinalization: read }),
        userId: USER_ID,
        finalizeTransaction: rpc,
      },
      { revisionId: REVISION_ID, expectedLockVersion: 3 },
    );
    expect(read).toHaveBeenCalledWith(REVISION_ID);

    const server = buildFinalizationSnapshot(COMPLETE);
    expect(server.ok).toBe(true);
    if (!server.ok) return;
    const args = (rpc.mock.calls as unknown as Record<string, unknown>[][])[0]![0] as Record<
      string,
      unknown
    >;
    expect(args["p_engine_outputs"]).toEqual(server.engineOutputs);
    expect(args["p_reconciliation_snapshot"]).toEqual(server.reconciliation);
    expect(args["p_schema_version"]).toBe(ARC_WORKFLOW_SCHEMA_VERSION);
    expect(args["p_engine_version"]).toBe(ARC_ENGINE_VERSION);
    expect(args["p_owner_user_id"]).toBe(USER_ID);
  });

  it("returns conflict for a stale browser lock before any trusted write", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const outcome = await finalizeRevisionHandler(
      { reader: reader(), userId: USER_ID, finalizeTransaction: rpc },
      { revisionId: REVISION_ID, expectedLockVersion: 2 },
    );
    expect(outcome).toEqual({ ok: false, reason: "conflict" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks an incomplete saved workpaper without writing", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const outcome = await finalizeRevisionHandler(
      {
        reader: reader({
          readRevisionForFinalization: async () => ({
            data: {
              id: REVISION_ID,
              status: "draft",
              lock_version: 3,
              canonical_inputs: toCanonicalInputs(createEmptyDraft()),
              schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
            },
            error: null,
          }),
        }),
        userId: USER_ID,
        finalizeTransaction: rpc,
      },
      { revisionId: REVISION_ID, expectedLockVersion: 3 },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("blocked");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a revision the caller cannot read", async () => {
    await expect(
      finalizeRevisionHandler(
        {
          reader: reader({
            readRevisionForFinalization: async () => ({ data: null, error: null }),
          }),
          userId: USER_ID,
          finalizeTransaction: vi.fn(async () => ({ data: null, error: null })),
        },
        { revisionId: REVISION_ID, expectedLockVersion: 3 },
      ),
    ).rejects.toThrow(/not found in your workspace/i);
  });

  it("maps the transaction's 40001 optimistic-lock failure to a conflict", async () => {
    const outcome = await finalizeRevisionHandler(
      {
        reader: reader(),
        userId: USER_ID,
        finalizeTransaction: async () => ({ data: null, error: { code: "40001" } }),
      },
      { revisionId: REVISION_ID, expectedLockVersion: 3 },
    );
    expect(outcome).toEqual({ ok: false, reason: "conflict" });
  });

  it("fails safely on any other transaction failure", async () => {
    await expect(
      finalizeRevisionHandler(
        {
          reader: reader(),
          userId: USER_ID,
          finalizeTransaction: async () => ({ data: null, error: { code: "42501" } }),
        },
        { revisionId: REVISION_ID, expectedLockVersion: 3 },
      ),
    ).rejects.toThrow(/could not be finalized/i);
  });
});

describe("startNewRevisionHandler", () => {
  const ok = async () => ({ data: [{ revision_id: "new-id", created: true }], error: null });

  it("passes the exact expected source revision to the trusted transaction", async () => {
    const rpc = vi.fn(ok);
    const outcome = await startNewRevisionHandler(
      { reader: reader(), userId: USER_ID, amendmentTransaction: rpc },
      { contractId: CONTRACT_ID, sourceRevisionId: SOURCE_ID },
    );
    expect((rpc.mock.calls as unknown as Record<string, unknown>[][])[0]![0]).toEqual({
      p_owner_user_id: USER_ID,
      p_contract_id: CONTRACT_ID,
      p_expected_source_revision_id: SOURCE_ID,
    });
    expect(outcome).toEqual({ revisionId: "new-id", created: true });
  });

  it("returns the existing active draft without claiming it was created", async () => {
    const outcome = await startNewRevisionHandler(
      {
        reader: reader(),
        userId: USER_ID,
        amendmentTransaction: async () => ({
          data: [{ revision_id: "existing", created: false }],
          error: null,
        }),
      },
      { contractId: CONTRACT_ID, sourceRevisionId: SOURCE_ID },
    );
    expect(outcome).toEqual({ revisionId: "existing", created: false });
  });

  it("requires a source revision the caller can read", async () => {
    await expect(
      startNewRevisionHandler(
        {
          reader: reader({ readSourceRevision: async () => ({ data: null, error: null }) }),
          userId: USER_ID,
          amendmentTransaction: vi.fn(ok),
        },
        { contractId: CONTRACT_ID, sourceRevisionId: SOURCE_ID },
      ),
    ).rejects.toThrow(/could not be read/i);
  });

  it("rejects a superseded source at the application boundary", async () => {
    const rpc = vi.fn(ok);
    await expect(
      startNewRevisionHandler(
        {
          reader: reader({
            readSourceRevision: async () => ({
              data: {
                canonical_inputs: CANONICAL,
                schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
                status: "superseded",
              },
              error: null,
            }),
          }),
          userId: USER_ID,
          amendmentTransaction: rpc,
        },
        { contractId: CONTRACT_ID, sourceRevisionId: SOURCE_ID },
      ),
    ).rejects.toThrow(/current finalized revision/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns the transaction's 40001 into the stale-analysis error", async () => {
    await expect(
      startNewRevisionHandler(
        {
          reader: reader(),
          userId: USER_ID,
          amendmentTransaction: async () => ({ data: null, error: { code: "40001" } }),
        },
        { contractId: CONTRACT_ID, sourceRevisionId: SOURCE_ID },
      ),
    ).rejects.toThrow(/changed since this page loaded/i);
  });
});
