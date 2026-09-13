/**
 * Phase 8B — narrow, server-only helpers for the private document bucket.
 *
 * `arc-source-documents` is private: no object is ever given a public or
 * permanent URL, and the service-role client used here is never reachable from
 * the browser. The browser receives only short-lived signed targets and links.
 */

import { SIGNED_READ_TTL_SECONDS, SOURCE_DOCUMENT_BUCKET } from "./types";

async function bucket() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin.storage.from(SOURCE_DOCUMENT_BUCKET);
}

function storageFailure(operation: string, error: { message?: string } | null): never {
  // Internal Supabase detail never reaches the caller.
  throw new Error(`Document storage is unavailable (${operation}).`, { cause: error });
}

/** A one-time signed upload target for exactly one pending object path. */
export async function createPendingUploadTarget(
  objectPath: string,
): Promise<{ token: string; path: string }> {
  const { data, error } = await (await bucket()).createSignedUploadUrl(objectPath);
  if (error || !data) storageFailure("upload target", error);
  return { token: data.token, path: data.path };
}

export async function downloadPrivateObject(objectPath: string): Promise<Uint8Array> {
  const { data, error } = await (await bucket()).download(objectPath);
  if (error || !data) storageFailure("download", error);
  return new Uint8Array(await data.arrayBuffer());
}

/** True when the object is present; used to confirm an ambiguous promotion. */
export async function privateObjectExists(objectPath: string): Promise<boolean> {
  const separator = objectPath.lastIndexOf("/");
  const prefix = separator > 0 ? objectPath.slice(0, separator) : "";
  const name = separator > 0 ? objectPath.slice(separator + 1) : objectPath;
  const { data, error } = await (await bucket()).list(prefix, { search: name, limit: 100 });
  if (error) storageFailure("lookup", error);
  return (data ?? []).some((entry) => entry.name === name);
}

/**
 * Moves a validated pending object to its permanent path.
 *
 * Retry-safe: when the move reports the source as missing after a lost
 * response, the permanent object's presence decides the outcome.
 */
export async function ensureObjectPromoted(
  pendingPath: string,
  permanentPath: string,
): Promise<void> {
  const { error } = await (await bucket()).move(pendingPath, permanentPath);
  if (!error) return;
  if (await privateObjectExists(permanentPath)) return;
  storageFailure("promotion", error);
}

export async function removePrivateObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await (await bucket()).remove(paths);
  if (error) storageFailure("cleanup", error);
}

/**
 * A 15-minute signed link. `view` is inline where the browser supports it;
 * `download` asks for download disposition using the immutable filename.
 * These links are ephemeral responses and are never stored anywhere.
 */
export async function createDocumentReadUrl(args: {
  objectPath: string;
  originalFilename: string;
  disposition: "view" | "download";
}): Promise<string> {
  const { data, error } = await (await bucket()).createSignedUrl(
    args.objectPath,
    SIGNED_READ_TTL_SECONDS,
    args.disposition === "download" ? { download: args.originalFilename } : undefined,
  );
  if (error || !data?.signedUrl) storageFailure("link", error);
  return data.signedUrl;
}
