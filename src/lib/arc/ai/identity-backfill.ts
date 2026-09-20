/**
 * Phase 9G-R3 — legacy sidecar identity backfill.
 *
 * Re-identification needs a recorded identity signature for every incumbent
 * canonical object. Sidecars written before Phase 9G-R3 carry canonical IDs,
 * fingerprints and semantic keys but no signature, so a restored pre-patch
 * analysis would otherwise need one throwaway run to seed identity before it
 * could be re-analyzed safely.
 *
 * ARC does not guess identity from the canonical draft: the ORIGINAL
 * structured model output of the last successful run is persisted immutably
 * (`ai_runs.result_metadata`) and is supplied to the merge at the trusted
 * execution boundary. The signatures below are recomputed from exactly the
 * facts that produced the incumbent objects in the first place, so a
 * backfilled signature is byte-identical to the one the patched merge would
 * have written at the time.
 *
 * Pure: no I/O, no clock, no randomness.
 */

import { mapVcEffect } from "./adapter";
import { BILLING_EVENT_ID_PREFIX, billingTermIdentity } from "./billing-identity";
import {
  identityKindOfCanonicalId,
  poIdentity,
  promiseIdentity,
  vcIdentity,
  type AiIdentityKind,
  type IdentitySignature,
} from "./reconciliation";
import type { AiContractAnalysis } from "./schema";

export interface PriorIdentity {
  kind: AiIdentityKind;
  signature: IdentitySignature;
}

/**
 * True when the sidecar holds at least one canonical object GOVERNED BY R3
 * identity reconciliation that carries no identity signature yet.
 *
 * Scope matters: provenance for billing events, cash receipts and contract
 * modifications never receives a signature, so including them would make ARC
 * fetch the prior structured result on every run forever.
 */
export function identityBackfillRequired(objectProvenance: {
  [semanticKey: string]: { canonicalId: string; identitySignature?: unknown };
}): boolean {
  return Object.values(objectProvenance).some(
    (provenance) =>
      provenance.identitySignature === undefined &&
      (identityKindOfCanonicalId(provenance.canonicalId) !== null ||
        // Phase L: a derived consideration event carries the identity of the
        // billing SCHEDULE that produced it, and a legacy sidecar recorded
        // none. Its projected collection inherits identity from the event and
        // never needs one of its own.
        provenance.canonicalId.startsWith(BILLING_EVENT_ID_PREFIX)),
  );
}

/**
 * Phase L. Every billing-schedule identity derivable from a prior run's
 * structured output, indexed by the billing-term key that run used.
 */
export function priorBillingIdentityIndex(
  analysis: AiContractAnalysis,
): Map<string, IdentitySignature> {
  return new Map(
    analysis.billingTerms.map((term) => [term.semanticKey, billingTermIdentity(term)] as const),
  );
}

/**
 * Every identity signature derivable from a prior run's structured output,
 * indexed by the semantic key that run used.
 *
 * `canonicalIdBySemanticKey` resolves a performance-obligation key to the
 * canonical ID ARC gave it, so variable-consideration targets are compared on
 * canonical identity exactly as they are during a merge.
 */
export function priorIdentityIndex(
  analysis: AiContractAnalysis,
  canonicalIdBySemanticKey: (semanticKey: string) => string | null,
): Map<string, PriorIdentity> {
  const index = new Map<string, PriorIdentity>();

  for (const promise of analysis.promises) {
    index.set(promise.semanticKey, {
      kind: "promise",
      signature: promiseIdentity({
        promiseType: promise.promiseType,
        citations: promise.citations,
        description: promise.description,
      }),
    });
  }

  for (const po of analysis.performanceObligations) {
    index.set(po.semanticKey, {
      kind: "performance_obligation",
      signature: poIdentity({
        satisfactionPattern: po.satisfactionPattern,
        citations: po.citations,
      }),
    });
  }

  for (const component of analysis.transactionPrice.variableConsiderationComponents) {
    index.set(component.semanticKey, {
      kind: "variable_component",
      signature: vcIdentity({
        type: component.type,
        effect: mapVcEffect(component.type) ?? "undetermined",
        targetCanonicalId:
          component.targetPerformanceObligationKey === null
            ? null
            : canonicalIdBySemanticKey(component.targetPerformanceObligationKey),
        citations: component.citations,
        rateInput: component.contractualRateOrAmountInput,
        unitDescription: component.unitDescription,
      }),
    });
  }

  return index;
}
