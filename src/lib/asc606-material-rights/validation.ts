/**
 * Phase 5A material-right validation.
 *
 * The lifecycle engine independently validates its own inputs and never relies
 * on the workflow layer having done so. A blocking failure yields no
 * authoritative allocation, revenue schedule or reconciliation.
 */

import {
  datePeriodExceedsSupportedHorizon,
  exceedsSupportedHorizon,
  isValidCents,
  isValidIsoDate,
  monthKeyOf,
  MAX_CENTS,
  MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS,
  type CheckResult,
  type ValidationOutcome,
} from "@/lib/asc606";
import { materialRightSspCents } from "./calculation";
import { BPS_SCALE, type MaterialRightContractInput, type MaterialRightInput } from "./types";

function fail(
  results: CheckResult[],
  id: string,
  category: CheckResult["category"],
  message: string,
): void {
  results.push({ id, category, severity: "blocking", message, passed: false });
}

const HORIZON_MESSAGE = `Accounting horizon exceeds the current ${
  MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS / 12
}-year supported range. Check the entered dates.`;

/** True when the derived SSP of every material right can be measured. */
export function canMeasureMaterialRight(mr: MaterialRightInput): boolean {
  return (
    isValidCents(mr.benefitAmountCents) &&
    mr.benefitAmountCents > 0 &&
    Number.isInteger(mr.exerciseProbabilityBps) &&
    mr.exerciseProbabilityBps > 0 &&
    mr.exerciseProbabilityBps <= BPS_SCALE
  );
}

