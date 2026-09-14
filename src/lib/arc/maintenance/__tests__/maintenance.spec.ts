import { describe, expect, it } from "vitest";

import {
  categorizeStorageFailure,
  drainStorageDeletionQueue,
  runMaintenance,
  type MaintenanceDeps,
  type StorageDeletionJob,
} from "../maintenance.handlers";

interface FakeOptions {
  jobs?: StorageDeletionJob[];
  removeFails?: (path: string) => Error | null;
  exists?: (path: string) => boolean;
  staleFails?: boolean;
  guestFails?: boolean;
}

function fakeDeps(options: FakeOptions = {}) {
  const queue = [...(options.jobs ?? [])];
  const calls = {
    claimed: [] as string[],
    removed: [] as string[],
    completed: [] as string[],
    released: [] as Array<{ id: string; category: string }>,
    staleRuns: 0,
    guestRuns: 0,
  };

  const deps: MaintenanceDeps = {
    claimDeletionJobs: async (limit) => {
      // Deterministic claiming: ordered batch, each job handed out once.
      const batch = queue.splice(0, limit);
      calls.claimed.push(...batch.map((job) => job.id));
      return batch;
    },
    removeObject: async (_bucket, path) => {
      const failure = options.removeFails?.(path) ?? null;
      if (failure) throw failure;
      calls.removed.push(path);
    },
    objectExists: async (_bucket, path) => options.exists?.(path) ?? true,
    completeDeletionJob: async (jobId) => {
      calls.completed.push(jobId);
      return true;
    },
    releaseDeletionJob: async (jobId, category) => {
      calls.released.push({ id: jobId, category });
      // A released job stays durable: it returns to the queue for retry.
      const original = (options.jobs ?? []).find((job) => job.id === jobId);
      if (original) queue.push({ ...original, attemptCount: original.attemptCount + 1 });
      return true;
    },
    cleanupStaleUploadIntents: async () => {
      calls.staleRuns += 1;
      if (options.staleFails) throw new Error("timeout contacting database");
      return { processed: 3, queued: 4 };
    },
    expireGuestWorkspaces: async () => {
      calls.guestRuns += 1;
      if (options.guestFails) throw new Error("timeout contacting database");
      return { marked: 2, deleted: 1 };
    },
  };

  return { deps, calls, queue };
}

const job = (id: string, path: string): StorageDeletionJob => ({
  id,
  bucket: "arc-source-documents",
  path,
  attemptCount: 0,
});

describe("Phase 8F — durable storage deletion worker", () => {
  it("deletes each claimed object and completes its job", async () => {
    const { deps, calls } = fakeDeps({
      jobs: [job("a", "documents/a.pdf"), job("b", "pending/b.pdf")],
    });

    const report = await drainStorageDeletionQueue(deps);

    expect(report).toMatchObject({ claimed: 2, completed: 2, released: 0, alreadyAbsent: 0 });
    expect(calls.removed).toEqual(["documents/a.pdf", "pending/b.pdf"]);
    expect(calls.completed).toEqual(["a", "b"]);
  });

  it("keeps durable work for retry when storage fails temporarily", async () => {
    const { deps, calls, queue } = fakeDeps({
      jobs: [job("a", "documents/a.pdf")],
      removeFails: () => new Error("network unreachable"),
      exists: () => true,
    });

    const report = await drainStorageDeletionQueue(deps);

    expect(report).toMatchObject({ claimed: 1, completed: 0, released: 1 });
    expect(report.failures).toEqual({ network: 1 });
    expect(calls.completed).toEqual([]);
    // The job did not disappear merely because deletion failed.
    expect(queue).toHaveLength(1);
    expect(queue[0]!.attemptCount).toBe(1);
  });

  it("resolves idempotently when the object is already missing", async () => {
    const { deps, calls } = fakeDeps({
      jobs: [job("a", "documents/gone.pdf")],
      removeFails: () => new Error("Object not found"),
      exists: () => false,
    });

    const report = await drainStorageDeletionQueue(deps);

    expect(report).toMatchObject({ claimed: 1, completed: 1, alreadyAbsent: 1, released: 0 });
    expect(calls.completed).toEqual(["a"]);
  });

  it("never hands the same job to two overlapping drains", async () => {
    const { deps, calls } = fakeDeps({
      jobs: [job("a", "documents/a.pdf"), job("b", "documents/b.pdf")],
    });

    const [first, second] = await Promise.all([
      drainStorageDeletionQueue(deps, 1),
      drainStorageDeletionQueue(deps, 1),
    ]);

    expect(first.claimed + second.claimed).toBe(2);
    expect(new Set(calls.claimed).size).toBe(calls.claimed.length);
    expect(calls.completed.sort()).toEqual(["a", "b"]);
  });

  it("respects the bounded batch limit", async () => {
    const { deps } = fakeDeps({
      jobs: Array.from({ length: 10 }, (_, index) => job(`j${index}`, `documents/${index}.pdf`)),
    });

    const report = await drainStorageDeletionQueue(deps, 4);

    expect(report.claimed).toBe(4);
  });

  it("reduces provider failures to safe categories only", () => {
    expect(categorizeStorageFailure(new Error("Object not found"))).toBe("not_found");
    expect(categorizeStorageFailure(new Error("403 Forbidden"))).toBe("permission");
    expect(categorizeStorageFailure(new Error("fetch failed"))).toBe("network");
    expect(categorizeStorageFailure(new Error("https://signed.example/x?token=abc"))).toBe(
      "unknown",
    );
  });
});

describe("Phase 8F — hourly maintenance invocation", () => {
  it("runs every category and reports privacy-safe counts", async () => {
    const { deps, calls } = fakeDeps({ jobs: [job("a", "documents/a.pdf")] });

    const report = await runMaintenance(deps);

    expect(calls.staleRuns).toBe(1);
    expect(calls.guestRuns).toBe(1);
    expect(report).toMatchObject({
      staleIntentsProcessed: 3,
      staleIntentObjectsQueued: 4,
      guestWorkspacesMarkedExpired: 2,
      guestWorkspacesDeleted: 1,
      errors: {},
    });
    expect(report.storage).toMatchObject({ claimed: 1, completed: 1 });
    expect(JSON.stringify(report)).not.toMatch(/documents\/|pending\/|token/i);
  });

  it("does not discard one category's work when another fails", async () => {
    const { deps, calls } = fakeDeps({ staleFails: true, jobs: [job("a", "documents/a.pdf")] });

    const report = await runMaintenance(deps);

    expect(report.errors).toEqual({ staleUploads: "network" });
    expect(calls.guestRuns).toBe(1);
    expect(report.guestWorkspacesDeleted).toBe(1);
    expect(report.storage.completed).toBe(1);
  });

  it("is safe to repeat: a second invocation finds nothing left to do", async () => {
    const { deps } = fakeDeps({ jobs: [job("a", "documents/a.pdf")] });

    await runMaintenance(deps);
    const second = await runMaintenance(deps);

    expect(second.storage).toMatchObject({ claimed: 0, completed: 0, released: 0 });
    expect(second.errors).toEqual({});
  });
});
