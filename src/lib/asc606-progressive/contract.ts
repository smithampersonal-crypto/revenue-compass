/**
 * Phase 9G-R3 Part 2 — contract-level progressive orchestration.
 *
 * One deterministic pass produces every downstream output from the same facts:
 *
 *   transaction price -> allocation layers -> recognized + pending + blocked
 *                     -> billing -> balances -> journals -> reconciliation
 *
 * The central invariant holds end to end: a missing future fact limits only
 * the output that depends on it. Hosted-service revenue schedules while a
 * transfer date is unknown, hours are not yet incurred, usage has not occurred
 * and an SLA estimate is zero.
 *
 * Pure TypeScript: no React, DOM, network, database or AI dependency.
 */

import { sumCents, type AllocationRow, type Cents } from "@/lib/asc606";

import { allocateProgressively, type ProvisionalAllocatablePo, type SspConfidence } from "./allocation";
import {
  buildProgressiveBillingSchedule,
  type FixedBillingFact,
  type PendingBillingRule,
  type ProgressiveBillingSchedule,
} from "./billing";
import { buildProgressiveBalances, type ProgressiveBalances } from "./balances";
import {
  assessSignificantFinancing,
  type SignificantFinancingAssessment,
  type SignificantFinancingInput,
} from "./financing";
import { buildProgressiveJournals, type ProgressiveJournals } from "./journals";
import {
  generateProgressiveRevenueSchedule,
  type ProgressiveRecognizableUnit,
  type ProgressiveRevenueResult,
} from "./recognition";
import { reconcileProgressive, type ProgressiveReconciliation } from "./reconciliation";
import { mergeCalculationState, type BlockedComponent, type CalculationState, type ProvisionalNote } from "./types";
import { priceUsageActuals, usageAsRealizedEvents, type UsageActualAmount, type UsageActualEvent, type UsageRule } from "./usage";
import {
  buildVcLayers,
  type ProgressiveVcComponent,
  type ProgressiveVcLayers,
} from "./variable-consideration";
import { applyVariableLayers } from "./variable-recognition";

export interface ProgressiveContractPo extends ProgressiveRecognizableUnit {
  sspCents: Cents;
  sspConfidence?: SspConfidence;
  /** True when the obligation is a series a distinct period can target. */
  isSeries?: boolean;
}

export interface ProgressiveUsageInput {
  rule: UsageRule;
  actuals: readonly UsageActualEvent[];
}

export interface ProgressiveContractInput {
  /** Fixed consideration determined in Step 3, integer cents. */
  fixedConsiderationCents: Cents;
  performanceObligations: readonly ProgressiveContractPo[];
  variableComponents?: readonly ProgressiveVcComponent[];
  usage?: readonly ProgressiveUsageInput[];
  fixedBilling?: readonly FixedBillingFact[];
  financing?: SignificantFinancingInput;
}

export interface ProgressiveContractAnalysis {
  state: CalculationState;
  transactionPriceCents: Cents;
  /** Fixed consideration plus the general variable pool. */
  generalPoolCents: Cents;
  allocation: AllocationRow[] | null;
  provisional: ProvisionalNote[];
  blocked: BlockedComponent[];
  vc: ProgressiveVcLayers;
  usageAmounts: UsageActualAmount[];
  recognition: ProgressiveRevenueResult | null;
  billing: ProgressiveBillingSchedule;
  balances: ProgressiveBalances | null;
  journals: ProgressiveJournals | null;
  reconciliation: ProgressiveReconciliation | null;
  financing: SignificantFinancingAssessment | null;
}

