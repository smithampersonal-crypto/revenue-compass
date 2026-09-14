/**
 * Phase 8F — ARC maintenance handlers.
 *
 * Pure and dependency-injected: no Supabase client, no service-role material,
 * no storage SDK. Everything here decides *what* maintenance does; the server
 * module supplies the trusted effects.
 *
 * Privacy: nothing in this module ever records document text, raw PDF bytes,
 * signed URLs, cookies, auth tokens or guest credentials. Failures are reduced
 * to a small, fixed set of safe categories before they are counted.
 */

/** Bounded batch size for a single storage-queue drain. */
export const DELETION_BATCH_LIMIT = 50;
/** Bounded batch size for a single stale-upload sweep. */
export const STALE_INTENT_LIMIT = 200;

export interface StorageDeletionJob {
  id: string;
  bucket: string;
  path: string;
  attemptCount: number;
}

export type StorageFailureCategory = "not_found" | "permission" | "network" | "unknown";

export interface MaintenanceDeps {
  claimDeletionJobs(limit: number): Promise<StorageDeletionJob[]>;
  removeObject(bucket: string, path: string): Promise<void>;
  objectExists(bucket: string, path: string): Promise<boolean>;
  completeDeletionJob(jobId: string): Promise<boolean>;
  releaseDeletionJob(jobId: string, category: StorageFailureCategory): Promise<boolean>;
  cleanupStaleUploadIntents(limit: number): Promise<{ processed: number; queued: number }>;
  expireGuestWorkspaces(): Promise<{ marked: number; deleted: number }>;
}

export interface StorageDrainReport {
  claimed: number;
  completed: number;
  alreadyAbsent: number;
  released: number;
  failures: Partial<Record<StorageFailureCategory, number>>;
}

export interface MaintenanceReport {
  staleIntentsProcessed: number;
  staleIntentObjectsQueued: number;
  guestWorkspacesMarkedExpired: number;
  guestWorkspacesDeleted: number;
  storage: StorageDrainReport;
  /** Safe category per failed sub-operation; never a provider message. */
  errors: Record<string, StorageFailureCategory>;
}

/**
 * Reduces any provider failure to a safe category. The original message is
 * deliberately discarded: it can contain a signed URL or an object path.
 */
export function categorizeStorageFailure(cause: unknown): StorageFailureCategory {
  const text = (cause instanceof Error ? cause.message : String(cause ?? "")).toLowerCase();
  if (text.includes("not found") || text.includes("404") || text.includes("no such")) {
    return "not_found";
  }
  if (
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("401") ||
    text.includes("403")
  ) {
    return "permission";
  }
  if (
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("fetch") ||
    text.includes("econn")
  ) {
    return "network";
  }
  return "unknown";
}

function count(
  failures: Partial<Record<StorageFailureCategory, number>>,
  category: StorageFailureCategory,
): void {
  failures[category] = (failures[category] ?? 0) + 1;
}

/**
 * One bounded drain of the durable deletion queue.
 *
 * claim bounded batch -> attempt private-storage deletion -> complete the
 * successful jobs -> release the retryable failures. A job never disappears
 * because deletion failed: only an observed end state (object gone) completes
 * it, and a released job keeps its durable row for the next invocation.
 *
 * Overlap safety comes from the claim RPC itself (`for update skip locked`
 * plus a claim stamp), so two concurrent invocations can never independently
 * own the same job.
 */
export async function drainStorageDeletionQueue(
  deps: MaintenanceDeps,
  limit: number = DELETION_BATCH_LIMIT,
): Promise<StorageDrainReport> {
  const report: StorageDrainReport = {
    claimed: 0,
    completed: 0,
    alreadyAbsent: 0,
    released: 0,
    failures: {},
  };

  const jobs = await deps.claimDeletionJobs(Math.max(1, limit));
  report.claimed = jobs.length;

  for (const job of jobs) {
    try {
      await deps.removeObject(job.bucket, job.path);
      await deps.completeDeletionJob(job.id);
      report.completed += 1;
    } catch (cause) {
      const category = categorizeStorageFailure(cause);
      // An object that is already absent is the desired end state, not a
      // failure to retry forever.
      let absent = false;
      try {
        absent = !(await deps.objectExists(job.bucket, job.path));
      } catch {
        absent = false;
      }
      if (absent) {
        await deps.completeDeletionJob(job.id);
        report.completed += 1;
        report.alreadyAbsent += 1;
        continue;
      }
      await deps.releaseDeletionJob(job.id, category);
      report.released += 1;
      count(report.failures, category);
    }
  }

  return report;
}

/**
 * One hourly maintenance invocation.
 *
 * Each category is isolated: a failed sub-operation is recorded as a safe
 * category and never discards another category's work. Every operation is
 * bounded and idempotent, so an overlapping or restarted invocation is safe.
 */
export async function runMaintenance(
  deps: MaintenanceDeps,
  options: { intentLimit?: number; deletionLimit?: number } = {},
): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    staleIntentsProcessed: 0,
    staleIntentObjectsQueued: 0,
    guestWorkspacesMarkedExpired: 0,
    guestWorkspacesDeleted: 0,
    storage: { claimed: 0, completed: 0, alreadyAbsent: 0, released: 0, failures: {} },
    errors: {},
  };

  try {
    const stale = await deps.cleanupStaleUploadIntents(options.intentLimit ?? STALE_INTENT_LIMIT);
    report.staleIntentsProcessed = stale.processed;
    report.staleIntentObjectsQueued = stale.queued;
  } catch (cause) {
    report.errors["staleUploads"] = categorizeStorageFailure(cause);
  }

  try {
    const guests = await deps.expireGuestWorkspaces();
    report.guestWorkspacesMarkedExpired = guests.marked;
    report.guestWorkspacesDeleted = guests.deleted;
  } catch (cause) {
    report.errors["guestExpiration"] = categorizeStorageFailure(cause);
  }

  // The drain runs last so objects queued by the two sweeps above are picked
  // up in the same invocation whenever the batch budget allows.
  try {
    report.storage = await drainStorageDeletionQueue(
      deps,
      options.deletionLimit ?? DELETION_BATCH_LIMIT,
    );
  } catch (cause) {
    report.errors["storageDrain"] = categorizeStorageFailure(cause);
  }

  return report;
}
