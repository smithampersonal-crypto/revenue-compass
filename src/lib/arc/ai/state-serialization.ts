/**
 * Phase 9G-R3 — the ONE serializer for the persisted AI sidecar.
 *
 * Two trusted write paths reach `ai_analysis_state`: autosave edit
 * reconciliation and the successful AI-run apply. Both must write tombstones
 * in the identity-bearing representation, otherwise a deletion recorded by
 * economic identity silently degrades to an alias-only tombstone the next time
 * an AI run is applied, and a renamed deleted object comes back.
 *
 * Keeping the encoding here — rather than at each call site — is what stops
 * those two paths from diverging again.
 *
 * Pure: no I/O, no clock, no randomness.
 */

import type { AiAnalysisState } from "./merge";
import { encodeTombstones } from "./tombstones";

/** The persisted `tombstones` member: aliases plus identity records. */
export function encodedAiTombstones(state: AiAnalysisState): unknown[] {
  return encodeTombstones(state.tombstones, state.tombstoneIdentities ?? []);
}

/**
 * The sidecar exactly as the database stores it. `tombstoneIdentities` is not
 * a column: it lives inside the encoded `tombstones` array, so it is dropped
 * from the top level rather than written twice.
 */
export function toPersistedAiState(state: AiAnalysisState): Record<string, unknown> {
  const { tombstoneIdentities: _folded, ...rest } = state;
  return { ...rest, tombstones: encodedAiTombstones(state) };
}
