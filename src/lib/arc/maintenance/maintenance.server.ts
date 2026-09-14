/**
 * Phase 8F — trusted effects for ARC maintenance.
 *
 * Server-only: the service-role client and the private Storage API are
 * reachable from here and nowhere in the browser. This module is imported
 * dynamically inside the maintenance route handler so no service-role material
 * can enter a client bundle.
 */

import { privateObjectExists, removePrivateObjects } from "@/lib/arc/documents/storage.server";
import { SOURCE_DOCUMENT_BUCKET } from "@/lib/arc/documents/types";

import type { MaintenanceDeps, StorageDeletionJob } from "./maintenance.handlers";

export function createMaintenanceDeps(): MaintenanceDeps {
  const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

  return {
    claimDeletionJobs: async (limit): Promise<StorageDeletionJob[]> => {
      const { data, error } = await (
        await admin()
      ).rpc("arc_claim_storage_deletion_jobs", {
        p_limit: limit,
      });
      if (error) throw new Error("deletion jobs could not be claimed", { cause: error });
      return (data ?? []).map((row) => ({
        id: row.id,
        bucket: row.storage_bucket,
        path: row.storage_object_path,
        attemptCount: row.attempt_count,
      }));
    },

    removeObject: async (_bucket, path) => {
      await removePrivateObjects([path]);
    },

    objectExists: async (_bucket, path) => privateObjectExists(path),

    completeDeletionJob: async (jobId) => {
      const { data, error } = await (
        await admin()
      ).rpc("arc_complete_storage_deletion_job", {
        p_job_id: jobId,
      });
      if (error) throw new Error("deletion job could not be completed", { cause: error });
      return Boolean(data);
    },

    // Only the safe category is durably recorded — never a provider message,
    // object path or signed URL.
    releaseDeletionJob: async (jobId, category) => {
      const { data, error } = await (
        await admin()
      ).rpc("arc_release_storage_deletion_job", {
        p_job_id: jobId,
        p_error: category,
      });
      if (error) throw new Error("deletion job could not be released", { cause: error });
      return Boolean(data);
    },

    cleanupStaleUploadIntents: async (limit) => {
      const { data, error } = await (
        await admin()
      ).rpc("arc_cleanup_stale_upload_intents", {
        p_limit: limit,
      } as never);
      if (error) throw new Error("stale uploads could not be cleaned", { cause: error });
      const row = ((data ?? []) as Array<{ intents_processed: number; objects_queued: number }>)[0];
      return { processed: row?.intents_processed ?? 0, queued: row?.objects_queued ?? 0 };
    },

    expireGuestWorkspaces: async () => {
      const client = await admin();
      const marked = await client.rpc("arc_expire_guest_workspaces");
      if (marked.error) {
        throw new Error("guest workspaces could not be expired", { cause: marked.error });
      }
      const deleted = await client.rpc("arc_delete_expired_guest_workspaces");
      if (deleted.error) {
        throw new Error("guest workspaces could not be deleted", { cause: deleted.error });
      }
      return { marked: Number(marked.data ?? 0), deleted: Number(deleted.data ?? 0) };
    },
  };
}

export { SOURCE_DOCUMENT_BUCKET };
