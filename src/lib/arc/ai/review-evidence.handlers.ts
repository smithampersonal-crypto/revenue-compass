/**
 * Phase 9G — Task 9A/9B. Deliberate review evidence: the source page behind a
 * citation, and the approved Guidance behind a review item.
 *
 * Both actions are narrow reads. The browser names a review item, echoes the
 * review fingerprint it displayed, and — for evidence — the ordinal of the
 * citation it clicked. Nothing else it sends is authoritative:
 *
 *   - the caller scope is re-derived and re-authorized on every call;
 *   - the review payload is re-normalized from persistence, so a stale or
 *     forged item cannot be addressed;
 *   - the document id behind a citation is resolved server-side from that
 *     validated item, never accepted from the request;
 *   - the Guidance ids behind an item are resolved the same way, so there is
 *     no card-id input, no enumeration and no public Guidance library.
 *
 * Failures are neutral: an unknown item, a moved fingerprint, an out-of-range
 * ordinal, a foreign document and a missing card all produce the same settled
 * copy, and never reveal which of them happened.
 *
 * Browser-safe: no Supabase client, no storage client, no registry import.
 */

import type { AiGuidanceCardDto } from "./guidance-dto";
import type { AiReviewItem } from "./review-state";
import { AI_WORKSPACE_NOT_EDITABLE, type AiCallerScope } from "./runs.handlers";
import type { AiWorkspaceStore } from "./workspace.handlers";

/** One settled message for every way evidence can be unavailable. */
export const AI_EVIDENCE_UNAVAILABLE =
  "That source page could not be opened. Reload the analysis and try again.";

/** One settled message for every way Guidance can be unavailable. */
export const AI_GUIDANCE_UNAVAILABLE =
  "Guidance for this review point could not be opened. Reload the analysis and try again.";

export interface AiEvidenceLinkDto {
  /** Ephemeral, short-lived signed VIEW url. Never persisted anywhere. */
  url: string;
  expiresInSeconds: number;
  /** Authoritative page facts, re-read from the validated citation. */
  pageStart: number;
  pageEnd: number;
}

export interface AiReviewGuidanceDto {
  cards: AiGuidanceCardDto[];
}

export interface AiEvidenceDocumentAccess {
  /**
   * A short-lived signed VIEW url for a document the caller demonstrably owns,
   * through the accepted Phase 8 document-read authorization path. `null`
   * whenever the document is not reachable from this exact scope.
   */
  createReviewReadUrl(args: {
    caller: AiCallerScope;
    documentId: string;
  }): Promise<{ url: string; expiresInSeconds: number } | null>;
}

export interface AiGuidanceAccess {
  /** Approved compiled cards for trusted ids, in registry order. */
  findApprovedCards(ids: readonly number[]): Promise<AiGuidanceCardDto[]>;
}

export interface AiReviewEvidenceDeps {
  store: AiWorkspaceStore;
  documents: AiEvidenceDocumentAccess;
}

export interface AiReviewGuidanceDeps {
  store: AiWorkspaceStore;
  guidance: AiGuidanceAccess;
}

export interface AiReviewEvidenceInput {
  reviewItemId: string;
  expectedReviewFingerprint: string;
  /** 0-based ordinal of the citation as presented. */
  citationIndex: number;
}

export interface AiReviewGuidanceInput {
  reviewItemId: string;
  expectedReviewFingerprint: string;
}

async function assertEditableScope(store: AiWorkspaceStore, caller: AiCallerScope): Promise<void> {
  if (caller.kind === "revision") {
    const revision = await store.findEditableRevision(caller.revisionId, caller.userId);
    if (!revision) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
    return;
  }
  const workspace = await store.findActiveGuestWorkspace(caller.guestTokenHash);
  if (!workspace) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
}

/**
 * The review item as persistence currently understands it. A malformed payload
 * yields nothing at all, exactly as the workspace read does.
 */
async function currentItem(
  store: AiWorkspaceStore,
  caller: AiCallerScope,
  input: { reviewItemId: string; expectedReviewFingerprint: string },
  unavailable: string,
): Promise<AiReviewItem> {
  const snapshot = await store.loadWorkspaceSnapshot(caller);
  if (snapshot.reviewPayloadMalformed === true) throw new Error(unavailable);
  const item = (snapshot.reviewItems ?? []).find((row) => row.id === input.reviewItemId);
  if (!item) throw new Error(unavailable);
  // The displayed fingerprint must still be the persisted one: evidence is
  // only ever opened for the exact review point the accountant was looking at.
  if (item.reviewFingerprint !== input.expectedReviewFingerprint) throw new Error(unavailable);
  return item;
}

/* -------------------------------------------------------------- evidence */

export async function aiReviewEvidenceLinkHandler(
  deps: AiReviewEvidenceDeps,
  caller: AiCallerScope,
  input: AiReviewEvidenceInput,
): Promise<AiEvidenceLinkDto> {
  await assertEditableScope(deps.store, caller);
  const item = await currentItem(deps.store, caller, input, AI_EVIDENCE_UNAVAILABLE);

  const index = input.citationIndex;
  if (!Number.isInteger(index) || index < 0 || index >= item.citations.length) {
    throw new Error(AI_EVIDENCE_UNAVAILABLE);
  }
  const citation = item.citations[index]!;

  // The document identity comes from the validated citation, never from the
  // request, and the authorization path is the accepted document one: a
  // document outside this scope simply fails neutrally.
  const link = await deps.documents.createReviewReadUrl({
    caller,
    documentId: citation.documentId,
  });
  if (!link) throw new Error(AI_EVIDENCE_UNAVAILABLE);

  return {
    url: link.url,
    expiresInSeconds: link.expiresInSeconds,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
  };
}

/* -------------------------------------------------------------- guidance */

export async function aiReviewGuidanceHandler(
  deps: AiReviewGuidanceDeps,
  caller: AiCallerScope,
  input: AiReviewGuidanceInput,
): Promise<AiReviewGuidanceDto> {
  await assertEditableScope(deps.store, caller);
  const item = await currentItem(deps.store, caller, input, AI_GUIDANCE_UNAVAILABLE);

  // Trusted ids only: they were recorded by the server when the run was
  // applied. The browser never names a card.
  const requiredIds = [...new Set(item.guidanceIds)];
  const cards = await deps.guidance.findApprovedCards(requiredIds);
  // Guidance is presented only as a complete set. A partial registry result
  // could otherwise imply that the visible cards are the entire basis for the
  // review point. Duplicate persisted references count once.
  if (requiredIds.length === 0 || cards.length !== requiredIds.length) {
    throw new Error(AI_GUIDANCE_UNAVAILABLE);
  }
  return { cards };
}
