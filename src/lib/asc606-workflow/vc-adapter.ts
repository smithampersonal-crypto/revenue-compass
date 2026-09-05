/**
 * Phase 5B adapter: converts the accountant's workflow draft into the pure
 * variable-consideration engine input.
 *
 * Nothing is manufactured here. A missing probability, rate, quantity or
 * judgment produces an error instead of a default, and every monetary and
 * percentage string is converted exactly (integer cents / basis points).
 */

import type {
  EstimatedComponentInput,
  UsageComponentInput,
  UsageMeterInput,
  UsagePeriodInput,
  VcAssessmentInput,
  VcContractInput,
  VcOutcomeInput,
} from "@/lib/asc606-variable-consideration";
import { buildMaterialRightContractInput } from "./adapter";
import { parseInclusivePercentToBps, parseUsageQuantity, parseUsdToCents } from "./money-input";
import type { VcAssessmentDraft, VcComponentDraft, WorkflowDraft } from "./types";

export type VcAdapterResult =
  | { ok: true; input: VcContractInput }
  | { ok: false; errors: string[] };

function buildAssessment(
  component: VcComponentDraft,
  assessment: VcAssessmentDraft,
  label: string,
  errors: string[],
): VcAssessmentInput | null {
  let failed = false;
  if (!assessment.effectiveDate) {
    errors.push(`An effective date for the ${label} of "${component.description || component.id}" is required.`);
    failed = true;
  }
  if (assessment.constraintRationale.trim() === "") {
    errors.push(`A constraint rationale for the ${label} of "${component.description || component.id}" is required.`);
    failed = true;
  }

  const outcomes: VcOutcomeInput[] = [];
  for (const outcome of assessment.outcomes) {
    const amount = parseUsdToCents(outcome.amountInput);
    if (!amount.ok) {
      errors.push(`Outcome "${outcome.description || outcome.id}": ${amount.error}`);
      failed = true;
      continue;
    }
    const row: VcOutcomeInput = {
      id: outcome.id,
      seq: outcome.seq,
      amountCents: amount.cents,
      description: outcome.description,
    };
    if (component.estimationMethod === "expected_value") {
      const probability = parseInclusivePercentToBps(outcome.probabilityInput);
      if (!probability.ok) {
        errors.push(`Probability for outcome "${outcome.description || outcome.id}": ${probability.error}`);
        failed = true;
        continue;
      }
      row.probabilityBps = probability.bps;
    } else {
      row.isMostLikely = outcome.isMostLikely;
    }
    outcomes.push(row);
  }

  const included = parseUsdToCents(assessment.includedInput);
  if (!included.ok) {
    errors.push(
      `Amount included after the constraint for the ${label} of "${component.description || component.id}": ${included.error}`,
    );
    failed = true;
  }

  if (failed || !included.ok || !assessment.effectiveDate) return null;

  return {
    id: assessment.id,
    seq: assessment.seq,
    effectiveDate: assessment.effectiveDate,
    outcomes,
    includedCents: included.cents,
    constraintRationale: assessment.constraintRationale,
    ...(assessment.evidence ? { evidence: assessment.evidence } : {}),
  };
}

