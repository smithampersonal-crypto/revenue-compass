/**
 * Phase 9G — Task 9B. The safe browser projection of an approved Guidance card.
 *
 * Only accountant-facing approved content crosses. The card's identity, its
 * content hash, its retrieval signals and every machine-policy field stay on
 * the server: the AI's internal Guidance reference is never user authority,
 * and the browser is never given a handle it could use to ask for another card.
 *
 * Pure and browser-safe: no registry import, no database, no network.
 */

import type { GuidanceCard } from "@/lib/arc/guidance/types";

export interface AiGuidanceCardDto {
  topic: string;
  subtopic: string;
  primaryAscReference: string;
  relatedAscReferences: string;
  ruleSummary: string;
  decisionCriteria: string;
  factsRequired: string;
  importantNuances: string;
  whenRelevant: string;
  accountantMustApprove: string;
  interpretiveSource: string;
  sourceUrls: string[];
  /** ISO calendar date (YYYY-MM-DD). */
  lastReviewed: string;
}

/** Exhaustive by construction: only these fields ever reach the browser. */
export function toAiGuidanceCardDto(card: GuidanceCard): AiGuidanceCardDto {
  return {
    topic: card.topic,
    subtopic: card.subtopic,
    primaryAscReference: card.primaryAscReference,
    relatedAscReferences: card.relatedAscReferences,
    ruleSummary: card.ruleSummary,
    decisionCriteria: card.decisionCriteria,
    factsRequired: card.factsRequired,
    importantNuances: card.importantNuances,
    whenRelevant: card.whenRelevant,
    accountantMustApprove: card.accountantMustApprove,
    interpretiveSource: card.interpretiveSource,
    sourceUrls: [...card.sourceUrls],
    lastReviewed: card.lastReviewed,
  };
}
