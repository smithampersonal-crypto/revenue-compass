/**
 * Phase 8B — browser upload against a server-issued signed target.
 *
 * The browser never chooses a bucket or an object path and never holds a
 * service-role key: it can only place bytes at the single pending location the
 * server already reserved for this upload.
 */

import { supabase } from "@/integrations/supabase/client";

import type { UploadIntentDto } from "./types";

export async function uploadPdfToSignedTarget(
  target: UploadIntentDto,
  file: File | Blob,
): Promise<void> {
  const { error } = await supabase.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.path, target.token, file, {
      contentType: "application/pdf",
      // One target, one object: a signed target is never reused to overwrite.
      upsert: false,
    });

  if (error) {
    throw new Error("The file could not be uploaded. Please try again.", { cause: error });
  }
}
