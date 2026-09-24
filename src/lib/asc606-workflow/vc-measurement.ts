/**
 * Step 3 display measurement of one estimated variable-consideration
 * component.
 *
 * React never calculates: this pure layer parses the accountant's input and
 * asks the ACCEPTED engine for the unconstrained estimate and the derived
 * constraint conclusion. Incomplete or invalid input produces issues, never a
 * number.
 *
 * There is exactly one measurement authority. The inception preview and the
 * current (latest dated) measurement both route through the same accepted
 * assessment builder, the same `validateAssessment` rules and the same
 * `unconstrainedMagnitudeCents` calculation.
 */

import { isValidIsoDate, type Cents } from "@/lib/asc606";
import {
  constraintConclusion,
  unconstrainedMagnitudeCents,
  validateAssessment,
  type ConstraintConclusion,
  type VcAssessmentInput,
} from "@/lib/asc606-variable-consideration";

import { buildDraftAssessment, buildInceptionAssessment } from "./vc-adapter";
import type { VcComponentDraft } from "./types";
import { variableConsiderationDisplayLabel } from "./vc-presentation";

export interface VcMeasurementPreview {
  /** Engine-calculated estimate before the constraint, as a magnitude. */
  unconstrainedCents: Cents | null;
  /** The magnitude the accountant included after the constraint. */
  includedCents: Cents | null;
  conclusion: ConstraintConclusion | null;
  issues: string[];
}

export function previewVcMeasurement(component: VcComponentDraft): VcMeasurementPreview {
  const empty = (issues: string[]): VcMeasurementPreview => ({
    unconstrainedCents: null,
    includedCents: null,
    conclusion: null,
    issues,
  });

  if (component.treatment !== "estimated") return empty([]);
  if (component.estimationMethod === null) {
    return empty(["Choose an estimation method to see the calculated estimate."]);
  }

  const errors: string[] = [];
  const inception = buildInceptionAssessment(component, errors);
  if (inception === null) return empty(errors);

  const label = variableConsiderationDisplayLabel(component);
  validateAssessment(label, component.estimationMethod, inception, (_id, _category, message) => {
    errors.push(message);
  });
  if (errors.length > 0) return empty(errors);

  try {
    const unconstrained = unconstrainedMagnitudeCents(inception, component.estimationMethod, label);
    return {
      unconstrainedCents: unconstrained,
      includedCents: inception.includedCents,
      conclusion: constraintConclusion(unconstrained, inception.includedCents),
      issues: [],
    };
  } catch (error) {
    return empty([(error as Error).message]);
  }
}

/** The measurement as it stands TODAY: inception, or the latest remeasurement. */
export interface VcCurrentMeasurement extends VcMeasurementPreview {
  /** Effective date of the assessment the current amounts come from. */
  effectiveDate: string | null;
  /** True when a dated remeasurement, not inception, is authoritative now. */
  remeasured: boolean;
}

export function previewVcCurrentMeasurement(component: VcComponentDraft): VcCurrentMeasurement {
  const empty = (issues: string[]): VcCurrentMeasurement => ({
    unconstrainedCents: null,
    includedCents: null,
    conclusion: null,
    effectiveDate: null,
    remeasured: false,
    issues,
  });

  if (component.treatment !== "estimated") return empty([]);
  const method = component.estimationMethod;
  if (method === null) {
    return empty(["Choose an estimation method to see the calculated estimate."]);
  }

  const label = variableConsiderationDisplayLabel(component);
  const errors: string[] = [];

  const inception = buildInceptionAssessment(component, errors);
  const dated: VcAssessmentInput[] = [];
  for (const assessment of [...component.remeasurements].sort((a, b) => a.seq - b.seq)) {
    // A remeasurement is built and validated by exactly the accepted rules; a
    // blank or malformed included amount is an error, never a silent fallback
    // to the previous assessment.
    const built = buildDraftAssessment(component, assessment, "remeasurement", errors);
    if (built !== null) dated.push(built);
  }
  if (inception === null) return empty(errors);
  if (dated.length !== component.remeasurements.length) return empty(errors);

  const ordered = [inception, ...dated];
  for (const assessment of ordered) {
    validateAssessment(label, method, assessment, (_id, _category, message) => {
      errors.push(message);
    });
  }
  // Chronology: every assessment must be dated after the one before it, so the
  // "current" measurement is never ambiguous.
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (!isValidIsoDate(previous.effectiveDate) || !isValidIsoDate(current.effectiveDate)) continue;
    if (current.effectiveDate <= previous.effectiveDate) {
      errors.push(
        `"${label}": the assessment dated ${current.effectiveDate} must come after the assessment dated ${previous.effectiveDate}.`,
      );
    }
  }
  if (errors.length > 0) return empty(errors);

  const current = ordered[ordered.length - 1]!;
  try {
    const unconstrained = unconstrainedMagnitudeCents(current, method, label);
    return {
      unconstrainedCents: unconstrained,
      includedCents: current.includedCents,
      conclusion: constraintConclusion(unconstrained, current.includedCents),
      effectiveDate: current.effectiveDate,
      remeasured: ordered.length > 1,
      issues: [],
    };
  } catch (error) {
    return empty([(error as Error).message]);
  }
}
