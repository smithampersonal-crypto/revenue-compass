/**
 * Amendment-draft reset and discard — handler-level coverage.
 *
 * These prove the trusted boundary: the browser sends only a revision id and
 * the lock version it believes is current; everything else is read back from
 * the database and every destructive path is refused unless the revision is
 * still the active amendment draft.
 */
import { describe, expect, it, vi } from "vitest";

import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import { toCanonicalInputs, ARC_WORKFLOW_SCHEMA_VERSION } from "../schema";
import {
  discardAmendmentDraftHandler,
  resetAmendmentDraftHandler,
  type AmendmentLifecycleDeps,
} from "../revisions.handlers";

const DRAFT = createDemoDraftIfKnown("horizon")!;
const CANONICAL = toCanonicalInputs(DRAFT);
const REVISION = "22222222-2222-4222-8222-222222222222";
const SOURCE = "11111111-1111-4111-8111-111111111111";

function deps(
  overrides: {
    lifecycle?: { status: string; lock_version: number; supersedes_revision_id: string | null };
    resetTransaction?: AmendmentLifecycleDeps["resetTransaction"];
    discardTransaction?: AmendmentLifecycleDeps["discardTransaction"];
  } = {},
): AmendmentLifecycleDeps {
  const lifecycle = overrides.lifecycle ?? {
    status: "draft",
    lock_version: 4,
    supersedes_revision_id: SOURCE,
  };
  return {
    userId: "user-1",
    reader: {
      readRevisionForFinalization: vi.fn(),
      readSourceRevision: vi.fn().mockResolvedValue({
        data: {
          canonical_inputs: CANONICAL,
          schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
          status: "finalized",
        },
        error: null,
      }),
      readLifecycleRevision: vi
        .fn()
        .mockResolvedValue({ data: { id: REVISION, ...lifecycle }, error: null }),
    },
    resetTransaction:
      overrides.resetTransaction ??
      vi.fn().mockResolvedValue({
        data: [
          {
            lock_version: 5,
            schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
            source_revision_id: SOURCE,
          },
        ],
        error: null,
      }),
    discardTransaction:
      overrides.discardTransaction ?? vi.fn().mockResolvedValue({ data: SOURCE, error: null }),
  };
}

describe("resetAmendmentDraftHandler", () => {
  it("restores the source finalized inputs through the trusted transaction", async () => {
    const d = deps();
    const outcome = await resetAmendmentDraftHandler(d, {
      revisionId: REVISION,
      expectedLockVersion: 4,
    });

    expect(d.resetTransaction).toHaveBeenCalledWith({
      p_owner_user_id: "user-1",
      p_revision_id: REVISION,
      p_expected_lock_version: 4,
    });
    expect(outcome).toMatchObject({ ok: true, lockVersion: 5 });
    // Server-authoritative: the draft comes back from the database, not the browser.
    if (outcome.ok) expect(outcome.draft.contract.contractId).toBe(DRAFT.contract.contractId);
  });

  it("reports a conflict for a stale lock version and writes nothing", async () => {
    const d = deps();
    const outcome = await resetAmendmentDraftHandler(d, {
      revisionId: REVISION,
      expectedLockVersion: 3,
    });
    expect(outcome).toEqual({ ok: false, reason: "conflict" });
    expect(d.resetTransaction).not.toHaveBeenCalled();
  });

  it("reports a conflict when the transaction itself detects newer work", async () => {
    const d = deps({
      resetTransaction: vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } }),
    });
    await expect(
      resetAmendmentDraftHandler(d, { revisionId: REVISION, expectedLockVersion: 4 }),
    ).resolves.toEqual({ ok: false, reason: "conflict" });
  });

  it("refuses a finalized or superseded revision", async () => {
    for (const status of ["finalized", "superseded"]) {
      const d = deps({ lifecycle: { status, lock_version: 4, supersedes_revision_id: SOURCE } });
      await expect(
        resetAmendmentDraftHandler(d, { revisionId: REVISION, expectedLockVersion: 4 }),
      ).rejects.toThrow(/unfinished draft/i);
      expect(d.resetTransaction).not.toHaveBeenCalled();
    }
  });

  it("refuses a draft that does not continue a finalized revision", async () => {
    const d = deps({
      lifecycle: { status: "draft", lock_version: 4, supersedes_revision_id: null },
    });
    await expect(
      resetAmendmentDraftHandler(d, { revisionId: REVISION, expectedLockVersion: 4 }),
    ).rejects.toThrow(/finalized revision/i);
    expect(d.resetTransaction).not.toHaveBeenCalled();
  });
});

describe("discardAmendmentDraftHandler", () => {
  it("discards the active amendment draft and returns the finalized revision", async () => {
    const d = deps();
    const outcome = await discardAmendmentDraftHandler(d, {
      revisionId: REVISION,
      expectedLockVersion: 4,
    });
    expect(d.discardTransaction).toHaveBeenCalledWith({
      p_owner_user_id: "user-1",
      p_revision_id: REVISION,
      p_expected_lock_version: 4,
    });
    expect(outcome).toEqual({ ok: true, finalizedRevisionId: SOURCE });
  });

  it("reports a conflict for a stale lock version and deletes nothing", async () => {
    const d = deps();
    await expect(
      discardAmendmentDraftHandler(d, { revisionId: REVISION, expectedLockVersion: 2 }),
    ).resolves.toEqual({ ok: false, reason: "conflict" });
    expect(d.discardTransaction).not.toHaveBeenCalled();
  });

  it("can never delete a finalized or superseded revision", async () => {
    for (const status of ["finalized", "superseded"]) {
      const d = deps({ lifecycle: { status, lock_version: 4, supersedes_revision_id: SOURCE } });
      await expect(
        discardAmendmentDraftHandler(d, { revisionId: REVISION, expectedLockVersion: 4 }),
      ).rejects.toThrow(/unfinished draft/i);
      expect(d.discardTransaction).not.toHaveBeenCalled();
    }
  });

  it("surfaces another owner's revision as not found", async () => {
    const d = deps();
    d.reader.readLifecycleRevision = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(
      discardAmendmentDraftHandler(d, { revisionId: REVISION, expectedLockVersion: 4 }),
    ).rejects.toThrow(/not found/i);
    expect(d.discardTransaction).not.toHaveBeenCalled();
  });
});
