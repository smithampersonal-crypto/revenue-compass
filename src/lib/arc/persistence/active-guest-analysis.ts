/**
 * Package 3D-T — which temporary analysis the browser is currently working in.
 *
 * Browser-only, in memory: never persisted, never a credential. The client
 * function middleware copies it into the `x-arc-guest-analysis` request header
 * so document and AI calls made inside an analysis target that analysis; the
 * server re-derives and checks the credential from the session cookie.
 */

let activeGuestAnalysisId: string | null = null;

export function setActiveGuestAnalysisId(id: string | null): void {
  activeGuestAnalysisId = id;
}

/** Clears only when the analysis being left is still the active one. */
export function clearActiveGuestAnalysisId(id: string | null): void {
  if (activeGuestAnalysisId === id) activeGuestAnalysisId = null;
}

export function getActiveGuestAnalysisId(): string | null {
  return activeGuestAnalysisId;
}
