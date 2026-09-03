/**
 * Phase 2 orchestration: workflow validation → finalization gate → engine.
 *
 * A blocked workflow never produces authoritative accounting outputs, and a
 * Step 1 conclusion other than "qualified" always blocks finalization even
 * when the engine inputs would otherwise be valid.
 */

import {
  allocateTransactionPrice,
  analyzePhase1,
  type AllocationRow,
  type Cents,
  type Phase1Analysis,
} from "@/lib/asc606";
import { buildPhase1Input } from "./adapter";
import { parseUsdToCents } from "./money-input";
import { deriveStep1Conclusion, type Step1Conclusion, type WorkflowDraft } from "./types";
import { validateWorkflow, type WorkflowValidationOutcome } from "./validation";

export interface WorkflowAnalysisResult {
  workflowValidation: WorkflowValidationOutcome;
  step1Conclusion: Step1Conclusion;
  finalized: boolean;
  blockedReason: string | null;
  adapterErrors: string[];
  /** Engine output; null whenever the workflow is blocked. */
  analysis: Phase1Analysis | null;
}

export function analyzeWorkflow(draft: WorkflowDraft): WorkflowAnalysisResult {
  const workflowValidation = validateWorkflow(draft);
  const step1Conclusion = deriveStep1Conclusion(draft.contract);

  const blocked = (reason: string, adapterErrors: string[] = []): WorkflowAnalysisResult => ({
    workflowValidation,
    step1Conclusion,
    finalized: false,
    blockedReason: reason,
    adapterErrors,
    analysis: null,
  });

  if (step1Conclusion === "not_qualified") {
    return blocked(
      "The arrangement does not qualify as a contract under ASC 606-10-25-1, so no finalized allocation, revenue schedule or reconciliation is presented.",
    );
  }
  if (step1Conclusion === "incomplete") {
    return blocked("The Step 1 contract criteria have not all been answered.");
  }
  if (workflowValidation.blocking.length > 0) {
    return blocked("The workflow has unresolved blocking items.");
  }

  const built = buildPhase1Input(draft);
  if (!built.ok) {
    return blocked("The workflow could not be converted into a complete engine input.", built.errors);
  }

  return {
    workflowValidation,
    step1Conclusion,
    finalized: true,
    blockedReason: null,
    adapterErrors: [],
    analysis: analyzePhase1(built.input),
  };
}

export interface AllocationPreview {
  rows: AllocationRow[] | null;
  totalSspCents: Cents | null;
  totalAllocatedCents: Cents | null;
  issues: string[];
}

/**
 * Step 4 preview. Calls the engine's allocation function directly so no Step 5
 * data has to be fabricated, and so React never performs allocation math.
 */
export function previewAllocation(draft: WorkflowDraft): AllocationPreview {
  const issues: string[] = [];
  const empty = (): AllocationPreview => ({
    rows: null,
    totalSspCents: null,
    totalAllocatedCents: null,
    issues,
  });

  const price = parseUsdToCents(draft.transactionPriceInput);
  if (!price.ok) issues.push(`Transaction price: ${price.error}`);
  if (draft.performanceObligations.length === 0) {
    issues.push("Create at least one performance obligation.");
  }

  const pos = draft.performanceObligations.map((po) => {
    const ssp = parseUsdToCents(po.sspInput);
    if (!ssp.ok || ssp.cents <= 0) {
      issues.push(`Standalone selling price for "${po.name || po.id}" is missing or invalid.`);
    }
    return {
      id: po.id,
      seq: po.seq,
      name: po.name || po.id,
      sspCents: ssp.ok ? ssp.cents : 0,
      // Placeholder only for the allocation call signature; allocation never
      // reads recognition data.
      recognitionMethod: "point_in_time" as const,
    };
  });

  if (issues.length > 0 || !price.ok) return empty();

  try {
    const rows = allocateTransactionPrice({
      transactionPriceCents: price.cents,
      performanceObligations: pos,
    });
    return {
      rows,
      totalSspCents: rows[0]?.totalSspCents ?? null,
      totalAllocatedCents: price.cents,
      issues,
    };
  } catch (error) {
    issues.push((error as Error).message);
    return empty();
  }
}