export function analyzeProgressiveContract(
  input: ProgressiveContractInput,
): ProgressiveContractAnalysis {
  const pos = [...input.performanceObligations].sort((a, b) => a.seq - b.seq);
  const poRefs = pos.map((po) => ({
    id: po.id,
    name: po.name,
    isSeries: po.isSeries === true,
  }));
  const financing = input.financing ? assessSignificantFinancing(input.financing) : null;

  // ---- Usage: contractual rule priced against accountant-owned actuals ----
  const usageAmounts: UsageActualAmount[] = [];
  const usageBlocked: BlockedComponent[] = [];
  const realizedByComponent = new Map<string, ReturnType<typeof usageAsRealizedEvents>>();
  for (const usage of input.usage ?? []) {
    try {
      const priced = priceUsageActuals(usage.rule, usage.actuals);
      usageAmounts.push(...priced);
      realizedByComponent.set(usage.rule.componentId, usageAsRealizedEvents(priced));
    } catch (error) {
      usageBlocked.push({
        poId: usage.rule.targetPoId,
        poName: usage.rule.targetPoId,
        amountCents: 0,
        code: "usage.invalid",
        message: (error as Error).message,
      });
    }
  }

  const components: ProgressiveVcComponent[] = (input.variableComponents ?? []).map((component) => {
    const realized = realizedByComponent.get(component.id);
    if (!realized || realized.length === 0) return component;
    return {
      ...component,
      realizedEvents: [...(component.realizedEvents ?? []), ...realized],
    };
  });

  const vc = buildVcLayers(components, poRefs);

  // ---- Transaction price and the general allocation pool -------------------
  const transactionPriceCents = sumCents([
    input.fixedConsiderationCents,
    vc.transactionPriceEffectCents,
  ]);
  const generalPoolCents = sumCents([input.fixedConsiderationCents, vc.generalPoolCents]);

  const allocation = allocateProgressively({
    transactionPriceCents: generalPoolCents,
    performanceObligations: pos.map<ProvisionalAllocatablePo>((po) => ({
      id: po.id,
      seq: po.seq,
      name: po.name,
      sspCents: po.sspCents,
      sspConfidence: po.sspConfidence,
    })),
  });

  const blocked = [...usageBlocked, ...vc.blocked, ...allocation.blocked];

  if (!allocation.value) {
    return {
      state: "blocked",
      transactionPriceCents,
      generalPoolCents,
      allocation: null,
      provisional: allocation.provisional,
      blocked,
      vc,
      usageAmounts,
      recognition: null,
      billing: buildProgressiveBillingSchedule({
        fixed: input.fixedBilling ?? [],
        realized: vc.seriesPeriod.filter((row) => row.billable),
        pendingRules: pendingBillingRules(input, vc),
      }),
      balances: null,
      journals: null,
      reconciliation: null,
      financing,
    };
  }

  // ---- Specific-PO variable amounts join their obligation's allocation -----
  const specificByPo = new Map<string, Cents>();
  for (const row of vc.specificPo) {
    specificByPo.set(row.poId, sumCents([specificByPo.get(row.poId) ?? 0, row.amountCents]));
  }

  const allocationById = new Map(allocation.value.map((row) => [row.poId, row]));
  const recognitionInputs = pos.map((po) => ({
    po,
    allocatedCents: sumCents([
      allocationById.get(po.id)?.allocatedCents ?? 0,
      specificByPo.get(po.id) ?? 0,
    ]),
  }));

  const baseRecognition = generateProgressiveRevenueSchedule(recognitionInputs);
  const recognition = applyVariableLayers(baseRecognition, vc);

  // ---- The allocation actually reconciled: base + specific + series --------
  const seriesByPo = new Map<string, Cents>();
  for (const row of vc.seriesPeriod) {
    seriesByPo.set(row.poId, sumCents([seriesByPo.get(row.poId) ?? 0, row.amountCents]));
  }
  for (const component of vc.pending) {
    seriesByPo.set(
      component.poId,
      sumCents([seriesByPo.get(component.poId) ?? 0, component.amountCents]),
    );
  }

  const finalAllocation: AllocationRow[] = allocation.value.map((row) => ({
    ...row,
    allocatedCents: sumCents([
      row.allocatedCents,
      specificByPo.get(row.poId) ?? 0,
      seriesByPo.get(row.poId) ?? 0,
    ]),
  }));

  const reconciliation = reconcileProgressive({
    transactionPriceCents,
    allocation: finalAllocation,
    recognition,
  });

  const billing = buildProgressiveBillingSchedule({
    fixed: input.fixedBilling ?? [],
    realized: vc.seriesPeriod.filter((row) => row.billable),
    pendingRules: pendingBillingRules(input, vc),
  });

  const balances = buildProgressiveBalances({
    billing: billing.events,
    schedule: recognition.schedule,
    pending: recognition.pending,
  });

  const journals = buildProgressiveJournals({
    billing: billing.events,
    schedule: recognition.schedule,
    poNames: new Map(pos.map((po) => [po.id, po.name])),
    pending: recognition.pending,
  });

  return {
    state: mergeCalculationState(
      allocation.state,
      recognition.state,
      billing.state,
      balances.state,
      financing?.state ?? "complete",
      reconciliation.reconciled ? "complete" : "blocked",
    ),
    transactionPriceCents,
    generalPoolCents,
    allocation: finalAllocation,
    provisional: allocation.provisional,
    blocked,
    vc,
    usageAmounts,
    recognition,
    billing,
    balances,
    journals,
    reconciliation,
    financing,
  };
}

/**
 * A contractual billing rule that exists but has produced no billable amount
 * yet. It is reported so the schedule can say "known rule, no amount" instead
 * of inventing a zero-dollar invoice.
 */
function pendingBillingRules(
  input: ProgressiveContractInput,
  vc: ProgressiveVcLayers,
): PendingBillingRule[] {
  const rules: PendingBillingRule[] = [];
  for (const usage of input.usage ?? []) {
    const hasAmount = vc.seriesPeriod.some(
      (row) => row.componentId === usage.rule.componentId && row.amountCents !== 0,
    );
    if (!hasAmount && usage.rule.billing.billOnRealization) {
      const component = vc.components.find((row) => row.componentId === usage.rule.componentId);
      rules.push({
        componentId: usage.rule.componentId,
        description: component?.description ?? "Usage-based consideration",
        reason: "awaiting_usage_actuals",
      });
    }
  }
  return rules;
}
