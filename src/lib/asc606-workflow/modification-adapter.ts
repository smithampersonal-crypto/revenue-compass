/**
 * Phase 5C workflow adapter: converts the accountant's modification draft into
 * the pure contract-modification engine input.
 *
 * Every accountant-entered string is parsed exactly once, here. No judgment is
 * fabricated and no default treatment is assumed — the treatment is derived by
 * the engine from the judgments recorded in the draft.
 */

import type { RecognitionMethod } from "@/lib/asc606";
import type {
  ContractModificationInput,
  ModifiedPerformanceObligationInput,
} from "@/lib/asc606-contract-modifications";

import { buildPhase1Input } from "./adapter";
import { parseUsdToCents } from "./money-input";
import type { ModifiedPoDraft, WorkflowDraft } from "./types";

export type BuildModificationResult =
  { ok: true; input: ContractModificationInput } | { ok: false; errors: string[] };

function label(po: ModifiedPoDraft): string {
  return po.name || po.id;
}

export function buildContractModificationInput(draft: WorkflowDraft): BuildModificationResult {
  const errors: string[] = [];
  const original = buildPhase1Input(draft);
  if (!original.ok) return { ok: false, errors: original.errors };

  const mod = draft.modification;
  if (!mod.effectiveDate) errors.push("Enter the modification effective date.");
  if (mod.addsDistinctGoodsOrServices === null) {
    errors.push("Answer whether the modification adds distinct goods or services.");
  }
  if (mod.priceReflectsStandaloneSellingPrices === null) {
    errors.push(
      "Answer whether the change in price reflects the standalone selling prices of the added goods or services.",
    );
  }

  const change = parseUsdToCents(mod.considerationChangeInput);
  if (!change.ok) errors.push(`Change in consideration: ${change.error}`);

  const performanceObligations: ModifiedPerformanceObligationInput[] = [];
  for (const po of mod.modifiedPerformanceObligations) {
    if (!po.name.trim()) errors.push(`Name the post-modification performance obligation ${po.id}.`);
    if (po.remainingGoodsDistinct === null) {
      errors.push(
        `Answer whether the remaining goods or services of "${label(po)}" are distinct from those already transferred.`,
      );
    }
    if (po.recognitionMethod === null) {
      errors.push(`Select a recognition method for "${label(po)}".`);
    }
    const remaining = parseUsdToCents(po.remainingSspInput);
    if (!remaining.ok)
      errors.push(`"${label(po)}" remaining standalone selling price: ${remaining.error}`);
    const total = parseUsdToCents(po.totalModifiedSspInput);
    if (!total.ok) errors.push(`"${label(po)}" modified standalone selling price: ${total.error}`);
    if (po.status === "continuing" && !po.sourcePoId) {
      errors.push(`Select the original performance obligation that "${label(po)}" continues.`);
    }
    if (
      !remaining.ok ||
      !total.ok ||
      po.recognitionMethod === null ||
      po.remainingGoodsDistinct === null
    ) {
      continue;
    }
    performanceObligations.push({
      id: po.id,
      seq: po.seq,
      name: po.name,
      status: po.status,
      sourcePoId: po.status === "continuing" ? po.sourcePoId : null,
      remainingGoodsDistinct: po.remainingGoodsDistinct,
      ...(po.distinctRationale ? { distinctRationale: po.distinctRationale } : {}),
      remainingSspCents: remaining.cents,
      totalModifiedSspCents: total.cents,
      ...(po.sspBasis ? { sspBasis: po.sspBasis } : {}),
      recognitionMethod: po.recognitionMethod as RecognitionMethod,
      ...(po.serviceStart ? { serviceStart: po.serviceStart } : {}),
      ...(po.serviceEnd ? { serviceEnd: po.serviceEnd } : {}),
      ...(po.recognitionDate ? { recognitionDate: po.recognitionDate } : {}),
      ...(po.recognitionRationale ? { recognitionRationale: po.recognitionRationale } : {}),
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      originalTransactionPriceCents: original.input.transactionPriceCents,
      originalPerformanceObligations: original.input.performanceObligations,
      modification: {
        id: mod.id,
        effectiveDate: mod.effectiveDate,
        description: mod.description,
        considerationChangeCents:
          mod.considerationChangeDirection === "decrease"
            ? -(change as { ok: true; cents: number }).cents
            : (change as { ok: true; cents: number }).cents,
        addsDistinctGoodsOrServices: mod.addsDistinctGoodsOrServices === true,
        priceReflectsStandaloneSellingPrices: mod.priceReflectsStandaloneSellingPrices === true,
        ...(mod.separateContractRationale
          ? { separateContractRationale: mod.separateContractRationale }
          : {}),
        ...(mod.mixedAllocationPolicy ? { mixedAllocationPolicy: mod.mixedAllocationPolicy } : {}),
        removedPoIds: [...mod.removedPoIds],
        modifiedPerformanceObligations: performanceObligations,
      },
    },
  };
}
