/**
 * Browser-safe Guidance Registry access.
 *
 * Runtime consumers (future Guidance Library UI, future Terra Guidance Pack)
 * read this module only. The workbook, `exceljs` and the compiler never reach
 * the browser bundle.
 */

import { getGuidancePolicy, POLICY_CARD_ID_COUNT } from "./policy";
import {
  GUIDANCE_CARDS,
  GUIDANCE_REGISTRY_CARD_COUNT,
  GUIDANCE_REGISTRY_HASH,
  GUIDANCE_REGISTRY_VERSION,
} from "./registry.generated";
import type { GuidanceCard, GuidanceMachinePolicy } from "./types";

export { GUIDANCE_CARDS, GUIDANCE_REGISTRY_HASH, GUIDANCE_REGISTRY_VERSION };

export const GUIDANCE_CARDS_BY_ID: ReadonlyMap<number, GuidanceCard> = new Map(
  GUIDANCE_CARDS.map((card) => [card.id, card]),
);

export function getGuidanceCard(id: number): GuidanceCard {
  const card = GUIDANCE_CARDS_BY_ID.get(id);
  if (!card) {
    throw new Error(`Unknown guidance card ${id}.`);
  }
  return card;
}

export function getGuidanceCardPolicy(id: number): GuidanceMachinePolicy {
  getGuidanceCard(id);
  return getGuidancePolicy(id);
}

/**
 * Fails closed when the compiled registry and the reviewed machine policy have
 * drifted apart: wrong count, duplicate or unsorted IDs, a non-Approved card,
 * a missing hash, or any card without machine policy.
 */
export function assertGuidanceRegistryCurrent(): void {
  if (GUIDANCE_CARDS.length !== GUIDANCE_REGISTRY_CARD_COUNT) {
    throw new Error("Guidance registry card count does not match the generated header.");
  }
  if (!GUIDANCE_REGISTRY_HASH || GUIDANCE_REGISTRY_HASH.length !== 64) {
    throw new Error("Guidance registry hash is missing or malformed.");
  }
  if (GUIDANCE_CARDS.length !== POLICY_CARD_ID_COUNT) {
    throw new Error(
      `Guidance registry has ${GUIDANCE_CARDS.length} cards but ARC machine policy covers ${POLICY_CARD_ID_COUNT}.`,
    );
  }
  let previous = 0;
  for (const card of GUIDANCE_CARDS) {
    if (card.id <= previous) {
      throw new Error(`Guidance registry is not sorted by stable Item No. at card ${card.id}.`);
    }
    previous = card.id;
    if (card.status !== "Approved") {
      throw new Error(`Guidance registry contains a non-Approved card ${card.id}.`);
    }
    if (!card.contentHash || card.contentHash.length !== 64) {
      throw new Error(`Guidance card ${card.id} has a malformed content hash.`);
    }
    // Throws when a card has no reviewed machine policy.
    getGuidancePolicy(card.id);
  }
}
