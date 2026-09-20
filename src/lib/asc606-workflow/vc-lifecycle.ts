/**
 * Phase 9G-R3 — the FULL dated variable-consideration lifecycle of one
 * estimated component, owned by the accepted Phase 5B engine.
 *
 * R3 does not own remeasurement mathematics. This module builds the accepted
 * `EstimatedComponentInput` from the accountant's draft using the same
 * assessment builder the legacy Phase 5B path uses, applies the accepted
 * component-level validation, and then asks the accepted measurement function
 * for the dated lifecycle:
 *
 *   inception measurement -> each dated remeasurement -> resolution
 *
 * with the signed transaction-price change at each date. Nothing is flattened
 * into a single current amount here: the progressive engine consumes the dated
 * sequence so revenue, catch-up and future impact stay economically correct.
 */

import {
  measureComponent,
  validateEstimatedComponent,
  type EstimatedComponentInput,
  type VcAssessmentInput,
  type VcComponentResult,
} from "@/lib/asc606-variable-consideration";

import { parseUsdToCents } from "./money-input";
import type { VcComponentDraft } from "./types";
import { buildDraftAssessment, buildInceptionAssessment } from "./vc-adapter";

export interface EstimatedLifecycle {
  /** The accepted engine input actually measured. */
  input: EstimatedComponentInput;
  /** The accepted engine result: dated assessments, inception and current. */
  result: VcComponentResult;
}

export interface EstimatedLifecycleOutcome {
  lifecycle: EstimatedLifecycle | null;
  issues: string[];
}

/** True when the accepted Phase 5B lifecycle governs this component. */
export function usesAcceptedLifecycle(component: VcComponentDraft): boolean {
  return (
    component.treatment === "estimated" &&
    (component.allocationTreatment === "general" ||
      component.allocationTreatment === "specific_po")
  );
}

/**
 * Builds and measures one estimated component through the accepted engine.
 * Fail-closed: any accepted validation failure yields no lifecycle at all.
 */
export function buildEstimatedLifecycle(
  component: VcComponentDraft,
  poIds: ReadonlySet<string>,
): EstimatedLifecycleOutcome {
  const label = component.description || component.id;
  const issues: string[] = [];

  if (!usesAcceptedLifecycle(component)) {
    return { lifecycle: null, issues };
  }
  if (component.estimationMethod === null) {
    return {
      lifecycle: null,
      issues: [`Choose an estimation method for "${label}" before its estimate can be measured.`],
    };
  }

  const inception = buildInceptionAssessment(component, issues);
  const remeasurements: VcAssessmentInput[] = [];
  for (const assessment of [...component.remeasurements].sort((a, b) => a.seq - b.seq)) {
    const built = buildDraftAssessment(component, assessment, "remeasurement", issues);
    if (built !== null) remeasurements.push(built);
  }
  if (inception === null || remeasurements.length !== component.remeasurements.length) {
    return { lifecycle: null, issues };
  }

  const input: EstimatedComponentInput = {
    id: component.id,
    seq: component.seq,
    description: component.description,
    effect: component.effect,
    estimationMethod: component.estimationMethod,
    allocationTreatment: component.allocationTreatment as "general" | "specific_po",
    allocationRationale: component.allocationRationale,
    inception,
    remeasurements,
  };
  if (component.allocationTreatment === "specific_po") {
    if (component.targetPoId !== null) input.targetPoId = component.targetPoId;
    if (component.relatesSpecifically !== null) {
      input.relatesSpecificallyToPo = component.relatesSpecifically;
    }
    if (component.consistentWithAllocationObjective !== null) {
      input.consistentWithAllocationObjective = component.consistentWithAllocationObjective;
    }
  }
  if (component.hasResolution) {
    const actual = parseUsdToCents(component.resolutionAmountInput);
    input.resolution = {
      id: `${component.id}:resolution`,
      date: component.resolutionDate,
      // An unreadable or negative resolved amount is retained as invalid so the
      // accepted validator rejects it; it is never repaired to zero.
      actualCents: actual.ok ? actual.cents : Number.NaN,
      ...(component.resolutionRationale ? { rationale: component.resolutionRationale } : {}),
    };
  }

  // The accepted component-level rules: assessment validity, strictly
  // increasing assessment dates, resolution after the latest remeasurement,
  // nonnegative resolution magnitude, specific-PO target ownership and both
  // allocation-exception judgments, constraint magnitude, estimation method.
  validateEstimatedComponent(input, poIds, (_id, _category, message) => {
    issues.push(message);
  });
  if (issues.length > 0) return { lifecycle: null, issues };

  try {
    return { lifecycle: { input, result: measureComponent(input) }, issues };
  } catch (error) {
    return { lifecycle: null, issues: [(error as Error).message] };
  }
}
