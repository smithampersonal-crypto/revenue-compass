/**
 * Phase 9G — Task 7. The safe browser read model for AI review and provenance.
 *
 * Pure and browser-safe: no database, no React, no network, no clock. It is a
 * trust boundary in one direction only — persisted merge state is projected
 * DOWN to the minimum set of presentation facts an accountant needs, and
 * nothing the browser sends back is ever authoritative.
 *
 * Deliberately absent from every shape here: value fingerprints, last AI run
 * ids, semantic keys, tombstones, guidance ids, document ids, actor identity
 * and audit-event rows. A review fingerprint crosses for exactly one reason —
 * it is the accepted optimistic precondition a Task 2 review action echoes
 * back, and the server re-derives it either way.
 */

import type { AiProvenanceState } from "./merge";
import type {
  AiReviewItem,
  AiReviewItemState,
  AiReviewReasonCode,
  AiReviewSeverity,
  AiAffirmationMethod,
  ManualRedReason,
} from "./review-state";
import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";

/* ------------------------------------------------------------------ DTOs */

export interface AiReviewCitationDto {
  pageStart: number;
  pageEnd: number;
  /** First persisted citation position in this exact trusted document/page group. */
  citationIndex: number;
  /** Preserved internally even though the presentation does not label visual evidence. */
  evidenceModes: Array<"text" | "visual">;
  /** Distinct validated excerpts in their original persisted order. */
  excerpts: string[];
}

export type AiReviewResolutionDto =
  | { kind: "affirmed"; at: string; method: AiAffirmationMethod }
  | { kind: "manual_red"; at: string; reason: ManualRedReason; note: string | null };

export interface AiReviewItemDto {
  id: string;
  /**
   * The canonical target the review item is about. It is an opaque binding
   * key for the presentation registry and inline markers — never displayed.
   */
  targetKey: string;
  section: GuidanceReviewSection;
  state: AiReviewItemState;
  severity: AiReviewSeverity;
  reasonCode: AiReviewReasonCode;
  reason: string;
  reviewFingerprint: string;
  citations: AiReviewCitationDto[];
  /**
   * Phase 9G — Task 9B. How many approved Guidance cards the server can show
   * for this review point. A count only: no Guidance id, no registry hash, no
   * retrieval tag and no inclusion reason crosses the boundary.
   */
  guidanceReferenceCount: number;
  resolution: AiReviewResolutionDto | null;
}

export interface AiFieldProvenanceDto {
  state: AiProvenanceState;
}

export interface AiObjectProvenanceDto {
  canonicalId: string;
  state: AiProvenanceState;
  userModified: boolean;
}

/* ------------------------------------------------------------ projection */

function resolutionDto(item: AiReviewItem): AiReviewResolutionDto | null {
  const resolution = item.resolution;
  if (resolution === null) return null;
  if (resolution.kind === "affirmed") {
    return { kind: "affirmed", at: resolution.at, method: resolution.method };
  }
  return {
    kind: "manual_red",
    at: resolution.at,
    reason: resolution.reason,
    note: resolution.note,
  };
}

/**
 * Groups only with identity available on the trusted side of the boundary.
 * The document id is consumed as a key and never copied into the result.
 */
function citationDtos(item: AiReviewItem): AiReviewCitationDto[] {
  const groups = new Map<
    string,
    { pageStart: number; pageEnd: number; citationIndex: number; evidenceModes: Array<"text" | "visual">; excerpts: string[] }
  >();

  item.citations.forEach((citation, citationIndex) => {
    const key = JSON.stringify([citation.documentId, citation.pageStart, citation.pageEnd]);
    const existing = groups.get(key);
    if (existing) {
      if (!existing.evidenceModes.includes(citation.evidenceMode)) {
        existing.evidenceModes.push(citation.evidenceMode);
      }
      if (citation.excerpt !== null && !existing.excerpts.includes(citation.excerpt)) {
        existing.excerpts.push(citation.excerpt);
      }
      return;
    }
    groups.set(key, {
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      citationIndex,
      evidenceModes: [citation.evidenceMode],
      excerpts: citation.excerpt === null ? [] : [citation.excerpt],
    });
  });

  return [...groups.values()];
}

