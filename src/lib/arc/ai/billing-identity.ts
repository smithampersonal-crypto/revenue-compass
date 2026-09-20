/**
 * Phase 9G-R3 / Phase L — billing-schedule lineage identity.
 *
 * A model billing-term `semanticKey` is an ephemeral model alias exactly like
 * a promise key: two independent runs of the same contract routinely rename
 * it. Consideration events and their projected collections are DERIVED from
 * that key (`${termKey}#${period}` and `${eventKey}#collection`), so a rename
 * silently mints a whole duplicate billing schedule.
 *
 * ARC therefore reconciles the billing SCHEDULE first, using objective
 * structured facts from the billing term, and then derives event identity
 * deterministically from the reconciled lineage and the schedule period. A
 * projected collection is strictly subordinate to its canonical event and
 * never matched on its own.
 *
 * Pure: no clock, no randomness, no I/O.
 */

import {
  evidenceSignature,
  textSignature,
  type IdentityCandidate,
  type IdentitySignature,
} from "./reconciliation";
import type { AiContractAnalysis } from "./schema";

export type AiBillingTerm = AiContractAnalysis["billingTerms"][number];

/** Canonical ID prefixes of the two derived billing objects. */
export const BILLING_EVENT_ID_PREFIX = "ce-";
export const BILLING_COLLECTION_ID_PREFIX = "cc-";

/** The derived semantic key of one scheduled invoice. */
export function billingEventSemanticKey(termKey: string, period: number): string {
  return `${termKey}#${period}`;
}

/** The derived semantic key of the projected collection of one invoice. */
export function billingCollectionSemanticKey(eventSemanticKey: string): string {
  return `${eventSemanticKey}#collection`;
}

/**
 * Splits a derived key back into its billing-term lineage key and schedule
 * period. Returns null for anything that is not a derived billing key.
 */
export function parseBillingEventSemanticKey(
  semanticKey: string,
): { termKey: string; period: number } | null {
  const match = /^(.+)#(\d+)$/.exec(semanticKey);
  if (match === null) return null;
  const period = Number(match[2]);
  if (!Number.isInteger(period) || period < 1) return null;
  return { termKey: match[1]!, period };
}

/**
 * Billing-schedule identity.
 *
 * The gate is the broad schedule shape (timing + frequency): necessary, never
 * sufficient — two different quarterly-advance schedules share it. Source
 * evidence identifies the schedule; the contractual invoice trigger and
 * payment-term structure corroborate it when evidence is unavailable; the
 * model's prose description is the weakest fallback.
 *
 * The AMOUNT is deliberately absent: a fee may legitimately be re-estimated
 * while the economic billing schedule stays the same schedule.
 */
export function billingTermIdentity(term: {
  billingTiming: string;
  frequency: string;
  invoiceTrigger: string;
  dueDateRule: string | null;
  paymentTermsDays: number | null;
  description: string;
  citations: AiBillingTerm["citations"];
}): IdentitySignature {
  const terms = textSignature(
    [term.invoiceTrigger, term.dueDateRule ?? "", term.paymentTermsDays ?? ""].join("|"),
  );
  return {
    gate: `billing|${term.billingTiming}|${term.frequency}`,
    corroborators: [evidenceSignature(term.citations), terms, textSignature(term.description)],
  };
}

export interface BillingLineageMember {
  semanticKey: string;
  canonicalId: string;
}

export interface BillingLineage {
  /** The model alias that currently owns this schedule in the sidecar. */
  termKey: string;
  /** Recorded schedule identity; absent on a pre-patch (legacy) sidecar. */
  signature?: IdentitySignature;
  events: Map<number, BillingLineageMember>;
  collections: Map<number, BillingLineageMember>;
}

interface ProvenanceLike {
  canonicalId: string;
  identitySignature?: IdentitySignature;
}

/**
 * The incumbent AI-derived billing schedules, grouped by their lineage key.
 * Manual accountant billing rows never appear here: they carry no AI
 * provenance at all.
 */
export function billingLineages(
  objectProvenance: Readonly<Record<string, ProvenanceLike>>,
): Map<string, BillingLineage> {
  const lineages = new Map<string, BillingLineage>();
  const lineageOf = (termKey: string): BillingLineage => {
    const existing = lineages.get(termKey);
    if (existing !== undefined) return existing;
    const created: BillingLineage = { termKey, events: new Map(), collections: new Map() };
    lineages.set(termKey, created);
    return created;
  };

  for (const [semanticKey, provenance] of Object.entries(objectProvenance)) {
    if (provenance.canonicalId.startsWith(BILLING_EVENT_ID_PREFIX)) {
      const parsed = parseBillingEventSemanticKey(semanticKey);
      if (parsed === null) continue;
      const lineage = lineageOf(parsed.termKey);
      lineage.events.set(parsed.period, { semanticKey, canonicalId: provenance.canonicalId });
      if (lineage.signature === undefined && provenance.identitySignature !== undefined) {
        lineage.signature = provenance.identitySignature;
      }
      continue;
    }
    if (provenance.canonicalId.startsWith(BILLING_COLLECTION_ID_PREFIX)) {
      if (!semanticKey.endsWith("#collection")) continue;
      const parsed = parseBillingEventSemanticKey(semanticKey.slice(0, -"#collection".length));
      if (parsed === null) continue;
      lineageOf(parsed.termKey).collections.set(parsed.period, {
        semanticKey,
        canonicalId: provenance.canonicalId,
      });
    }
  }

  return lineages;
}

/**
 * The incumbent schedules a proposal may be reconciled against: identified,
 * and not already owned by an unchanged key in this very analysis.
 */
export function billingIdentityCandidates(
  lineages: ReadonlyMap<string, BillingLineage>,
  incomingTermKeys: ReadonlySet<string>,
): IdentityCandidate[] {
  const candidates: IdentityCandidate[] = [];
  for (const lineage of lineages.values()) {
    if (incomingTermKeys.has(lineage.termKey)) continue;
    if (lineage.signature === undefined) continue;
    candidates.push({
      semanticKey: lineage.termKey,
      canonicalId: lineage.termKey,
      signature: lineage.signature,
    });
  }
  return candidates.sort((left, right) => left.semanticKey.localeCompare(right.semanticKey));
}
