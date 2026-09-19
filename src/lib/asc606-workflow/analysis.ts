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
  type RevenueSchedule,
  type ValidationOutcome,
  MAX_CENTS,
} from "@/lib/asc606";
import {
  analyzeMaterialRightLifecycle,
  materialRightSspCents,
  type MaterialRightLifecycleAnalysis,
  type MaterialRightStatus,
  type RevenueSource,
} from "@/lib/asc606-material-rights";
import {
  analyzeVariableConsideration,
  previewVcAllocation,
  type VariableConsiderationAnalysis,
  type VcAllocationPreview,
} from "@/lib/asc606-variable-consideration";
import {
  analyzeContractModification,
  type ContractModificationAnalysis,
  type ContractPresentationGroup,
} from "@/lib/asc606-contract-modifications";
import { buildMaterialRightContractInput, buildPhase1Input } from "./adapter";
import { buildContractModificationInput } from "./modification-adapter";
import {
  buildVariableConsiderationAllocationInput,
  buildVariableConsiderationInput,
} from "./vc-adapter";
import { parsePercentToBps, parseUsdToCents } from "./money-input";
import {
  deriveStep1Conclusion,
  draftHasMaterialRights,
  draftHasVariableConsideration,
  type Step1Conclusion,
  type WorkflowDraft,
} from "./types";
import { validateWorkflow, type WorkflowValidationOutcome } from "./validation";
import {
  analyzeProgressiveContract,
  sumSignedPendingCents,
  type BlockedComponent,
  type ProgressiveContractAnalysis,
} from "@/lib/asc606-progressive";
import { buildProgressiveGate, type ProgressiveGate } from "./progressive-gate";
import { buildProgressiveInput, draftRequiresProgressive, type BlockedFact } from "./r3-adapter";

/** An engine-level blocked amount described with its owning obligation. */
function toBlockedFact(component: BlockedComponent): BlockedFact {
  return {
    ownerKind: "performance_obligation",
    ownerId: component.poId,
    ownerName: component.poName,
    code: component.code,
    message: component.message,
  };
}

export interface WorkflowAnalysisResult {
  workflowValidation: WorkflowValidationOutcome;
  step1Conclusion: Step1Conclusion;
  finalized: boolean;
  blockedReason: string | null;
  adapterErrors: string[];
  /**
   * Phase 1 engine validation, exposed for diagnosis whenever the engine ran.
   * Never rewritten or suppressed by this layer.
   */
  engineValidation: ValidationOutcome | null;
  /** Standard Phase 1 engine output; null when blocked or when the contract
   * contains material rights (the lifecycle engine is authoritative then). */
  analysis: Phase1Analysis | null;
  /** Phase 5A lifecycle output; null unless the contract has material rights. */
  lifecycle: MaterialRightLifecycleAnalysis | null;
  /** Authoritative allocation from whichever engine ran. */
  allocation: AllocationRow[] | null;
  /** Authoritative revenue schedule from whichever engine ran. */
  revenueSchedule: RevenueSchedule | null;
  /** Column metadata for the revenue schedule. */
  revenueSources: RevenueSource[];
  /** Allocated consideration with no determinable revenue date yet. */
  unscheduledRevenueCents: Cents;
  /** Original price plus consideration arising on exercised options. */
  lifecycleConsiderationCents: Cents | null;
  /** Phase 5B output; null unless the contract has variable consideration. */
  variableConsideration: VariableConsiderationAnalysis | null;
  /** Phase 5C output; null unless the contract has been modified. */
  modification: ContractModificationAnalysis | null;
  /** Presentation groups; a separate-contract modification produces two. */
  contractGroups: ContractPresentationGroup[];
  /**
   * Phase 9G-R3. The authoritative progressive result when the contract carries
   * progressive facts. Every downstream surface (Step 4 allocation, revenue
   * schedule, billing, contract balances, journal entries, finalization) reads
   * THIS result; nothing recalculates it independently.
   */
  progressive: ProgressiveContractAnalysis | null;
  /** Facts that cannot be used yet, with the owner they belong to. */
  progressiveBlocked: BlockedFact[];
  /**
   * The single workflow-owned determination of what progressive accounting may
   * be presented. Every presenter reads this, so no two surfaces can disagree
   * about whether balances or journals are available.
   */
  progressiveGate: ProgressiveGate | null;
}

