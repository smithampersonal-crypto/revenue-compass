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

import {
  allocateSignedAmount,
  type DynamicChange,
} from "@/lib/asc606-variable-consideration";

import { sumCents, type AllocationRow, type Cents } from "@/lib/asc606";

import {
  allocateProgressively,
  type ProvisionalAllocatablePo,
  type SspConfidence,
} from "./allocation";
import {
  buildProgressiveBillingSchedule,
  type FixedBillingFact,
  type PendingBillingRule,
  type ProgressiveBillingSchedule,
} from "./billing";
import {
  buildProgressiveBalances,
  type ProgressiveBalances,
  type ProgressiveCashCollection,
} from "./balances";
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
import {
  mergeCalculationState,
  ProgressiveAccountingError,
  type BlockedComponent,
  type CalculationState,
  type ProvisionalNote,
} from "./types";
import {
  priceUsageActuals,
  usageAsRealizedEvents,
  type UsageActualAmount,
  type UsageActualEvent,
  type UsageRule,
} from "./usage";
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
  /** Cash actually received against a known billing event. */
  cashCollections?: readonly ProgressiveCashCollection[];
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
  assertDeterministicIdentities(input);
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
      ...(po.sspConfidence ? { sspConfidence: po.sspConfidence } : {}),
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

  // ---- Dated changes: allocated on their own effective date ----------------
  // The ACCEPTED Phase 5B allocation rule decides where a dated change goes: a
  // general change is allocated on the original relative-SSP basis, a
  // specific-PO change stays with its obligation. Nothing is re-derived here.
  const allocatables = pos.map((po) => ({
    id: po.id,
    seq: po.seq,
    name: po.name,
    sspCents: po.sspCents,
  }));
  const changesByPo = new Map<string, DynamicChange[]>();
  const changeTotalByPo = new Map<string, Cents>();
  for (const change of vc.datedChanges) {
    const rows = change.targetPoId
      ? [{ poId: change.targetPoId, amountCents: change.changeCents }]
      : allocateSignedAmount(change.changeCents, allocatables);
    for (const row of rows) {
      if (row.amountCents === 0) continue;
      const list = changesByPo.get(row.poId) ?? [];
      list.push({ id: `${change.id}:${row.poId}`, date: change.effectiveDate, amountCents: row.amountCents });
      changesByPo.set(row.poId, list);
      changeTotalByPo.set(
        row.poId,
        sumCents([changeTotalByPo.get(row.poId) ?? 0, row.amountCents]),
      );
    }
  }

  const allocationById = new Map(allocation.value.map((row) => [row.poId, row]));
  const recognitionInputs = pos.map((po) => ({
    po,
    allocatedCents: sumCents([
      allocationById.get(po.id)?.allocatedCents ?? 0,
      specificByPo.get(po.id) ?? 0,
      changeTotalByPo.get(po.id) ?? 0,
    ]),
    ...(changesByPo.has(po.id) ? { datedChanges: changesByPo.get(po.id)! } : {}),
  }));

  const baseRecognition = generateProgressiveRevenueSchedule(recognitionInputs);
  const recognition = applyVariableLayers(baseRecognition, vc);

  // ---- The allocation actually reconciled: base + specific + series --------
  const seriesByPo = new Map<string, Cents>();
  for (const row of vc.seriesPeriod) {
    seriesByPo.set(row.poId, sumCents([seriesByPo.get(row.poId) ?? 0, row.amountCents]));
  }
  // Unresolved variable amounts join their obligation's allocation with their
  // ECONOMIC SIGN: an unrealized service-level credit reduces both the
  // transaction price and the target obligation's allocated consideration.
  for (const allocationEffect of vc.pendingByPo) {
    seriesByPo.set(
      allocationEffect.poId,
      sumCents([seriesByPo.get(allocationEffect.poId) ?? 0, allocationEffect.signedCents]),
    );
  }

  const finalAllocation: AllocationRow[] = allocation.value.map((row) => ({
    ...row,
    allocatedCents: sumCents([
      row.allocatedCents,
      specificByPo.get(row.poId) ?? 0,
      changeTotalByPo.get(row.poId) ?? 0,
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

  // A BLOCKED allocation is consideration whose amount is known but whose
  // recognition cannot be determined. The Phase 3 bridge builds its transaction
  // price from scheduled revenue plus signed PENDING consideration only, so a
  // blocked amount would silently disappear from it. Allocation, recognition
  // and the blocked obligation itself stay visible; every monetary rollforward
  // that mathematically depends on the blocked amount blocks with it.
  //
  // A PENDING future fact is different: it keeps its established
  // unresolved-consideration treatment and still permits partial balances.
  //
  // An ENGINE-LEVEL blocked amount (invalid usage, an unusable variable
  // component, a blocked allocation) is the same situation: the transaction
  // price the bridge would build silently excludes it, so no monetary
  // rollforward may be produced from it.
  //
  // A FIXED billing event's invoice date is an accountant-owned fact. Billed
  // versus unbilled receivable timing depends on it, so it is never
  // manufactured from the unconditional-right date. Without it, no Phase 3
  // balance and no Phase 4 journal may be produced, while allocation and
  // determinable revenue stay available. (A variable amount billed on
  // realization is a separate, genuinely deterministic same-day rule.)
  for (const event of billing.events) {
    if (event.kind !== "fixed" || event.invoiceDate) continue;
    blocked.push({
      poId: "",
      poName: event.description,
      amountCents: 0,
      code: "billing.invoice_date.missing",
      message:
        "A contractual billing event needs the date the invoice was issued before contract balances can be presented.",
    });
  }

  const recognitionBlocked = recognition.blocked.length > 0 || blocked.length > 0;

  const balances = recognitionBlocked
    ? null
    : buildProgressiveBalances({
        billing: billing.events,
        ...(input.cashCollections ? { cashCollections: input.cashCollections } : {}),
        schedule: recognition.schedule,
        pending: recognition.pending,
      });

  const journals = balances
    ? buildProgressiveJournals({
        contractBalanceInput: balances.contractBalanceInput,
        pending: recognition.pending,
        partial: balances.partial,
      })
    : null;

  return {
    state: mergeCalculationState(
      allocation.state,
      recognition.state,
      billing.state,
      balances?.state ?? "blocked",
      // Defense in depth: an engine-level blocked amount can never coexist
      // with a "complete" contract state.
      blocked.length > 0 ? "blocked" : "complete",
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
 * Stage J (orchestration only): no accounting event may be duplicated, and no
 * event may point at an obligation or series period that does not exist. The
 * orchestration fails closed rather than silently dropping any event.
 */
function assertDeterministicIdentities(input: ProgressiveContractInput): void {
  const poIds = new Set<string>();
  for (const po of input.performanceObligations) {
    if (poIds.has(po.id)) {
      throw new ProgressiveAccountingError(`duplicate performance obligation identity "${po.id}"`);
    }
    poIds.add(po.id);
  }

  const seen = (label: string) => {
    const ids = new Set<string>();
    return (id: string) => {
      if (ids.has(id)) {
        throw new ProgressiveAccountingError(`duplicate ${label} identity "${id}"`);
      }
      ids.add(id);
    };
  };

  const progressSeen = seen("progress event");
  for (const po of input.performanceObligations) {
    for (const event of po.progressEvents ?? []) progressSeen(event.id);
  }

  const componentSeen = seen("variable consideration component");
  const vcEventSeen = seen("variable consideration event");
  const seriesSeen = seen("series period");
  for (const component of input.variableComponents ?? []) {
    componentSeen(component.id);
    for (const event of component.realizedEvents ?? []) vcEventSeen(event.id);
    // Series period identities are scoped to their component.
    for (const period of component.seriesPeriods ?? []) {
      seriesSeen(`${component.id}:${period.id}`);
    }
    if (component.targetPoId !== undefined && !poIds.has(component.targetPoId)) {
      throw new ProgressiveAccountingError(
        `variable consideration "${component.id}" targets unknown obligation "${component.targetPoId}"`,
      );
    }
  }

  const usageSeen = seen("usage actual");
  const meterSeen = seen("usage meter");
  for (const usage of input.usage ?? []) {
    if (!poIds.has(usage.rule.targetPoId)) {
      throw new ProgressiveAccountingError(
        `usage rule "${usage.rule.componentId}" targets unknown obligation "${usage.rule.targetPoId}"`,
      );
    }
    for (const meter of usage.rule.meters) meterSeen(`${usage.rule.componentId}:${meter.id}`);
    for (const actual of usage.actuals) usageSeen(actual.id);
  }

  const billingSeen = seen("billing event");
  const billingIds = new Set<string>();
  for (const event of input.fixedBilling ?? []) {
    billingSeen(event.id);
    billingIds.add(event.id);
    // The schedule publishes the event under a derived stable identity.
    billingIds.add(`billing:${event.id}`);
  }
  const cashSeen = seen("cash collection");
  for (const collection of input.cashCollections ?? []) {
    cashSeen(collection.id);
    if (!billingIds.has(collection.billingEventId)) {
      throw new ProgressiveAccountingError(
        `cash collection "${collection.id}" references unknown billing event "${collection.billingEventId}"`,
      );
    }
  }
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
