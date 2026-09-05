/**
 * Central Phase 5B validation.
 *
 * Every accounting rule that can block an authoritative output lives here, not
 * in React. Invalid accountant input is reported, never silently repaired.
 * All monetary aggregation is exact BigInt arithmetic.
 */

import {
  datePeriodExceedsSupportedHorizon,
  enumerateMonths,
  isValidIsoDate,
  monthKeyOf,
  MAX_CENTS,
  type Cents,
  type PerformanceObligationInput,
} from "@/lib/asc606";
import { BPS_SCALE } from "@/lib/asc606-material-rights";
import {
  constraintConclusion,
  orderedAssessments,
  signedAmount,
  totalProbabilityBps,
  unconstrainedMagnitudeCents,
} from "./estimation";
import type {
  EstimatedComponentInput,
  UsageComponentInput,
  VcCheckResult,
  VcContractInput,
  VcValidationOutcome,
} from "./types";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function validMagnitude(value: unknown): value is Cents {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_CENTS;
}

export function validateVariableConsideration(input: VcContractInput): VcValidationOutcome {
  const results: VcCheckResult[] = [];
  const fail = (
    id: string,
    category: VcCheckResult["category"],
    message: string,
    severity: VcCheckResult["severity"] = "blocking",
  ) => results.push({ id, category, severity, message, passed: false });

  const poById = new Map<string, PerformanceObligationInput>(
    input.standardPerformanceObligations.map((po) => [po.id, po]),
  );
  const allPoIds = new Set<string>([
    ...poById.keys(),
    ...input.materialRights.map((mr) => mr.id),
  ]);

  if (!validMagnitude(input.fixedConsiderationCents)) {
    fail(
      "vc.fixed_consideration.valid",
      "component",
      "Fixed consideration must be a supported nonnegative whole-cent amount.",
    );
  }

  // ---- Estimated components ----------------------------------------------
  const componentIds = input.estimatedComponents.map((c) => c.id);
  if (new Set(componentIds).size !== componentIds.length) {
    fail("vc.component.id.unique", "component", "Variable-consideration component identifiers must be unique.");
  }

  for (const component of input.estimatedComponents) {
    validateEstimatedComponent(component, allPoIds, fail);
  }

  // ---- Usage components ---------------------------------------------------
  const usageIds = input.usageComponents.map((c) => c.id);
  if (new Set(usageIds).size !== usageIds.length) {
    fail("vc.usage.id.unique", "usage", "Usage component identifiers must be unique.");
  }
  for (const component of input.usageComponents) {
    validateUsageComponent(component, poById, fail);
  }

  // ---- Aggregate monetary range ------------------------------------------
  let lifecycle = 0n;
  if (validMagnitude(input.fixedConsiderationCents)) lifecycle += BigInt(input.fixedConsiderationCents);
  for (const component of input.estimatedComponents) {
    const assessments = orderedAssessments(component);
    const last = assessments[assessments.length - 1];
    if (last && validMagnitude(last.includedCents)) {
      lifecycle += BigInt(signedAmount(last.includedCents, component.effect));
    }
  }
  if (lifecycle > BigInt(MAX_CENTS) || lifecycle < -BigInt(MAX_CENTS)) {
    fail(
      "vc.lifecycle.supported_range",
      "lifecycle",
      "The consideration in this contract exceeds the supported monetary range.",
    );
  }
  if (lifecycle < 0n) {
    fail(
      "vc.lifecycle.nonnegative",
      "lifecycle",
      "Total consideration after variable consideration cannot be negative.",
    );
  }

  const blockingFailures = results.filter((r) => r.severity === "blocking" && !r.passed);
  return {
    status: blockingFailures.length > 0 ? "attention" : "passed",
    results,
    blockingFailures,
  };
}

type FailFn = (
  id: string,
  category: VcCheckResult["category"],
  message: string,
  severity?: VcCheckResult["severity"],
) => void;

