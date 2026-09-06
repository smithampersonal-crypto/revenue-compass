/**
 * Phase 5C workflow adapter: converts the accountant's modification drafts into
 * the pure contract-modification engine input.
 *
 * Every accountant-entered string is parsed exactly once, here. No judgment is
 * fabricated and no default treatment is assumed — the treatment is derived by
 * the engine from the judgments recorded in the draft.
 */

import type { RecognitionMethod } from "@/lib/asc606";
import type {
  ContractModificationInput,
  ModificationEventInput,
  ModifiedPerformanceObligationInput,
} from "@/lib/asc606-contract-modifications";

import { buildPhase1Input } from "./adapter";
import { parseUsdToCents } from "./money-input";
import type { ModificationDraft, ModifiedPoDraft, WorkflowDraft } from "./types";

export type BuildModificationResult =
  { ok: true; input: ContractModificationInput } | { ok: false; errors: string[] };

function label(po: ModifiedPoDraft): string {
  return po.name || po.id;
}

function buildEvent(mod: ModificationDraft, errors: string[]): ModificationEventInput | null {
  if (!mod.modificationDate) errors.push("Enter the modification effective date.");
  if (mod.approvedAndEnforceable === null) {
    errors.push(
      "State whether the modification has been approved and creates enforceable rights and obligations.",
    );
  }
  // ASC 606-10-25-12(b) is only relevant when the modification adds goods or
  // services; the pure engine owns that relevance rule and the blocking control.
  const addsGoods = mod.modifiedPerformanceObligations.some((po) => po.status === "added");
  if (addsGoods && mod.priceReflectsAddedGoodsSsp === null) {
    errors.push(
      "Answer whether the change in price reflects the standalone selling prices of the added goods or services.",
    );
  }

  const magnitude =
    mod.considerationEffect === "none" && mod.considerationMagnitudeInput.trim() === ""
      ? ({ ok: true, cents: 0 } as const)
      : parseUsdToCents(mod.considerationMagnitudeInput);
  if (!magnitude.ok) errors.push(`Change in consideration: ${magnitude.error}`);

  const performanceObligations: ModifiedPerformanceObligationInput[] = [];
  for (const po of mod.modifiedPerformanceObligations) {
    if (!po.name.trim()) errors.push(`Name the post-modification performance obligation ${po.id}.`);
    if (po.remainingGoodsDistinctFromTransferred === null) {
      errors.push(
        `Answer whether the remaining goods or services of "${label(po)}" are distinct from those already transferred.`,
      );
    }
    if (po.status === "continuing" && po.scopeEffect === null) {
      errors.push(`State how the modification changes the scope of "${label(po)}".`);
    }
    if (po.status === "added" && po.addedGoodsAreDistinct === null) {
      errors.push(`Answer whether the goods or services added by "${label(po)}" are distinct.`);
    }
    if (po.recognitionMethod === null) {
      errors.push(`Select a recognition method for "${label(po)}".`);
    }
    if (po.status === "continuing" && !po.sourcePoId) {
      errors.push(`Select the original performance obligation that "${label(po)}" continues.`);
    }

    // Branch-specific standalone selling prices: whichever the accountant
    // supplied is carried through exactly; a missing one stays null so the
    // engine can block rather than substitute the other measure.
    let remainingCents: number | null = null;
    if (po.remainingSspInput.trim() !== "") {
      const parsed = parseUsdToCents(po.remainingSspInput);
      if (!parsed.ok)
        errors.push(`"${label(po)}" remaining standalone selling price: ${parsed.error}`);
      else remainingCents = parsed.cents;
    }
    let totalCents: number | null = null;
    if (po.totalModifiedSspInput.trim() !== "") {
      const parsed = parseUsdToCents(po.totalModifiedSspInput);
      if (!parsed.ok)
        errors.push(`"${label(po)}" modified standalone selling price: ${parsed.error}`);
      else totalCents = parsed.cents;
    }

    if (po.recognitionMethod === null || po.remainingGoodsDistinctFromTransferred === null) {
      continue;
    }
    performanceObligations.push({
      id: po.id,
      seq: po.seq,
      name: po.name,
      status: po.status,
      sourcePoId: po.status === "continuing" ? po.sourcePoId : null,
      scopeEffect: po.status === "continuing" ? po.scopeEffect : null,
      addedGoodsAreDistinct: po.status === "added" ? po.addedGoodsAreDistinct : null,
      ...(po.addedGoodsDistinctnessRationale
        ? { addedGoodsDistinctnessRationale: po.addedGoodsDistinctnessRationale }
        : {}),
      remainingGoodsDistinctFromTransferred: po.remainingGoodsDistinctFromTransferred,
      ...(po.remainingDistinctnessRationale
        ? { remainingDistinctnessRationale: po.remainingDistinctnessRationale }
        : {}),
      remainingSspCents: remainingCents,
      ...(po.remainingSspBasis ? { remainingSspBasis: po.remainingSspBasis } : {}),
      totalModifiedSspCents: totalCents,
      ...(po.totalModifiedSspBasis ? { totalModifiedSspBasis: po.totalModifiedSspBasis } : {}),
      recognitionMethod: po.recognitionMethod as RecognitionMethod,
      ...(po.serviceStart ? { serviceStart: po.serviceStart } : {}),
      ...(po.serviceEnd ? { serviceEnd: po.serviceEnd } : {}),
      ...(po.recognitionDate ? { recognitionDate: po.recognitionDate } : {}),
      ...(po.recognitionRationale ? { recognitionRationale: po.recognitionRationale } : {}),
    });
  }

  if (errors.length > 0) return null;

  return {
    id: mod.id,
    seq: mod.seq,
    modificationDate: mod.modificationDate,
    approvedAndEnforceable: mod.approvedAndEnforceable,
    ...(mod.approvalRationale ? { approvalRationale: mod.approvalRationale } : {}),
    scopeChangeDescription: mod.scopeChangeDescription,
    considerationEffect: mod.considerationEffect,
    considerationMagnitudeCents: (magnitude as { ok: true; cents: number }).cents,
    priceReflectsAddedGoodsSsp: mod.priceReflectsAddedGoodsSsp,
    ...(mod.priceReflectsSspRationale
      ? { priceReflectsSspRationale: mod.priceReflectsSspRationale }
      : {}),
    mixedAllocationPolicy: mod.mixedAllocationPolicy,
    ...(mod.mixedAllocationPolicyRationale
      ? { mixedAllocationPolicyRationale: mod.mixedAllocationPolicyRationale }
      : {}),
    removedPoIds: [...mod.removedPoIds],
    postModificationPerformanceObligations: performanceObligations,
  };
}

export function buildContractModificationInput(draft: WorkflowDraft): BuildModificationResult {
  const errors: string[] = [];
  const original = buildPhase1Input(draft);
  if (!original.ok) return { ok: false, errors: original.errors };

  const events: ModificationEventInput[] = [];
  for (const mod of draft.contractModifications) {
    const event = buildEvent(mod, errors);
    if (event) events.push(event);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      originalTransactionPriceCents: original.input.transactionPriceCents,
      originalPerformanceObligations: original.input.performanceObligations,
      hasContractModifications: draft.hasContractModifications,
      contractModifications: events,
    },
  };
}
