/**
 * Deterministic Guidance Pack retrieval.
 *
 * No embeddings, no vector store, no OpenAI, no semantic model. A card enters
 * a pack for exactly one of three reviewable reasons:
 *
 *   core        the curated minimal pack supplied to every analysis;
 *   retrieved   at least one STRONG signal matched the evidence text;
 *   dependency  reviewed policy links it to a card that was retrieved.
 *
 * Broad contextual vocabulary ("SaaS", "discount", "credit", "step3") can
 * support an explanation but can never by itself select a specialised card.
 */

import {
  BROAD_SIGNALS,
  CORE_GUIDANCE_IDS,
  CURATED_RETRIEVAL_SIGNALS,
  getGuidancePolicy,
} from "./policy";
import { GUIDANCE_CARDS, GUIDANCE_REGISTRY_HASH, getGuidanceCard } from "./registry";
import type { GuidanceCard, GuidanceInclusion, GuidancePack } from "./types";

/** NFKC + lowercase + whitespace collapse + trim. */
export function normalizeSignalText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Matching form: punctuation that varies between contracts is neutralised. */
function matchForm(value: string): string {
  return normalizeSignalText(value)
    .replace(/[\u2010-\u2015]/g, " ")
    .replace(/[-_/\\.,;:()"'’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "when",
  "whenever",
  "which",
  "with",
]);

/**
 * Limited fact-pattern phrases derived from the card's "When Relevant" prose.
 * These are supporting signals only — they never select a card on their own.
 */
export function whenRelevantPhrases(card: GuidanceCard): string[] {
  const phrases = new Set<string>();
  for (const clause of matchForm(card.whenRelevant).split(/[.;:]| and | or /)) {
    const words = clause.split(" ").filter((word) => word.length > 0);
    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start + size <= words.length; start += 1) {
        const window = words.slice(start, start + size);
        if (window.every((word) => STOPWORDS.has(word))) continue;
        if (STOPWORDS.has(window[0]!) || STOPWORDS.has(window[window.length - 1]!)) continue;
        const phrase = window.join(" ");
        if (phrase.length < 10) continue;
        if (BROAD_SIGNALS.has(phrase)) continue;
        phrases.add(phrase);
      }
    }
  }
  return [...phrases].sort();
}

export interface CardSignals {
  strong: string[];
  supporting: string[];
}

/** Strong vs supporting signal sets for one card. Deterministic and sorted. */
export function cardSignals(card: GuidanceCard): CardSignals {
  const strong = new Set<string>();
  const supporting = new Set<string>();
  for (const tag of card.retrievalTags) {
    const form = matchForm(tag);
    if (form.length === 0) continue;
    if (BROAD_SIGNALS.has(normalizeSignalText(tag)) || BROAD_SIGNALS.has(form)) {
      supporting.add(form);
    } else {
      strong.add(form);
    }
  }
  for (const curated of CURATED_RETRIEVAL_SIGNALS[card.id] ?? []) {
    const form = matchForm(curated);
    if (form.length > 0) strong.add(form);
  }
  for (const phrase of whenRelevantPhrases(card)) {
    if (!strong.has(phrase)) supporting.add(phrase);
  }
  return { strong: [...strong].sort(), supporting: [...supporting].sort() };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matches(haystack: string, signal: string): boolean {
  const pattern = new RegExp(`(^| )${escapeRegExp(signal)}( |$)`);
  return pattern.test(haystack);
}

export interface GuidancePackInput {
  normalizedEvidenceText: string;
  arcFactSignals?: readonly string[];
}

/** Builds the deterministic, duplicate-free, explainable Guidance Pack. */
export function buildGuidancePack(input: GuidancePackInput): GuidancePack {
  const evidence = ` ${matchForm(input.normalizedEvidenceText)} `;
  const factSignals = (input.arcFactSignals ?? []).map(matchForm).filter((s) => s.length > 0);
  const factText = ` ${factSignals.join(" | ")} `;

  const retrieved = new Map<number, string[]>();
  for (const card of GUIDANCE_CARDS) {
    const signals = cardSignals(card);
    const strongHits = signals.strong.filter(
      (signal) => matches(evidence, signal) || matches(factText, signal),
    );
    if (strongHits.length === 0) continue;
    const supportingHits = signals.supporting.filter(
      (signal) => matches(evidence, signal) || matches(factText, signal),
    );
    retrieved.set(card.id, [...strongHits, ...supportingHits].sort());
  }

  // Dependency expansion runs only from retrieved cards, never from the core
  // pack, so core guidance can never drag specialised cards into every pack.
  const dependencies = new Map<number, number>();
  const queue = [...retrieved.keys()].sort((a, b) => a - b);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const related of getGuidancePolicy(current).relatedGuidanceIds) {
      if (retrieved.has(related) || dependencies.has(related)) continue;
      dependencies.set(related, current);
      queue.push(related);
    }
  }

  const inclusions: GuidanceInclusion[] = [];
  const claimed = new Set<number>();

  for (const id of [...CORE_GUIDANCE_IDS].sort((a, b) => a - b)) {
    claimed.add(id);
    inclusions.push({ cardId: id, reason: "core", matchedSignals: [] });
  }
  for (const id of [...retrieved.keys()].sort((a, b) => a - b)) {
    if (claimed.has(id)) continue;
    claimed.add(id);
    inclusions.push({ cardId: id, reason: "retrieved", matchedSignals: retrieved.get(id)! });
  }
  for (const id of [...dependencies.keys()].sort((a, b) => a - b)) {
    if (claimed.has(id)) continue;
    claimed.add(id);
    inclusions.push({
      cardId: id,
      reason: "dependency",
      matchedSignals: [`depends_on:${dependencies.get(id)}`],
    });
  }

  return {
    registryHash: GUIDANCE_REGISTRY_HASH,
    cards: inclusions.map((inclusion) => getGuidanceCard(inclusion.cardId)),
    inclusions,
  };
}
