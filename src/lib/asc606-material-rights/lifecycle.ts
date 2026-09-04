/**
 * Deterministic material-right lifecycle.
 *
 * The inception allocation is performed once, on the ORIGINAL transaction
 * price, across the standard performance obligations and the material rights.
 * That allocation is locked: exercise or expiration never re-allocates the
 * original consideration, it only determines WHEN the amount already allocated
 * to the material right becomes revenue.
 *
 *  - outstanding: allocated consideration is carried as unscheduled revenue
 *    (no fabricated recognition dates).
 *  - exercised: the allocated amount is carried into the exercise segment and
 *    recognized together with the new consideration, using the accountant's
 *    recognition judgment for the underlying good or service.
 *  - expired: the allocated amount is recognized at the expiration date.
 */

import {
  allocateTransactionPrice,
  bigIntToCents,
  generateRevenueSchedule,
  type AllocatablePerformanceObligation,
  type AllocationRow,
  type Cents,
  type RecognizableUnit,
  type RevenueSchedule,
  type ScheduleInput,
} from "@/lib/asc606";
import { materialRightSspCents } from "./calculation";
import {
  MaterialRightError,
  type MaterialRightContractInput,
  type MaterialRightInput,
  type MaterialRightOutcome,
  type RevenueSource,
} from "./types";

export function exerciseSourceId(materialRightId: string): string {
  return `${materialRightId}::exercise`;
}

export function expirationSourceId(materialRightId: string): string {
  return `${materialRightId}::expiration`;
}

/**
 * Revenue arising when a material right expires unexercised is attributed to
 * the underlying good or service the customer would have obtained, while the
 * revenue-source metadata retains the link back to the material-right PO.
 * Derived deterministically from the accountant's data — never hard-coded.
 */
export function expirationSourceName(
  mr: Pick<MaterialRightInput, "name" | "underlyingGoodOrServiceName">,
): string {
  const underlying = mr.underlyingGoodOrServiceName.trim() || mr.name;
  return `${underlying} — material-right expiration`;
}

export function buildAllocatables(
  input: MaterialRightContractInput,
): AllocatablePerformanceObligation[] {
  const standard = input.standardPerformanceObligations.map((po) => ({
    id: po.id,
    seq: po.seq,
    name: po.name,
    sspCents: po.sspCents,
  }));
  const rights = input.materialRights.map((mr) => ({
    id: mr.id,
    seq: mr.seq,
    name: mr.name,
    sspCents: materialRightSspCents(mr.benefitAmountCents, mr.exerciseProbabilityBps, mr.name),
  }));
  return [...standard, ...rights];
}

interface LifecycleUnits {
  scheduleInputs: ScheduleInput[];
  revenueSources: RevenueSource[];
  outcomes: MaterialRightOutcome[];
  unscheduledCents: Cents;
  exerciseConsiderationCents: Cents;
}

function materialRightUnit(
  mr: MaterialRightInput,
  allocatedCents: Cents,
): { unit: RecognizableUnit; source: RevenueSource; allocated: Cents } | null {
  if (mr.status === "exercised" && mr.exercise) {
    const unit: RecognizableUnit = {
      id: exerciseSourceId(mr.id),
      seq: mr.seq,
      name: mr.underlyingGoodOrServiceName,
      recognitionMethod: mr.exercise.recognitionMethod,
      ...(mr.exercise.serviceStart ? { serviceStart: mr.exercise.serviceStart } : {}),
      ...(mr.exercise.serviceEnd ? { serviceEnd: mr.exercise.serviceEnd } : {}),
      ...(mr.exercise.recognitionDate ? { recognitionDate: mr.exercise.recognitionDate } : {}),
    };
    return {
      unit,
      source: {
        id: unit.id,
        name: mr.underlyingGoodOrServiceName,
        sourceType: "material_right_exercise",
        materialRightPoId: mr.id,
      },
      allocated: allocatedCents + mr.exercise.newConsiderationCents,
    };
  }
  if (mr.status === "expired" && mr.expirationDate) {
    const unit: RecognizableUnit = {
      id: expirationSourceId(mr.id),
      seq: mr.seq,
      name: expirationSourceName(mr),
      recognitionMethod: "point_in_time",
      recognitionDate: mr.expirationDate,
    };
    return {
      unit,
      source: {
        id: unit.id,
        name: unit.name,
        sourceType: "material_right_expiration",
        materialRightPoId: mr.id,
      },
      allocated: allocatedCents,
    };
  }
  return null;
}

