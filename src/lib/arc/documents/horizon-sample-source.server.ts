/**
 * Server-only wiring for the Horizon New Analysis source document.
 *
 * The canonical tracked PDF is inlined into the server bundle at build time
 * from public/samples/ — there is no second repository copy and no HTTP fetch
 * of ARC's own site. Integrity is re-proven by the pinned SHA-256 on every use.
 */

import horizonPdfDataUrl from "../../../../public/samples/horizon-logistics-saas-order-form.pdf?inline";

import type { HorizonSeedDeps } from "./horizon-sample-source";
import { SOURCE_DOCUMENT_BUCKET } from "./types";

export async function loadHorizonSampleBytes(): Promise<Uint8Array> {
  const comma = horizonPdfDataUrl.indexOf(",");
  if (!horizonPdfDataUrl.startsWith("data:") || comma < 0) {
    throw new Error("Horizon sample asset is unavailable.");
  }
  const header = horizonPdfDataUrl.slice(0, comma);
  const body = horizonPdfDataUrl.slice(comma + 1);
  if (header.endsWith(";base64")) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

export async function horizonSeedDeps(): Promise<HorizonSeedDeps> {
  const { documentStorage, documentStore } = await import("./documents.store.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    documents: { store: await documentStore(), storage: documentStorage, now: () => new Date() },
    loadBytes: loadHorizonSampleBytes,
    uploadPending: async (path, bytes) => {
      const { error } = await supabaseAdmin.storage
        .from(SOURCE_DOCUMENT_BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error("Document storage is unavailable (upload).", { cause: error });
    },
    deleteWorkspace: async (analysisId, tokenHash) => {
      // Existing cascade: document rows, selections and intents go with the
      // workspace, and their triggers durably queue every private object.
      const { error } = await supabaseAdmin
        .from("guest_workspaces")
        .delete()
        .eq("id", analysisId)
        .eq("token_hash", tokenHash)
        .eq("status", "active");
      if (error) throw new Error("Temporary analysis cleanup failed.", { cause: error });
    },
    removeObjects: documentStorage.remove,
  };
}