export interface AnalyzeWorkflowDeps {
  /** Injection point used by defense-in-depth tests only. */
  analyze?: typeof analyzePhase1;
  analyzeLifecycle?: typeof analyzeMaterialRightLifecycle;
}

export function analyzeWorkflow(
  draft: WorkflowDraft,
  deps: AnalyzeWorkflowDeps = {},
): WorkflowAnalysisResult {
  const analyze = deps.analyze ?? analyzePhase1;
  const workflowValidation = validateWorkflow(draft);
  const step1Conclusion = deriveStep1Conclusion(draft.contract);

  const blocked = (
    reason: string,
    adapterErrors: string[] = [],
    engineValidation: ValidationOutcome | null = null,
  ): WorkflowAnalysisResult => ({
    workflowValidation,
    step1Conclusion,
    finalized: false,
    blockedReason: reason,
    adapterErrors,
    engineValidation,
    analysis: null,
    lifecycle: null,
    allocation: null,
    revenueSchedule: null,
    revenueSources: [],
    unscheduledRevenueCents: 0,
    lifecycleConsiderationCents: null,
    variableConsideration: null,
    modification: null,
    contractGroups: [],
    progressive: null,
    progressiveBlocked: [],
    progressiveGate: null,
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

  // ---- Phase 9G-R3 authoritative progressive path --------------------------
  if (draftRequiresProgressive(draft)) {
    const built = buildProgressiveInput(draft);
    if (!built.ok) {
      return {
        ...blocked(
          built.blocked[0]?.message ??
            "This contract cannot be calculated until the missing facts are supplied.",
        ),
        progressiveBlocked: built.blocked,
        progressiveGate: null,
      };
    }
    let progressive: ProgressiveContractAnalysis;
    try {
      progressive = analyzeProgressiveContract(built.input);
    } catch (error) {
      return {
        ...blocked((error as Error).message),
        progressiveBlocked: built.blocked,
        progressiveGate: null,
      };
    }
    const unresolved = progressive.recognition
      ? sumSignedPendingCents(progressive.recognition.pending)
      : 0;
    const progressiveGate = buildProgressiveGate(progressive, built.blocked);
    return {
      workflowValidation,
      step1Conclusion,
      // A contract awaiting a future operational fact is not finalizable, but
      // its known accounting is fully available. An adapter-level fact that
      // could not be used also keeps the analysis unfinalizable: a fact never
      // disappears merely because the calculation could proceed without it.
      finalized: progressiveGate.state === "complete" && built.blocked.length === 0,
      blockedReason:
        progressiveGate.state === "blocked" || built.blocked.length > 0
          ? (progressiveGate.blockedReason ??
            "Some facts this contract depends on cannot be used yet.")
          : null,
      adapterErrors: [],
      engineValidation: null,
      analysis: null,
      lifecycle: null,
      allocation: progressive.allocation,
      revenueSchedule: progressive.recognition?.schedule ?? null,
      revenueSources: [],
      unscheduledRevenueCents: unresolved,
      lifecycleConsiderationCents: null,
      variableConsideration: null,
      modification: null,
      contractGroups: [],
      progressive,
      progressiveBlocked: [...built.blocked, ...progressive.blocked.map(toBlockedFact)],
      progressiveGate,
    };
  }

  if (draftHasVariableConsideration(draft)) {
    const builtVc = buildVariableConsiderationInput(draft);
    if (!builtVc.ok) {
      return blocked(
        "The workflow could not be converted into a complete engine input.",
        builtVc.errors,
      );
    }
    const vc = analyzeVariableConsideration(builtVc.input);
    if (
      vc.validation.blockingFailures.length > 0 ||
      vc.allocation === null ||
      vc.revenueSchedule === null ||
      vc.reconciliation.reconciled !== true
    ) {
      return blocked(
        "The deterministic ASC 606 engine reported a blocking validation issue, so no finalized analysis is presented.",
        [],
        {
          status: "attention",
          results: [],
          blockingFailures: vc.validation.blockingFailures.map((f) => ({
            id: f.id,
            category: "contract" as const,
            severity: "blocking" as const,
            message: f.message,
            passed: false,
          })),
        },
      );
    }
    return {
      workflowValidation,
      step1Conclusion,
      finalized: true,
      blockedReason: null,
      adapterErrors: [],
      engineValidation: null,
      analysis: null,
      lifecycle: null,
      allocation: vc.allocation.base,
      revenueSchedule: vc.revenueSchedule,
      revenueSources: vc.revenueSources,
      unscheduledRevenueCents: vc.totals.unscheduledConsiderationCents ?? 0,
      lifecycleConsiderationCents: vc.totals.lifecycleConsiderationCents,
      variableConsideration: vc,
      modification: null,
      contractGroups: [],
      progressive: null,
      progressiveBlocked: [],
      progressiveGate: null,
    };
  }

  if (draftHasMaterialRights(draft)) {
    const builtLifecycle = buildMaterialRightContractInput(draft);
    if (!builtLifecycle.ok) {
      return blocked(
        "The workflow could not be converted into a complete engine input.",
        builtLifecycle.errors,
      );
    }
    const lifecycle = (deps.analyzeLifecycle ?? analyzeMaterialRightLifecycle)(
      builtLifecycle.input,
    );
    if (
      lifecycle.validation.blockingFailures.length > 0 ||
      lifecycle.allocation === null ||
      lifecycle.revenueSchedule === null ||
      lifecycle.reconciliation.reconciled !== true
    ) {
      return blocked(
        "The deterministic ASC 606 engine reported a blocking validation issue, so no finalized analysis is presented.",
        [],
        lifecycle.validation,
      );
    }
    return {
      workflowValidation,
      step1Conclusion,
      finalized: true,
      blockedReason: null,
      adapterErrors: [],
      engineValidation: lifecycle.validation,
      analysis: null,
      lifecycle,
      allocation: lifecycle.allocation,
      revenueSchedule: lifecycle.revenueSchedule,
      revenueSources: lifecycle.revenueSources,
      unscheduledRevenueCents: lifecycle.totals.unscheduledMaterialRightCents ?? 0,
      lifecycleConsiderationCents: lifecycle.totals.lifecycleConsiderationCents,
      variableConsideration: null,
      modification: null,
      contractGroups: [],
      progressive: null,
      progressiveBlocked: [],
      progressiveGate: null,
    };
  }

  const built = buildPhase1Input(draft);
  if (!built.ok) {
    return blocked(
      "The workflow could not be converted into a complete engine input.",
      built.errors,
    );
  }

  // Defense in depth: the Phase 1 engine remains authoritative. A blocking
  // engine validation item can never produce a finalized workflow result.
  const analysis = analyze(built.input);
  if (
    analysis.validation.blockingFailures.length > 0 ||
    analysis.allocation === null ||
    analysis.revenueSchedule === null
  ) {
    return blocked(
      "The deterministic ASC 606 engine reported a blocking validation issue, so no finalized analysis is presented.",
      [],
      analysis.validation,
    );
  }

  if (draft.hasContractModifications) {
    const builtMod = buildContractModificationInput(draft);
    if (!builtMod.ok) {
      return blocked(
        "The contract modification could not be converted into a complete engine input.",
        builtMod.errors,
      );
    }
    const modification = analyzeContractModification(builtMod.input);
    if (
      modification.validation.blockingFailures.length > 0 ||
      modification.revenueSchedule === null ||
      modification.allocationLayers === null ||
      modification.reconciliation.reconciled !== true
    ) {
      return blocked(
        "The deterministic contract-modification engine reported a blocking validation issue, so no finalized analysis is presented.",
        [],
        modification.validation,
      );
    }
    return {
      workflowValidation,
      step1Conclusion,
      finalized: true,
      blockedReason: null,
      adapterErrors: [],
      engineValidation: modification.validation,
      analysis,
      lifecycle: null,
      // Remediation item 10: the generic Results allocation is ALWAYS the
      // original inception allocation. Modification allocation layers are
      // presented only in the dedicated Contract Modification output, so a
      // $90,000 modification row can never appear inside a $240,000 original
      // allocation table.
      allocation: analysis.allocation,
      revenueSchedule: modification.revenueSchedule,
      revenueSources: modification.revenueSources,
      unscheduledRevenueCents: 0,
      lifecycleConsiderationCents: modification.totals.lifecycleConsiderationCents,
      variableConsideration: null,
      modification,
      contractGroups: modification.groups,
      progressive: null,
      progressiveBlocked: [],
      progressiveGate: null,
    };
  }

  return {
    workflowValidation,
    step1Conclusion,
    finalized: true,
    blockedReason: null,
    adapterErrors: [],
    engineValidation: analysis.validation,
    analysis,
    lifecycle: null,
    allocation: analysis.allocation,
    revenueSchedule: analysis.revenueSchedule,
    revenueSources: built.input.performanceObligations.map((po) => ({
      id: po.id,
      name: po.name,
      sourceType: "original_po" as const,
      originalPoId: po.id,
    })),
    unscheduledRevenueCents: 0,
    lifecycleConsiderationCents: analysis.totals.transactionPriceCents,
    variableConsideration: null,
    modification: null,
    contractGroups: [],
    progressive: null,
    progressiveBlocked: [],
    progressiveGate: null,
  };
}

export interface AllocationPreview {
  rows: AllocationRow[] | null;
  totalSspCents: Cents | null;
  totalAllocatedCents: Cents | null;
  /** Phase 5B layered inception allocation; null for a fixed-only contract. */
  variable: VcAllocationPreview | null;
  issues: string[];
}

/**
 * Step 4 preview. Calls the engine's allocation function directly so no Step 5
 * data has to be fabricated, and so React never performs allocation math.
 */
export function previewAllocation(draft: WorkflowDraft): AllocationPreview {
  const issues: string[] = [];
  let variable: VcAllocationPreview | null = null;
  const empty = (): AllocationPreview => ({
    rows: null,
    totalSspCents: null,
    totalAllocatedCents: null,
    variable,
    issues,
  });

  const step1Conclusion = deriveStep1Conclusion(draft.contract);
  if (step1Conclusion === "not_qualified") {
    issues.push(
      "Allocation is not calculated because the contract has not qualified for ASC 606 accounting under Step 1.",
    );
    return empty();
  }
  if (step1Conclusion === "incomplete") {
    issues.push(
      "Allocation is not calculated because the Step 1 contract criteria have not all been answered.",
    );
    return empty();
  }

  // A contract with variable consideration is allocated by the Phase 5B
  // engine through its allocation-only path: Step 4 never depends on Step 5
  // recognition information, and this layer never re-derives the allocation.
  // Phase 9G-R3: one authority. A progressive contract's Step 4 allocation IS
  // the allocation the rest of the workpaper uses; the legacy preview below is
  // never consulted for it, so a treatment the progressive engine supports can
  // never be rejected here.
  if (draftRequiresProgressive(draft)) {
    const workflow = analyzeWorkflow(draft);
    const rows = workflow.allocation;
    if (rows === null) {
      if (workflow.blockedReason) issues.push(workflow.blockedReason);
      for (const fact of workflow.progressiveBlocked) issues.push(fact.message);
      if (issues.length === 0) issues.push("Allocation is not yet calculable.");
      return empty();
    }
    let total = 0n;
    for (const row of rows) total += BigInt(row.allocatedCents);
    return {
      rows,
      totalSspCents: rows[0]?.totalSspCents ?? null,
      totalAllocatedCents: Number(total),
      variable: null,
      issues,
    };
  }

  if (draft.hasVariableConsideration) {
    const built = buildVariableConsiderationAllocationInput(draft);
    if (!built.ok) {
      issues.push(...built.errors);
      return empty();
    }
    variable = previewVcAllocation(built.input);
    if (variable.base === null) {
      issues.push(...variable.issues.map((issue) => issue.message));
      return empty();
    }
    let total = 0n;
    for (const row of variable.base) total += BigInt(row.allocatedCents);
    return {
      rows: variable.base,
      totalSspCents: variable.base[0]?.totalSspCents ?? null,
      totalAllocatedCents: Number(total),
      variable,
      issues,
    };
  }

  const price = parseUsdToCents(draft.transactionPriceInput);
  if (!price.ok) issues.push(`Transaction price: ${price.error}`);
  if (draft.performanceObligations.length === 0) {
    issues.push("Create at least one performance obligation.");
  }

  const pos = draft.performanceObligations.map((po) => {
    const label = po.name || po.id;
    if (po.kind === "material_right") {
      // The estimated SSP of a material right is benefit x probability,
      // calculated by the material-right engine — never by this layer.
      const benefit = parseUsdToCents(po.benefitAmountInput);
      const probability = parsePercentToBps(po.exerciseProbabilityInput);
      if (!benefit.ok || benefit.cents <= 0 || !probability.ok) {
        issues.push(`The estimated standalone selling price for "${label}" is not yet measurable.`);
      }
      return {
        id: po.id,
        seq: po.seq,
        name: label,
        sspCents:
          benefit.ok && probability.ok ? materialRightSspCents(benefit.cents, probability.bps) : 0,
      };
    }
    const ssp = parseUsdToCents(po.sspInput);
    if (!ssp.ok || ssp.cents <= 0) {
      issues.push(`Standalone selling price for "${label}" is missing or invalid.`);
    }
    return {
      id: po.id,
      seq: po.seq,
      name: label,
      sspCents: ssp.ok ? ssp.cents : 0,
    };
  });

  const sspRangeIssue = validateWorkflow(draft).blocking.find(
    (i) => i.id === "allocation.total_ssp.supported_range",
  );
  if (sspRangeIssue) issues.push(sspRangeIssue.message);

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
      variable: null,
      issues,
    };
  } catch (error) {
    issues.push((error as Error).message);
    return empty();
  }
}

