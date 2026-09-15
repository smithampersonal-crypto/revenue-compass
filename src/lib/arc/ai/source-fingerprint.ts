/**
 * Phase 9C — deterministic source-set identity.
 *
 * The fingerprint is immutable run provenance, so it is computed by the server
 * from verified document identity only. Mutable presentation values (display
 * name, original filename, effective date) are deliberately excluded: renaming
 * a document must not look like a different source set.
 *
 * Pure and browser-safe: no Supabase client, no storage access, no evidence.
 */

export interface AiSourceIdentity {
  documentId: string;
  sha256: string;
}

/** Stable order, independent of how the rows arrived from the database. */
function canonical(sources: readonly AiSourceIdentity[]): string {
  const rows = [...sources]
    .map((source) => ({
      documentId: String(source.documentId),
      sha256: String(source.sha256).toLowerCase(),
    }))
    .sort((a, b) =>
      a.documentId === b.documentId
        ? a.sha256.localeCompare(b.sha256)
        : a.documentId.localeCompare(b.documentId),
    );
  return JSON.stringify(rows.map((row) => [row.documentId, row.sha256]));
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 hex over the canonical selection. An empty selection has its own
 * stable fingerprint rather than an empty string, so "nothing selected" is
 * still a recorded state.
 */
export async function computeSourceSetFingerprint(
  sources: readonly AiSourceIdentity[],
): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(sources));
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