export function buildLifecycleUnits(
  input: MaterialRightContractInput,
  allocation: AllocationRow[],
): LifecycleUnits {
  const allocatedById = new Map(allocation.map((row) => [row.poId, row.allocatedCents]));
  const scheduleInputs: ScheduleInput[] = [];
  const revenueSources: RevenueSource[] = [];
  const outcomes: MaterialRightOutcome[] = [];
  let unscheduledBig = 0n;
  let exerciseConsiderationBig = 0n;

  for (const po of input.standardPerformanceObligations) {
    scheduleInputs.push({ po, allocatedCents: allocatedById.get(po.id) ?? 0 });
    revenueSources.push({
      id: po.id,
      name: po.name,
      sourceType: "original_po",
      originalPoId: po.id,
    });
  }

  for (const mr of input.materialRights) {
    const allocatedCents = allocatedById.get(mr.id) ?? 0;
    const built = materialRightUnit(mr, allocatedCents);
    if (built) {
      scheduleInputs.push({ po: built.unit, allocatedCents: built.allocated });
      revenueSources.push(built.source);
    }
    const isExercise = mr.status === "exercised" && mr.exercise;
    if (isExercise) exerciseConsiderationBig += BigInt(mr.exercise!.newConsiderationCents);
    if (!built) unscheduledBig += BigInt(allocatedCents);

    outcomes.push({
      poId: mr.id,
      seq: mr.seq,
      name: mr.name,
      underlyingGoodOrServiceName: mr.underlyingGoodOrServiceName,
      benefitAmountCents: mr.benefitAmountCents,
      exerciseProbabilityBps: mr.exerciseProbabilityBps,
      estimatedSspCents: materialRightSspCents(mr.benefitAmountCents, mr.exerciseProbabilityBps, mr.name),
      allocatedCents,
      status: mr.status,
      unscheduledCents: built ? 0 : allocatedCents,
      exerciseDate: isExercise ? mr.exercise!.exerciseDate : null,
      exerciseConsiderationCents: isExercise ? mr.exercise!.newConsiderationCents : null,
      exerciseRecognitionBasisCents: isExercise
        ? allocatedCents + mr.exercise!.newConsiderationCents
        : null,
      expirationDate: mr.status === "expired" ? (mr.expirationDate ?? null) : null,
      expirationRevenueCents: mr.status === "expired" ? allocatedCents : null,
      revenueSourceId: built ? built.source.id : null,
    });
  }

  return {
    scheduleInputs,
    revenueSources,
    outcomes,
    // Exact aggregation, range-proven before returning to the Cents domain.
    unscheduledCents: bigIntToCents(unscheduledBig, "unscheduled material-right consideration"),
    exerciseConsiderationCents: bigIntToCents(
      exerciseConsiderationBig,
      "aggregate exercise consideration",
    ),
  };
}

export function buildLifecycleSchedule(scheduleInputs: ScheduleInput[]): RevenueSchedule {
  return generateRevenueSchedule(scheduleInputs);
}

export function allocateOriginalConsideration(
  input: MaterialRightContractInput,
): AllocationRow[] {
  return allocateTransactionPrice({
    transactionPriceCents: input.transactionPriceCents,
    performanceObligations: buildAllocatables(input),
  });
}

export { MaterialRightError };