export function validateMaterialRightContract(
  input: MaterialRightContractInput,
): ValidationOutcome {
  const results: CheckResult[] = [];
  const standard = input.standardPerformanceObligations ?? [];
  const rights = input.materialRights ?? [];

  if (!isValidCents(input.transactionPriceCents) || input.transactionPriceCents <= 0) {
    fail(
      results,
      "contract.transaction_price.valid",
      "contract",
      "The original contract transaction price must be a whole-cent amount greater than zero.",
    );
  }
  if (standard.length + rights.length === 0) {
    fail(
      results,
      "po.exists",
      "performance_obligations",
      "The contract must have at least one performance obligation.",
    );
  }

  const ids = [...standard.map((po) => po.id), ...rights.map((mr) => mr.id)];
  if (ids.some((id) => typeof id !== "string" || id.trim() === "")) {
    fail(
      results,
      "po.id.unique",
      "performance_obligations",
      "Each performance obligation must have a non-empty, unique identifier.",
    );
  } else if (new Set(ids).size !== ids.length) {
    fail(
      results,
      "po.id.unique",
      "performance_obligations",
      "Each performance obligation must have a non-empty, unique identifier.",
    );
  }
  const seqs = [...standard.map((po) => po.seq), ...rights.map((mr) => mr.seq)];
  if (seqs.some((s) => !Number.isInteger(s)) || new Set(seqs).size !== seqs.length) {
    fail(
      results,
      "po.sequence.unique",
      "performance_obligations",
      "Each performance obligation must have a unique whole-number sequence.",
    );
  }

  // ---- Standard performance obligations -----------------------------------
  const recognitionMonths: string[] = [];
  for (const po of standard) {
    const label = po.name || po.id;
    if (!isValidCents(po.sspCents) || po.sspCents <= 0) {
      fail(
        results,
        "po.ssp.positive",
        "performance_obligations",
        `Standalone selling price for "${label}" must be greater than zero.`,
      );
    }
    if (po.recognitionMethod === "over_time_ratable") {
      if (!isValidIsoDate(po.serviceStart) || !isValidIsoDate(po.serviceEnd)) {
        fail(results, "po.service_dates.present", "revenue", `Service dates for "${label}" are required.`);
      } else if (po.serviceEnd! < po.serviceStart!) {
        fail(
          results,
          "po.service_dates.sequence",
          "revenue",
          `Service end date for "${label}" must be on or after the service start date.`,
        );
      } else if (datePeriodExceedsSupportedHorizon(po.serviceStart!, po.serviceEnd!)) {
        fail(results, "po.recognition_period.supported_range", "revenue", HORIZON_MESSAGE);
      } else {
        recognitionMonths.push(monthKeyOf(po.serviceStart!), monthKeyOf(po.serviceEnd!));
      }
    } else if (po.recognitionMethod === "point_in_time") {
      if (!isValidIsoDate(po.recognitionDate)) {
        fail(results, "po.recognition_date.present", "revenue", `A recognition date for "${label}" is required.`);
      } else {
        recognitionMonths.push(monthKeyOf(po.recognitionDate!));
      }
    } else {
      fail(
        results,
        "po.recognition_method.present",
        "revenue",
        `"${label}" must have a supported recognition method.`,
      );
    }
  }

  // ---- Material rights ----------------------------------------------------
  for (const mr of rights) {
    const label = mr.name || mr.id;
    if (!mr.name || mr.name.trim() === "") {
      fail(results, "material_right.name.present", "performance_obligations", `Material right "${mr.id}" requires a name.`);
    }
    if (!mr.underlyingGoodOrServiceName || mr.underlyingGoodOrServiceName.trim() === "") {
      fail(
        results,
        "material_right.underlying_service.present",
        "performance_obligations",
        `Name the underlying good or service the customer would obtain on exercise of "${label}".`,
      );
    }
    if (!isValidCents(mr.benefitAmountCents) || mr.benefitAmountCents <= 0) {
      fail(
        results,
        "material_right.benefit.positive",
        "performance_obligations",
        `The economic benefit of "${label}" must be greater than zero.`,
      );
    }
    if (
      !Number.isInteger(mr.exerciseProbabilityBps) ||
      mr.exerciseProbabilityBps <= 0 ||
      mr.exerciseProbabilityBps > BPS_SCALE
    ) {
      fail(
        results,
        "material_right.probability.range",
        "performance_obligations",
        `The exercise probability at contract inception for "${label}" must be greater than 0% and no greater than 100%.`,
      );
    }
    if (canMeasureMaterialRight(mr) && materialRightSspCents(mr.benefitAmountCents, mr.exerciseProbabilityBps) <= 0) {
      fail(
        results,
        "material_right.ssp.positive",
        "performance_obligations",
        `The estimated standalone selling price of "${label}" rounds to zero, so it cannot participate in allocation.`,
      );
    }

    const status = mr.status;
    if (status !== "outstanding" && status !== "exercised" && status !== "expired") {
      fail(
        results,
        "material_right.status.valid",
        "performance_obligations",
        `"${label}" must be outstanding, exercised or expired.`,
      );
      continue;
    }

    if (status === "outstanding") {
      if (mr.exercise) {
        fail(
          results,
          "material_right.outstanding.no_exercise",
          "performance_obligations",
          `"${label}" is outstanding, so it cannot carry exercise data.`,
        );
      }
      if (mr.expirationDate) {
        fail(
          results,
          "material_right.outstanding.no_expiration",
          "performance_obligations",
          `"${label}" is outstanding, so it cannot carry an expiration date.`,
        );
      }
    }

    if (status === "expired") {
      if (!isValidIsoDate(mr.expirationDate)) {
        fail(
          results,
          "material_right.expiration_date.present",
          "revenue",
          `"${label}" expired unexercised, so a valid expiration date is required.`,
        );
      } else {
        recognitionMonths.push(monthKeyOf(mr.expirationDate!));
      }
      if (mr.exercise) {
        fail(
          results,
          "material_right.expired.no_exercise",
          "performance_obligations",
          `"${label}" expired unexercised, so it cannot carry exercise data.`,
        );
      }
    }

    if (status === "exercised") {
      if (mr.expirationDate) {
        fail(
          results,
          "material_right.exercised.no_expiration",
          "performance_obligations",
          `"${label}" was exercised, so it cannot carry an expiration date.`,
        );
      }
      const exercise = mr.exercise;
      if (!exercise) {
        fail(
          results,
          "material_right.exercise.present",
          "performance_obligations",
          `"${label}" was exercised, so the exercise segment is required.`,
        );
        continue;
      }
      if (!isValidIsoDate(exercise.exerciseDate)) {
        fail(results, "material_right.exercise_date.present", "revenue", `A valid exercise date for "${label}" is required.`);
      }
      if (!isValidCents(exercise.newConsiderationCents) || exercise.newConsiderationCents < 0) {
        fail(
          results,
          "material_right.exercise_consideration.valid",
          "contract",
          `The new consideration arising on exercise of "${label}" must be a nonnegative whole-cent amount.`,
        );
      }
      if (exercise.recognitionMethod === "over_time_ratable") {
        if (!isValidIsoDate(exercise.serviceStart) || !isValidIsoDate(exercise.serviceEnd)) {
          fail(
            results,
            "material_right.exercise_service_dates.present",
            "revenue",
            `Service dates for the good or service obtained on exercise of "${label}" are required.`,
          );
        } else if (exercise.serviceEnd! < exercise.serviceStart!) {
          fail(
            results,
            "material_right.exercise_service_dates.sequence",
            "revenue",
            `The exercise service end date for "${label}" must be on or after its start date.`,
          );
        } else if (datePeriodExceedsSupportedHorizon(exercise.serviceStart!, exercise.serviceEnd!)) {
          // Arithmetic check only: no month enumeration for an absurd range.
          fail(results, "material_right.exercise_period.supported_range", "revenue", HORIZON_MESSAGE);
        } else {
          recognitionMonths.push(monthKeyOf(exercise.serviceStart!), monthKeyOf(exercise.serviceEnd!));
        }
      } else if (exercise.recognitionMethod === "point_in_time") {
        if (!isValidIsoDate(exercise.recognitionDate)) {
          fail(
            results,
            "material_right.exercise_recognition_date.present",
            "revenue",
            `A recognition date for the good or service obtained on exercise of "${label}" is required.`,
          );
        } else {
          recognitionMonths.push(monthKeyOf(exercise.recognitionDate!));
        }
      } else {
        fail(
          results,
          "material_right.exercise_recognition_method.present",
          "revenue",
          `Select a recognition method for the good or service obtained on exercise of "${label}".`,
        );
      }
    }
  }

  // ---- Aggregate SSP and contract-level horizon ---------------------------
  let totalSspBig = 0n;
  for (const po of standard) if (isValidCents(po.sspCents)) totalSspBig += BigInt(po.sspCents);
  for (const mr of rights) {
    if (canMeasureMaterialRight(mr)) {
      totalSspBig += BigInt(materialRightSspCents(mr.benefitAmountCents, mr.exerciseProbabilityBps));
    }
  }
  if (totalSspBig > BigInt(MAX_CENTS)) {
    fail(
      results,
      "allocation.total_ssp.supported_range",
      "allocation",
      "Total standalone selling price exceeds the amount this engine can calculate exactly.",
    );
  }
  if (totalSspBig <= 0n) {
    fail(
      results,
      "allocation.total_ssp.positive",
      "allocation",
      "Total standalone selling price must be greater than zero before allocation.",
    );
  }

  if (recognitionMonths.length > 0) {
    const first = recognitionMonths.reduce((a, b) => (a < b ? a : b));
    const last = recognitionMonths.reduce((a, b) => (a > b ? a : b));
    if (exceedsSupportedHorizon(first, last)) {
      fail(results, "accounting_horizon.supported_range", "revenue", HORIZON_MESSAGE);
    }
  }

  const blockingFailures = results.filter((r) => !r.passed && r.severity === "blocking");
  return {
    status: blockingFailures.length > 0 ? "attention" : "passed",
    results,
    blockingFailures,
  };
}
