/**
 * Horizon New Analysis source-document parity.
 *
 * When a visitor opens the Horizon sample from New Analysis, the new temporary
 * analysis receives the canonical Horizon PDF as a real guest source document,
 * owned by that one workspace, through ARC's existing upload pipeline
 * (intent -> private pending object -> server validation -> commit + select).
 *
 * Fail closed: if any step fails after the workspace exists, the workspace is
 * removed through the existing relational cascade (whose triggers durably
 * queue every private object), and a safe error is thrown so no analysis id is
 * ever returned. No AI call, no AI run, no allowance movement.
 */

import {
  finalizeUploadHandler,
  initiateUploadHandler,
  type DocumentDeps,
} from "./documents.handlers";

/** The exact origin that receives the Horizon source document. */
export const HORIZON_SAMPLE_ORIGIN = "sample:horizon";

/** The single tracked canonical file (public/samples/…). */
export const HORIZON_SAMPLE_FILENAME = "horizon-logistics-saas-order-form.pdf";
export const HORIZON_SAMPLE_DISPLAY_NAME = "Horizon Logistics — SaaS Order Form & Billing Schedule";
/** Full SHA-256 of the canonical tracked PDF. Any other bytes fail closed. */
export const HORIZON_SAMPLE_SHA256 =
  "a39c8883c51ea97c83166ce61d0ec506fb86324348afbcaa5c846edabb859c70";

export const HORIZON_SAMPLE_UNAVAILABLE =
  "The Horizon sample couldn't be opened. Please try again.";

export interface HorizonSeedDeps {
  documents: DocumentDeps;
  /** The canonical bytes, bundled from the tracked file at build time. */
  loadBytes(): Promise<Uint8Array>;
  /** Server-side placement of bytes at the server-assigned pending path. */
  uploadPending(path: string, bytes: Uint8Array): Promise<void>;
  /** Compensation: remove exactly this newly created temporary workspace. */
  deleteWorkspace(analysisId: string, tokenHash: string): Promise<void>;
  /** Best-effort immediate object removal; the cascade queues them anyway. */
  removeObjects?(paths: string[]): Promise<void>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function seedHorizonSampleSource(
  deps: HorizonSeedDeps,
  input: { analysisId: string; token: string; tokenHash: string },
): Promise<{ sourceDocumentId: string }> {
  let pendingPath: string | null = null;
  try {
    const bytes = await deps.loadBytes();
    if ((await sha256Hex(bytes)) !== HORIZON_SAMPLE_SHA256) {
      throw new Error("Horizon sample bytes do not match the canonical file.");
    }
    const caller = { kind: "guest" as const, token: input.token };
    const intent = await initiateUploadHandler(deps.documents, caller, {
      originalFilename: HORIZON_SAMPLE_FILENAME,
      displayName: HORIZON_SAMPLE_DISPLAY_NAME,
      declaredByteSize: bytes.byteLength,
    });
    pendingPath = intent.path;
    await deps.uploadPending(intent.path, bytes);
    const result = await finalizeUploadHandler(deps.documents, caller, {
      intentId: intent.intentId,
    });
    if (!result.ok || !result.associated) {
      throw new Error("Horizon sample source document was not included.");
    }
    return { sourceDocumentId: result.sourceDocumentId };
  } catch (cause) {
    console.error("HZDEBUG", cause instanceof Error ? cause.message : cause, (cause as {cause?: unknown})?.cause);
    try {
      await deps.deleteWorkspace(input.analysisId, input.tokenHash);
    } catch (cleanupError) {
      throw new Error(HORIZON_SAMPLE_UNAVAILABLE, { cause: cleanupError });
    }
    if (pendingPath && deps.removeObjects) {
      try {
        await deps.removeObjects([pendingPath]);
      } catch {
        // Already durably queued by the relational cascade.
      }
    }
    throw new Error(HORIZON_SAMPLE_UNAVAILABLE, { cause });
  }
}
