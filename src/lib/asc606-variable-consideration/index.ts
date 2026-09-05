/**
 * Phase 5B deterministic variable-consideration engine — public surface.
 *
 * Pure TypeScript: no React, DOM, network, database or AI dependency and no
 * mutable global accounting state. A blocking validation failure yields no
 * authoritative allocation, revenue schedule or reconciliation.
 *
 * The engine reuses the approved subsystems rather than reimplementing them:
 * relative-SSP allocation and daily-ratable recognition come from
 * `@/lib/asc606`, and material-right lifecycle units come from
 * `@/lib/asc606-material-rights`.
 */

export * from "./types";
export * from "./estimation";
export * from "./allocation";
export * from "./usage";
export * from "./recognition";
export * from "./validation";

import {
  bigIntToCents,
  monthKeyOf,
  type AllocationRow,
  type Cents,
  type RecognizableUnit,
} from "@/lib/asc606";
import {
  buildAllocatables,
  buildLifecycleUnits,
  type MaterialRightContractInput,
  type MaterialRightOutcome,
  type RevenueSource,
} from "@/lib/asc606-material-rights";
import {
  allocationLayers,
  allocateSignedAmount,
  applyAllocationChanges,
  buildInceptionAllocation,
  type SpecificAllocationInput,
} from "./allocation";
import {
  constraintConclusion,
  orderedAssessments,
  signedAmount,
  unconstrainedMagnitudeCents,
} from "./estimation";
import {
  buildDynamicRevenueSchedule,
  cumulativeEntitlementAtDateCents,
  type DynamicChange,
  type DynamicUnitInput,
  type UsageScheduleRow,
} from "./recognition";
import { usageComponentPeriods, usageSourceId } from "./usage";
import {
  VariableConsiderationError,
  type EstimatedComponentInput,
  type UsagePeriodResult,
  type VariableConsiderationAnalysis,
  type VcAssessmentResult,
  type VcChangeEvent,
  type VcCheckResult,
  type VcComponentResult,
  type VcContractInput,
} from "./types";
import { validateVariableConsideration } from "./validation";

function measureComponent(component: EstimatedComponentInput): VcComponentResult {
  const assessments: VcAssessmentResult[] = [];
  let prior = 0;

  orderedAssessments(component).forEach((assessment, index) => {
    const unconstrainedMagnitude = unconstrainedMagnitudeCents(
      assessment,
      component.estimationMethod,
      component.description || component.id,
    );
    const included = signedAmount(assessment.includedCents, component.effect);
    assessments.push({
      assessmentId: assessment.id,
      seq: assessment.seq,
      effectiveDate: assessment.effectiveDate,
      unconstrainedCents: signedAmount(unconstrainedMagnitude, component.effect),
      includedCents: included,
      constraintConclusion: constraintConclusion(unconstrainedMagnitude, assessment.includedCents),
      constraintRationale: assessment.constraintRationale,
      changeCents: index === 0 ? 0 : included - prior,
      isResolution: false,
    });
    prior = included;
  });

  if (component.resolution) {
    const actual = signedAmount(component.resolution.actualCents, component.effect);
    assessments.push({
      assessmentId: component.resolution.id,
      seq: assessments.length + 1,
      effectiveDate: component.resolution.date,
      unconstrainedCents: actual,
      includedCents: actual,
      constraintConclusion: "fully_included",
      constraintRationale: component.resolution.rationale ?? "",
      changeCents: actual - prior,
      isResolution: true,
    });
    prior = actual;
  }

  return {
    componentId: component.id,
    seq: component.seq,
    description: component.description,
    effect: component.effect,
    estimationMethod: component.estimationMethod,
    allocationTreatment: component.allocationTreatment,
    targetPoId: component.targetPoId ?? null,
    initialIncludedCents: assessments[0]?.includedCents ?? 0,
    currentIncludedCents: prior,
    assessments,
    resolved: Boolean(component.resolution),
  };
}

function blockedAnalysis(
  input: VcContractInput,
  validation: ReturnType<typeof validateVariableConsideration>,
  components: VcComponentResult[],
): VariableConsiderationAnalysis {
  return {
    validation,
    allocation: null,
    revenueSchedule: null,
    revenueSources: [],
    components,
    changeEvents: [],
    usagePeriods: [],
    materialRights: [],
    totals: {
      fixedConsiderationCents: input.fixedConsiderationCents,
      initialTransactionPriceCents: 0,
      currentEstimatedConsiderationCents: 0,
      usageConsiderationCents: 0,
      exerciseConsiderationCents: 0,
      lifecycleConsiderationCents: 0,
      scheduledRevenueCents: null,
      unscheduledConsiderationCents: null,
    },
    reconciliation: {
      scheduledPlusUnscheduledCents: null,
      differenceCents: null,
      reconciled: null,
    },
  };
}