function validateEstimatedComponent(
  component: EstimatedComponentInput,
  allPoIds: ReadonlySet<string>,
  fail: FailFn,
): void {
  const label = component.description.trim() || component.id;

  if (component.description.trim() === "") {
    fail("vc.component.description", "component", `Component "${component.id}" needs a description.`);
  }
  if (component.allocationRationale.trim() === "") {
    fail(
      "vc.component.allocation_rationale",
      "component",
      `Document why the allocation treatment chosen for "${label}" is appropriate.`,
    );
  }

  // ---- Allocation treatment ----------------------------------------------
  if (component.allocationTreatment === "specific_po") {
    if (!component.targetPoId || !allPoIds.has(component.targetPoId)) {
      fail(
        "vc.component.target_po",
        "allocation",
        `"${label}" is allocated to a specific performance obligation, so a valid target performance obligation is required.`,
      );
    }
    if (component.relatesSpecificallyToPo !== true || component.consistentWithAllocationObjective !== true) {
      fail(
        "vc.component.allocation_exception",
        "allocation",
        `The allocation exception for "${label}" requires both judgments to be Yes: the amount relates specifically to that performance obligation and allocating it there is consistent with the allocation objective.`,
      );
    }
  }

  // ---- Assessments --------------------------------------------------------
  const assessments = orderedAssessments(component);
  for (const assessment of assessments) {
    const stamp = assessment.effectiveDate || assessment.id;
    if (!isValidIsoDate(assessment.effectiveDate)) {
      fail("vc.assessment.date", "component", `"${label}": assessment ${assessment.id} needs a valid effective date.`);
    }
    if (assessment.constraintRationale.trim() === "") {
      fail(
        "vc.assessment.constraint_rationale",
        "component",
        `"${label}": document the constraint conclusion for the assessment dated ${stamp}.`,
      );
    }
    if (assessment.outcomes.length === 0) {
      fail("vc.assessment.outcomes", "component", `"${label}": enter at least one possible outcome for ${stamp}.`);
      continue;
    }
    if (assessment.outcomes.some((o) => !validMagnitude(o.amountCents))) {
      fail(
        "vc.assessment.outcome.amount",
        "component",
        `"${label}": every outcome amount for ${stamp} must be a supported nonnegative whole-cent amount.`,
      );
      continue;
    }

    if (component.estimationMethod === "most_likely_amount") {
      const selected = assessment.outcomes.filter((o) => o.isMostLikely === true);
      if (selected.length !== 1) {
        fail(
          "vc.assessment.most_likely.single",
          "component",
          `"${label}": select exactly one most-likely outcome for ${stamp}.`,
        );
        continue;
      }
    } else {
      if (assessment.outcomes.some((o) => !Number.isInteger(o.probabilityBps ?? -1) || (o.probabilityBps ?? -1) < 0)) {
        fail(
          "vc.assessment.probability.valid",
          "component",
          `"${label}": every outcome for ${stamp} needs a probability between 0% and 100%.`,
        );
        continue;
      }
      if (totalProbabilityBps(assessment.outcomes) !== BPS_SCALE) {
        fail(
          "vc.assessment.probability.total",
          "component",
          `"${label}": outcome probabilities for ${stamp} must total exactly 100.00%.`,
        );
        continue;
      }
    }

    if (!validMagnitude(assessment.includedCents)) {
      fail(
        "vc.assessment.included.valid",
        "component",
        `"${label}": the amount included after the constraint for ${stamp} must be a supported nonnegative whole-cent amount.`,
      );
      continue;
    }
    const unconstrained = unconstrainedMagnitudeCents(assessment, component.estimationMethod, label);
    if (assessment.includedCents > unconstrained) {
      fail(
        "vc.assessment.constraint.magnitude",
        "component",
        `"${label}": the amount included after the constraint for ${stamp} cannot exceed the unconstrained estimate.`,
      );
    }
    // The constraint can only reduce an estimate; it can never flip its sign.
    void constraintConclusion(unconstrained, assessment.includedCents);
  }

  // ---- Remeasurement ordering and locking --------------------------------
  const dated = assessments.filter((a) => isValidIsoDate(a.effectiveDate));
  for (let i = 1; i < dated.length; i += 1) {
    if (!(dated[i]!.effectiveDate > dated[i - 1]!.effectiveDate)) {
      fail(
        "vc.remeasurement.dates_increasing",
        "component",
        `"${label}": remeasurement effective dates must be strictly later than the prior assessment.`,
      );
      break;
    }
  }

  if (component.resolution) {
    const resolution = component.resolution;
    if (!isValidIsoDate(resolution.date)) {
      fail("vc.resolution.date", "component", `"${label}": the resolution needs a valid date.`);
    }
    if (!validMagnitude(resolution.actualCents)) {
      fail(
        "vc.resolution.amount",
        "component",
        `"${label}": the actual resolved amount must be a supported nonnegative whole-cent amount.`,
      );
    }
    const last = dated[dated.length - 1];
    if (last && isValidIsoDate(resolution.date) && !(resolution.date >= last.effectiveDate)) {
      fail(
        "vc.resolution.after_remeasurements",
        "component",
        `"${label}": no remeasurement may follow the resolution date.`,
      );
    }
  }
}