// ---------------------------------------------------------------------------
// Phase 5A read-only Step 5 presentation values.
//
// Pure workflow layer, not React: the amounts come from the engine allocation
// and are aggregated exactly, so the UI only formats them.
// ---------------------------------------------------------------------------

export interface MaterialRightStepPreview {
  poId: string;
  name: string;
  status: MaterialRightStatus;
  /** Original inception allocation carried by the material right. */
  allocatedCents: Cents | null;
  /** New consideration arising on exercise. */
  exerciseConsiderationCents: Cents | null;
  /** Carried allocation + new consideration. */
  recognitionBasisCents: Cents | null;
  /** Amount recognized on expiration. */
  expirationRevenueCents: Cents | null;
  /** Allocated consideration with no determinable revenue date yet. */
  unscheduledCents: Cents | null;
}

export function materialRightStepPreviews(draft: WorkflowDraft): MaterialRightStepPreview[] {
  const rights = draft.performanceObligations.filter((po) => po.kind === "material_right");
  if (rights.length === 0) return [];
  const preview = previewAllocation(draft);
  const allocatedById = new Map((preview.rows ?? []).map((row) => [row.poId, row.allocatedCents]));

  return rights.map((po) => {
    const allocated = allocatedById.get(po.id) ?? null;
    const consideration = parseUsdToCents(po.exerciseConsiderationInput);
    const considerationCents =
      po.materialRightStatus === "exercised" && consideration.ok ? consideration.cents : null;
    let basis: Cents | null = null;
    if (allocated !== null && considerationCents !== null) {
      const sum = BigInt(allocated) + BigInt(considerationCents);
      basis = sum > BigInt(MAX_CENTS) ? null : Number(sum);
    }
    return {
      poId: po.id,
      name: po.name || po.id,
      status: po.materialRightStatus,
      allocatedCents: allocated,
      exerciseConsiderationCents: considerationCents,
      recognitionBasisCents: basis,
      expirationRevenueCents: po.materialRightStatus === "expired" ? allocated : null,
      unscheduledCents: po.materialRightStatus === "outstanding" ? allocated : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Phase 5B read-only Step 5 presentation values.
//
// Pure workflow layer: every amount comes from the variable-consideration
// engine, so React only formats what it is given.
// ---------------------------------------------------------------------------

export interface VariableConsiderationPreview {
  analysis: VariableConsiderationAnalysis | null;
  errors: string[];
}

export function variableConsiderationPreview(draft: WorkflowDraft): VariableConsiderationPreview {
  if (!draftHasVariableConsideration(draft)) return { analysis: null, errors: [] };
  const built = buildVariableConsiderationInput(draft);
  if (!built.ok) return { analysis: null, errors: built.errors };
  try {
    return { analysis: analyzeVariableConsideration(built.input), errors: [] };
  } catch (error) {
    return { analysis: null, errors: [(error as Error).message] };
  }
}