export function analyzeVariableConsideration(
  input: VcContractInput,
): VariableConsiderationAnalysis {
  const validation = validateVariableConsideration(input);
  // Measurement can only run on structurally valid components; a blocked
  // analysis still shows whatever history could be measured.
  const components = input.estimatedComponents.flatMap((component) => {
    try {
      return [measureComponent(component)];
    } catch {
      return [];
    }
  });
  if (validation.blockingFailures.length > 0) {
    return blockedAnalysis(input, validation, components);
  }

  const componentInputById = new Map(input.estimatedComponents.map((c) => [c.id, c]));

  // Invalid allocation states discovered while building the allocation are
  // reported like any other blocking validation item: never thrown, and never
  // accompanied by an authoritative allocation or revenue schedule.
  const extraFailures: VcCheckResult[] = [];
  const allocationFail = (id: string, message: string) => {
    extraFailures.push({
      id,
      category: "allocation",
      severity: "blocking",
      message,
      passed: false,
    });
  };
  const blockedWithExtra = (): VariableConsiderationAnalysis => {
    const results = [...validation.results, ...extraFailures];
    return blockedAnalysis(
      input,
      {
        status: "attention",
        results,
        blockingFailures: results.filter((r) => r.severity === "blocking" && !r.passed),
      },
      components,
    );
  };

  // ---- Inception allocation ------------------------------------------------
  let generalPool = BigInt(input.fixedConsiderationCents);
  const specific: SpecificAllocationInput[] = [];
  for (const component of components) {
    if (component.allocationTreatment === "general") {
      generalPool += BigInt(component.initialIncludedCents);
      continue;
    }
    specific.push({
      componentId: component.componentId,
      description: component.description,
      poId: component.targetPoId!,
      amountCents: component.initialIncludedCents,
    });
  }

  const mrShell: MaterialRightContractInput = {
    transactionPriceCents: 0,
    standardPerformanceObligations: input.standardPerformanceObligations,
    materialRights: input.materialRights,
  };
  const allocatables = buildAllocatables(mrShell);

  if (generalPool < 0n) {
    allocationFail(
      "vc.allocation.general_pool.nonnegative",
      "The consideration allocated on a relative standalone-selling-price basis cannot be negative. Review the variable-consideration amounts and their allocation treatment.",
    );
    return blockedWithExtra();
  }

  const { base, inceptionFinal } = buildInceptionAllocation({
    generalPoolCents: bigIntToCents(generalPool, "general allocation pool"),
    allocatables,
    specific,
  });

  const negativeInception = inceptionFinal.filter((row) => row.amountCents < 0);
  if (negativeInception.length > 0) {
    for (const row of negativeInception) {
      allocationFail(
        "vc.allocation.po.nonnegative",
        `The amount allocated to "${row.name}" at inception is negative. A performance obligation cannot carry a negative allocation; review the variable consideration allocated specifically to it.`,
      );
    }
    return blockedWithExtra();
  }

  let initialTransactionPrice = 0n;
  for (const row of inceptionFinal) initialTransactionPrice += BigInt(row.amountCents);

  // ---- Dated changes -------------------------------------------------------
  interface PendingChange {
    event: Omit<VcChangeEvent, "catchUpCents" | "futureImpactCents">;
  }
  const pending: PendingChange[] = [];
  for (const component of components) {
    const definition = componentInputById.get(component.componentId)!;
    component.assessments.forEach((assessment, index) => {
      if (index === 0) return; // inception is not a change
      const change = assessment.changeCents;
      const allocationByPo =
        definition.allocationTreatment === "general"
          ? allocateSignedAmount(change, allocatables)
          : [{ poId: definition.targetPoId!, amountCents: change }];
      pending.push({
        event: {
          id: `${component.componentId}::${assessment.assessmentId}`,
          componentId: component.componentId,
          assessmentId: assessment.assessmentId,
          effectiveDate: assessment.effectiveDate,
          month: monthKeyOf(assessment.effectiveDate),
          transactionPriceChangeCents: change,
          allocationByPo: allocationByPo.filter((row) => row.amountCents !== 0 || change === 0),
          isResolution: assessment.isResolution,
        },
      });
    });
  }
  pending.sort(
    (a, b) =>
      (a.event.effectiveDate < b.event.effectiveDate
        ? -1
        : a.event.effectiveDate > b.event.effectiveDate
          ? 1
          : 0) || (a.event.id < b.event.id ? -1 : 1),
  );

  // Each successive allocation state, in chronological order, must stay
  // nonnegative — not only the final one.
  let intermediate = inceptionFinal;
  for (const { event } of pending) {
    intermediate = applyAllocationChanges(intermediate, event.allocationByPo);
    for (const row of intermediate) {
      if (row.amountCents < 0) {
        allocationFail(
          "vc.allocation.po.nonnegative",
          `The amount allocated to "${row.name}" becomes negative on ${event.effectiveDate}. A performance obligation cannot carry a negative allocation; review the change in variable consideration allocated specifically to it.`,
        );
      }
    }
    if (extraFailures.length > 0) return blockedWithExtra();
  }

  const allChangeAllocations = pending.flatMap((p) => p.event.allocationByPo);
  const currentFinal = applyAllocationChanges(inceptionFinal, allChangeAllocations);

  let currentEstimated = 0n;
  for (const row of currentFinal) currentEstimated += BigInt(row.amountCents);

  // ---- Material-right lifecycle units (Phase 5A behavior preserved) --------
  const allocationRows: AllocationRow[] = base.map((row) => ({
    ...row,
    allocatedCents: currentFinal.find((f) => f.poId === row.poId)?.amountCents ?? 0,
  }));
  const lifecycleInput: MaterialRightContractInput = {
    transactionPriceCents: bigIntToCents(currentEstimated, "current estimated consideration"),
    standardPerformanceObligations: input.standardPerformanceObligations,
    materialRights: input.materialRights,
  };
  const units = buildLifecycleUnits(lifecycleInput, allocationRows);

  // Map each original performance obligation to the recognition unit that
  // currently carries its allocation (a material right maps to its exercise or
  // expiration source; an outstanding right maps to nothing and stays
  // unscheduled).
  const unitIdByPoId = new Map<string, string>();
  for (const po of input.standardPerformanceObligations) unitIdByPoId.set(po.id, po.id);
  const outcomeByPoId = new Map<string, MaterialRightOutcome>(
    units.outcomes.map((outcome) => [outcome.poId, outcome]),
  );
  for (const outcome of units.outcomes) {
    if (outcome.revenueSourceId) unitIdByPoId.set(outcome.poId, outcome.revenueSourceId);
  }

  const changesByUnit = new Map<string, DynamicChange[]>();
  for (const { event } of pending) {
    for (const row of event.allocationByPo) {
      const unitId = unitIdByPoId.get(row.poId);
      if (!unitId || row.amountCents === 0) continue;
      const list = changesByUnit.get(unitId) ?? [];
      list.push({ id: event.id, date: event.effectiveDate, amountCents: row.amountCents });
      changesByUnit.set(unitId, list);
    }
  }

  const dynamicUnits: DynamicUnitInput[] = units.scheduleInputs.map((scheduleInput) => {
    const unit = scheduleInput.po as RecognizableUnit;
    const changes = changesByUnit.get(unit.id) ?? [];
    let changeTotal = 0n;
    for (const change of changes) changeTotal += BigInt(change.amountCents);
    return {
      unit,
      inceptionAllocatedCents: bigIntToCents(
        BigInt(scheduleInput.allocatedCents) - changeTotal,
        `inception allocation for "${unit.name}"`,
      ),
      changes,
    };
  });

  // ---- Usage ---------------------------------------------------------------
  const usagePeriods: UsagePeriodResult[] = [];
  const usageRows: UsageScheduleRow[] = [];
  const usageSources: RevenueSource[] = [];
  let usageTotal = 0n;
  for (const component of input.usageComponents) {
    const periods = usageComponentPeriods(component);
    usagePeriods.push(...periods);
    for (const period of periods) {
      usageTotal += BigInt(period.totalCents);
      usageRows.push({
        sourceId: period.revenueSourceId,
        month: period.month,
        revenueCents: period.totalCents,
      });
    }
    const target = input.standardPerformanceObligations.find(
      (po) => po.id === component.targetPoId,
    );
    usageSources.push({
      id: usageSourceId(component.id),
      name: component.description || `${target?.name ?? component.targetPoId} — usage`,
      sourceType: "usage",
      originalPoId: component.targetPoId,
      usageComponentId: component.id,
    });
  }

  const revenueSchedule = buildDynamicRevenueSchedule(dynamicUnits, usageRows);

  // ---- Change-event revenue effects ---------------------------------------
  const unitByIdForEvents = new Map(dynamicUnits.map((u) => [u.unit.id, u]));
  // Catch-up is measured at the exact effective date of the change, against the
  // allocation state produced by every strictly earlier change only.
  const runningAllocation = new Map<string, bigint>(
    dynamicUnits.map((u) => [u.unit.id, BigInt(u.inceptionAllocatedCents)]),
  );
  const changeEvents: VcChangeEvent[] = pending.map(({ event }) => {
    let catchUp = 0n;
    let allocatedTotal = 0n;
    for (const row of event.allocationByPo) {
      allocatedTotal += BigInt(row.amountCents);
      const unitId = unitIdByPoId.get(row.poId);
      if (!unitId) continue; // outstanding material right: no revenue date yet
      const dynamic = unitByIdForEvents.get(unitId);
      if (!dynamic) continue;
      const allocationWithout = runningAllocation.get(unitId) ?? 0n;
      const allocationWith = allocationWithout + BigInt(row.amountCents);
      runningAllocation.set(unitId, allocationWith);
      const withCents = cumulativeEntitlementAtDateCents(
        dynamic.unit,
        bigIntToCents(allocationWith, "allocation"),
        event.effectiveDate,
      );
      const withoutCents = cumulativeEntitlementAtDateCents(
        dynamic.unit,
        bigIntToCents(allocationWithout, "allocation"),
        event.effectiveDate,
      );
      catchUp += BigInt(withCents - withoutCents);
    }
    return {
      ...event,
      catchUpCents: bigIntToCents(catchUp, "catch-up revenue"),
      futureImpactCents: bigIntToCents(allocatedTotal - catchUp, "future revenue impact"),
    };
  });

  // ---- Totals and reconciliation ------------------------------------------
  const usageConsiderationCents = bigIntToCents(usageTotal, "usage consideration");
  const currentEstimatedConsiderationCents = bigIntToCents(
    currentEstimated,
    "current estimated consideration",
  );
  const lifecycleConsiderationCents = bigIntToCents(
    currentEstimated + usageTotal + BigInt(units.exerciseConsiderationCents),
    "lifecycle consideration",
  );
  const scheduledPlusUnscheduledCents = bigIntToCents(
    BigInt(revenueSchedule.totalCents) + BigInt(units.unscheduledCents),
    "scheduled plus unscheduled consideration",
  );

  // Defense in depth: no result may be returned unreconciled.
  if (scheduledPlusUnscheduledCents !== lifecycleConsiderationCents) {
    throw new VariableConsiderationError(
      `lifecycle invariant violated: scheduled + unscheduled ${scheduledPlusUnscheduledCents} != lifecycle consideration ${lifecycleConsiderationCents}`,
    );
  }
  if (revenueSchedule.totalCents < 0) {
    throw new VariableConsiderationError("lifecycle invariant violated: negative total revenue");
  }

  const poNames = new Map(allocatables.map((po) => [po.id, po.name]));

  return {
    validation,
    allocation: allocationLayers(base, specific, poNames, inceptionFinal, currentFinal),
    revenueSchedule,
    revenueSources: [...units.revenueSources, ...usageSources],
    components,
    changeEvents,
    usagePeriods,
    materialRights: units.outcomes.map((outcome) => ({
      ...outcome,
      allocatedCents: outcomeByPoId.get(outcome.poId)?.allocatedCents ?? outcome.allocatedCents,
    })),
    totals: {
      fixedConsiderationCents: input.fixedConsiderationCents,
      initialTransactionPriceCents: bigIntToCents(
        initialTransactionPrice,
        "initial transaction price",
      ),
      currentEstimatedConsiderationCents,
      usageConsiderationCents,
      exerciseConsiderationCents: units.exerciseConsiderationCents,
      lifecycleConsiderationCents,
      scheduledRevenueCents: revenueSchedule.totalCents,
      unscheduledConsiderationCents: units.unscheduledCents,
    },
    reconciliation: {
      scheduledPlusUnscheduledCents,
      differenceCents: lifecycleConsiderationCents - scheduledPlusUnscheduledCents,
      reconciled: lifecycleConsiderationCents === scheduledPlusUnscheduledCents,
    },
  };
}