export function buildVariableConsiderationInput(draft: WorkflowDraft): VcAdapterResult {
  const errors: string[] = [];

  // Fixed consideration, performance obligations and material rights come from
  // the already-approved adapter so Phase 5A behaviour is unchanged.
  const base = buildMaterialRightContractInput(draft);
  if (!base.ok) return { ok: false, errors: base.errors };

  const estimatedComponents: EstimatedComponentInput[] = [];
  const usageComponents: UsageComponentInput[] = [];

  for (const component of draft.variableConsiderationComponents) {
    const label = component.description || component.id;
    if (component.description.trim() === "") {
      errors.push(`Variable-consideration component "${component.id}" requires a description.`);
    }
    if (component.allocationRationale.trim() === "") {
      errors.push(`An allocation rationale for "${label}" is required.`);
    }

    if (component.treatment === "estimated") {
      if (component.estimationMethod === null) {
        errors.push(`An estimation method for "${label}" is required.`);
        continue;
      }
      if (component.allocationTreatment === "specific_series_period") {
        errors.push(`"${label}" cannot use the series-period allocation exception.`);
        continue;
      }
      const inception = buildAssessment(component, component.inception, "inception estimate", errors);
      const remeasurements: VcAssessmentInput[] = [];
      for (const assessment of component.remeasurements) {
        const built = buildAssessment(component, assessment, "remeasurement", errors);
        if (built) remeasurements.push(built);
      }
      if (inception === null) continue;

      const built: EstimatedComponentInput = {
        id: component.id,
        seq: component.seq,
        description: component.description,
        effect: component.effect,
        estimationMethod: component.estimationMethod,
        allocationTreatment: component.allocationTreatment,
        allocationRationale: component.allocationRationale,
        inception,
        remeasurements,
      };
      if (component.allocationTreatment === "specific_po") {
        if (component.targetPoId === null) {
          errors.push(`"${label}" must name the performance obligation it relates specifically to.`);
          continue;
        }
        built.targetPoId = component.targetPoId;
        if (component.relatesSpecifically === null || component.consistentWithAllocationObjective === null) {
          errors.push(`The allocation-exception judgments for "${label}" are incomplete.`);
          continue;
        }
        built.relatesSpecificallyToPo = component.relatesSpecifically;
        built.consistentWithAllocationObjective = component.consistentWithAllocationObjective;
      }
      if (component.hasResolution) {
        const actual = parseUsdToCents(component.resolutionAmountInput);
        if (!component.resolutionDate) {
          errors.push(`A resolution date for "${label}" is required.`);
          continue;
        }
        if (!actual.ok) {
          errors.push(`Resolved amount for "${label}": ${actual.error}`);
          continue;
        }
        built.resolution = {
          id: `${component.id}-resolution`,
          date: component.resolutionDate,
          actualCents: actual.cents,
          ...(component.resolutionRationale ? { rationale: component.resolutionRationale } : {}),
        };
      }
      estimatedComponents.push(built);
      continue;
    }

    // ---- Usage as incurred --------------------------------------------------
    if (component.targetPoId === null) {
      errors.push(`"${label}" must name the series performance obligation the usage relates to.`);
      continue;
    }
    if (component.meters.length === 0) {
      errors.push(`"${label}" requires at least one usage meter.`);
      continue;
    }

    let meterFailed = false;
    const meters: UsageMeterInput[] = [];
    for (const meter of component.meters) {
      const rate = parseUsdToCents(meter.rateAmountInput);
      const quantity = parseUsageQuantity(meter.rateQuantityInput);
      if (meter.name.trim() === "") errors.push(`Meter "${meter.id}" of "${label}" requires a name.`);
      if (!rate.ok) {
        errors.push(`Rate amount for meter "${meter.name || meter.id}": ${rate.error}`);
        meterFailed = true;
      }
      if (!quantity.ok || quantity.value <= 0) {
        errors.push(
          `Rate quantity for meter "${meter.name || meter.id}" must be a positive whole quantity.`,
        );
        meterFailed = true;
      }
      if (!rate.ok || !quantity.ok) continue;
      meters.push({
        id: meter.id,
        seq: meter.seq,
        name: meter.name,
        rateAmountCents: rate.cents,
        rateQuantity: quantity.value,
        unit: meter.unit,
      });
    }

    const periods: UsagePeriodInput[] = [];
    for (const period of component.usagePeriods) {
      const quantitiesByMeterId: Record<string, number | null> = {};
      for (const meter of component.meters) {
        const raw = period.quantities[meter.id] ?? "";
        if (raw.trim() === "") {
          // Blank is not zero: the engine blocks on it.
          quantitiesByMeterId[meter.id] = null;
          continue;
        }
        const parsed = parseUsageQuantity(raw);
        if (!parsed.ok) {
          errors.push(
            `Usage quantity for meter "${meter.name || meter.id}" in ${period.month}: ${parsed.error}`,
          );
          meterFailed = true;
          continue;
        }
        quantitiesByMeterId[meter.id] = parsed.value;
      }
      periods.push({ month: period.month, quantitiesByMeterId });
    }
    if (meterFailed) continue;

    const usage: UsageComponentInput = {
      id: component.id,
      seq: component.seq,
      description: component.description,
      targetPoId: component.targetPoId,
      allocationTreatment: "specific_series_period",
      allocationRationale: component.allocationRationale,
      meters,
      periods,
    };
    if (component.relatesSpecifically !== null) {
      usage.relatesSpecificallyToPeriod = component.relatesSpecifically;
    }
    if (component.consistentWithAllocationObjective !== null) {
      usage.consistentWithAllocationObjective = component.consistentWithAllocationObjective;
    }
    usageComponents.push(usage);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      fixedConsiderationCents: base.input.transactionPriceCents,
      standardPerformanceObligations: base.input.standardPerformanceObligations,
      materialRights: base.input.materialRights,
      estimatedComponents,
      usageComponents,
    },
  };
}
