/**
 * Step 3 display measurement of one estimated variable-consideration
 * component at inception.
 *
 * React never calculates: this pure layer parses the accountant's input and
 * asks the engine for the unconstrained estimate and the derived constraint
 * conclusion. Incomplete or invalid input produces issues, never a number.
 */

import type { Cents } from "@/lib/asc606";
import {
  constraintConclusion,
  unconstrainedMagnitudeCents,
  validateAssessment,
  type ConstraintConclusion,
} from "@/lib/asc606-variable-consideration";

import { buildInceptionAssessment } from "./vc-adapter";
import type { VcComponentDraft } from "./types";

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

  const label = component.description || component.id;
  validateAssessment(label, component.estimationMethod, inception, (_id, _category, message) => {
    errors.push(message);
  });
  if (errors.length > 0) return empty(errors);

  try {
    const unconstrained = unconstrainedMagnitudeCents(
      inception,
      component.estimationMethod,
      label,
    );
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