/** Exhaustive by construction: only these fields ever cross to the browser. */
export function toAiReviewItemDto(item: AiReviewItem): AiReviewItemDto {
  return {
    id: item.id,
    targetKey: item.targetKey,
    section: item.section,
    state: item.state,
    severity: item.severity,
    reasonCode: item.reasonCode,
    reason: item.reason,
    reviewFingerprint: item.reviewFingerprint,
    citations: citationDtos(item),
    // Availability only. The trusted ids stay server-side, where the Guidance
    // action resolves them from the item itself.
    guidanceReferenceCount: item.guidanceIds.length,
    resolution: resolutionDto(item),
  };
}

export function toAiReviewItemDtos(items: readonly AiReviewItem[]): AiReviewItemDto[] {
  return items.map(toAiReviewItemDto);
}

/**
 * Phase 9G-R Task R2. The two lists are kept apart at the boundary itself, so
 * no caller can accidentally present a routine assumption as something the
 * accountant must act on, or count one towards finalization.
 */
export function partitionAiReviewItems(items: readonly AiReviewItem[]): {
  reviewItems: AiReviewItemDto[];
  assumptionItems: AiReviewItemDto[];
  outstandingActionableCount: number;
} {
  const reviewItems: AiReviewItemDto[] = [];
  const assumptionItems: AiReviewItemDto[] = [];
  let outstandingActionableCount = 0;
  for (const item of items) {
    if (item.state === "assumed") {
      assumptionItems.push(toAiReviewItemDto(item));
      continue;
    }
    if (item.state === "yellow" || item.state === "red") outstandingActionableCount += 1;
    reviewItems.push(toAiReviewItemDto(item));
  }
  return { reviewItems, assumptionItems, outstandingActionableCount };
}

/* ----------------------------------------------------- provenance safety */

const PROVENANCE_STATES: readonly AiProvenanceState[] = [
  "ai_generated_untouched",
  "ai_generated_user_edited",
  "manual_from_start",
  "prior_finalized",
  "ai_difference_preserved_user_override",
];

export function isAiProvenanceState(value: unknown): value is AiProvenanceState {
  return PROVENANCE_STATES.includes(value as AiProvenanceState);
}

function entriesOf(raw: unknown): Array<readonly [string, Record<string, unknown>]> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? [[key, value as Record<string, unknown>] as const]
      : [],
  );
}

/**
 * Persisted field provenance, validated entry by entry. An unknown state, a
 * malformed entry or a non-object payload is omitted rather than cast: a
 * provenance value the browser could not have produced must never become a
 * browser-controlled state.
 */
export function sanitizeFieldProvenance(raw: unknown): Record<string, AiFieldProvenanceDto> {
  const safe: Record<string, AiFieldProvenanceDto> = {};
  for (const [key, entry] of entriesOf(raw)) {
    if (!isAiProvenanceState(entry["state"])) continue;
    safe[key] = { state: entry["state"] };
  }
  return safe;
}

/** Object provenance is bound by canonical id only — never by array position. */
export function sanitizeObjectProvenance(raw: unknown): Record<string, AiObjectProvenanceDto> {
  // The persisted map is keyed by a semantic key that must never cross the
  // trust boundary — not even as a JSON property name. The browser-safe map is
  // therefore re-keyed by the validated canonical id.
  const safe: Record<string, AiObjectProvenanceDto> = {};
  const collided = new Set<string>();
  for (const [, entry] of entriesOf(raw)) {
    if (!isAiProvenanceState(entry["state"])) continue;
    if (typeof entry["canonicalId"] !== "string" || entry["canonicalId"].length === 0) continue;
    if (typeof entry["userModified"] !== "boolean") continue;
    const canonicalId = entry["canonicalId"];
    if (collided.has(canonicalId)) continue;
    if (canonicalId in safe) {
      // Fail closed: one record must never masquerade as another.
      delete safe[canonicalId];
      collided.add(canonicalId);
      continue;
    }
    safe[canonicalId] = {
      canonicalId,
      state: entry["state"],
      userModified: entry["userModified"],
    };
  }
  return safe;
}