function validateUsageComponent(
  component: UsageComponentInput,
  poById: ReadonlyMap<string, PerformanceObligationInput>,
  fail: FailFn,
): void {
  const label = component.description.trim() || component.id;
  if (component.description.trim() === "") {
    fail("vc.usage.description", "usage", `Usage component "${component.id}" needs a description.`);
  }
  if (component.allocationRationale.trim() === "") {
    fail("vc.usage.rationale", "usage", `Document the allocation conclusion for "${label}".`);
  }

  const target = poById.get(component.targetPoId);
  if (!target) {
    fail("vc.usage.target.exists", "usage", `"${label}" must target an existing performance obligation.`);
  } else if (target.classification !== "series") {
    fail(
      "vc.usage.target.series",
      "usage",
      `Usage-as-incurred consideration is supported only when the target performance obligation is classified as a series. "${target.name}" is not.`,
    );
  }
  if (component.relatesSpecificallyToPeriod !== true || component.consistentWithAllocationObjective !== true) {
    fail(
      "vc.usage.allocation_exception",
      "usage",
      `"${label}" requires both judgments to be Yes: the usage amount relates specifically to the distinct services in that period and allocating it to those periods is consistent with the allocation objective.`,
    );
  }

  if (component.meters.length === 0) {
    fail("vc.usage.meter.exists", "usage", `"${label}" needs at least one meter.`);
  }
  const meterIds = component.meters.map((m) => (m.id ?? "").trim());
  if (meterIds.some((id) => id === "")) {
    fail("vc.usage.meter.id", "usage", `"${label}": every meter needs a stable identifier.`);
  }
  if (new Set(meterIds).size !== meterIds.length) {
    fail("vc.usage.meter.id.unique", "usage", `"${label}": meter identifiers must be unique.`);
  }
  for (const meter of component.meters) {
    const meterLabel = meter.name.trim() || meter.id;
    if (meter.name.trim() === "") {
      fail("vc.usage.meter.name", "usage", `"${label}": every meter needs a name.`);
    }
    if (!Number.isInteger(meter.rateAmountCents) || meter.rateAmountCents <= 0 || meter.rateAmountCents > MAX_CENTS) {
      fail(
        "vc.usage.meter.rate_amount",
        "usage",
        `"${label}": the rate amount for meter "${meterLabel}" must be greater than zero.`,
      );
    }
    if (!Number.isInteger(meter.rateQuantity) || meter.rateQuantity <= 0) {
      fail(
        "vc.usage.meter.rate_quantity",
        "usage",
        `"${label}": the rate quantity for meter "${meterLabel}" must be a positive whole number.`,
      );
    }
    if (meter.unit.trim() === "") {
      fail(
        "vc.usage.meter.unit",
        "usage",
        `"${label}": name the unit measured by meter "${meterLabel}" (for example tokens).`,
      );
    }
  }

  const months = component.periods.map((p) => p.month);
  if (new Set(months).size !== months.length) {
    fail("vc.usage.period.unique", "usage", `"${label}": each usage month may appear only once.`);
  }
  for (const period of component.periods) {
    if (!MONTH_PATTERN.test(period.month)) {
      fail("vc.usage.period.month", "usage", `"${label}": "${period.month}" is not a valid accounting month.`);
      continue;
    }
    if (target && target.recognitionMethod === "over_time_ratable" && target.serviceStart && target.serviceEnd) {
      const first = monthKeyOf(target.serviceStart);
      const last = monthKeyOf(target.serviceEnd);
      if (period.month < first || period.month > last) {
        fail(
          "vc.usage.period.in_service_period",
          "usage",
          `"${label}": usage month ${period.month} falls outside the service period of "${target.name}".`,
        );
      }
    }
    for (const meter of component.meters) {
      const quantity = period.quantitiesByMeterId[meter.id];
      if (quantity === undefined || quantity === null) {
        fail(
          "vc.usage.quantity.required",
          "usage",
          `"${label}": enter the ${meter.name || meter.id} usage for ${period.month}. A blank cell is missing information, not zero usage.`,
        );
        continue;
      }
      if (!Number.isInteger(quantity) || quantity < 0) {
        fail(
          "vc.usage.quantity.valid",
          "usage",
          `"${label}": the ${meter.name || meter.id} usage for ${period.month} must be a whole number of units, zero or more.`,
        );
      }
    }
  }

  // Every month of the target service period must be reported, explicitly as
  // zero where there was no usage. A missing month is missing information.
  if (
    target &&
    target.recognitionMethod === "over_time_ratable" &&
    target.serviceStart &&
    target.serviceEnd &&
    !datePeriodExceedsSupportedHorizon(target.serviceStart, target.serviceEnd)
  ) {
    const supplied = new Set(months);
    for (const month of enumerateMonths(target.serviceStart, target.serviceEnd)) {
      if (!supplied.has(month)) {
        fail(
          "vc.usage.period.complete",
          "usage",
          `"${label}": report the usage for ${month}. Every month of the service period of "${target.name}" must be reported, entering zero where there was no usage.`,
        );
      }
    }
  }
}
