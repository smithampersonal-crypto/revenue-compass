/**
 * The single authoritative boundary converting a completed Phase 2 workflow
 * draft into the existing engine input. Missing values are never manufactured:
 * an incomplete draft fails instead of defaulting to zeros or false.
 */

import type { ContractPromise, PerformanceObligationInput, Phase1ContractInput } from "@/lib/asc606";
import type {
  MaterialRightContractInput,
  MaterialRightExerciseInput,
  MaterialRightInput,
} from "@/lib/asc606-material-rights";
import { parsePercentToBps, parseUsdToCents } from "./money-input";
import { derivePromiseDistinct, type WorkflowDraft } from "./types";

export type AdapterResult =
  | { ok: true; input: Phase1ContractInput }
  | { ok: false; errors: string[] };

export function buildPhase1Input(draft: WorkflowDraft): AdapterResult {
  const errors: string[] = [];

  const price = parseUsdToCents(draft.transactionPriceInput);
  if (!price.ok) errors.push(`Transaction price: ${price.error}`);

  if (draft.contract.customerName.trim() === "") errors.push("Customer name is required.");
  if (draft.contract.contractNumber.trim() === "") errors.push("Contract number is required.");
  if (draft.performanceObligations.length === 0) {
    errors.push("At least one performance obligation is required.");
  }
  if (draft.promises.length === 0) errors.push("At least one promise is required.");

  const performanceObligations: PerformanceObligationInput[] = [];
  for (const po of draft.performanceObligations) {
    const label = po.name || po.id;
    const ssp = parseUsdToCents(po.sspInput);
    if (!ssp.ok || ssp.cents <= 0) {
      errors.push(`Standalone selling price for "${label}" is missing or invalid.`);
    }
    if (po.name.trim() === "") errors.push(`Performance obligation "${po.id}" requires a name.`);
    if (po.classification === null) errors.push(`Classification for "${label}" is required.`);
    if (po.classificationRationale.trim() === "") {
      errors.push(`Classification rationale for "${label}" is required.`);
    }
    if (po.sspBasis.trim() === "") errors.push(`SSP basis for "${label}" is required.`);
    if (po.recognitionMethod === null) {
      errors.push(`Recognition method for "${label}" is required.`);
      continue;
    }
    if (po.recognitionMethod === "over_time_ratable" && (!po.serviceStart || !po.serviceEnd)) {
      errors.push(`Service dates for "${label}" are required.`);
      continue;
    }
    if (po.recognitionMethod === "point_in_time" && !po.recognitionDate) {
      errors.push(`Recognition date for "${label}" is required.`);
      continue;
    }
    if (!ssp.ok || po.classification === null) continue;

    const base = {
      id: po.id,
      seq: po.seq,
      name: po.name,
      sspCents: ssp.cents,
      sspBasis: po.sspBasis,
      classification: po.classification,
      classificationRationale: po.classificationRationale,
    };
    performanceObligations.push(
      po.recognitionMethod === "over_time_ratable"
        ? {
            ...base,
            recognitionMethod: "over_time_ratable",
            serviceStart: po.serviceStart,
            serviceEnd: po.serviceEnd,
            overTimeConvention: "daily_ratable",
          }
        : {
            ...base,
            recognitionMethod: "point_in_time",
            recognitionDate: po.recognitionDate,
          },
    );
  }

  const promises: ContractPromise[] = [];
  for (const promise of draft.promises) {
    // A customer option that conveys no material right is documented only: it
    // creates no performance obligation and never enters the engine input.
    if (promise.kind === "customer_option" && promise.conveysMaterialRight === false) continue;
    const distinct = derivePromiseDistinct(promise);

    if (distinct === null) {
      errors.push(`Distinctness judgments for "${promise.description || promise.id}" are incomplete.`);
      continue;
    }
    if (promise.description.trim() === "") errors.push(`Promise "${promise.id}" requires a description.`);
    if (promise.distinctRationale.trim() === "") {
      errors.push(`Distinctness rationale for "${promise.description || promise.id}" is required.`);
    }
    if (promise.performanceObligationId === null) {
      errors.push(`Promise "${promise.description || promise.id}" is not assigned to a performance obligation.`);
      continue;
    }
    promises.push({
      id: promise.id,
      seq: promise.seq,
      description: promise.description,
      capableOfBeingDistinct: promise.capableOfBeingDistinct === true,
      distinctWithinContractContext: promise.distinctWithinContractContext === true,
      distinctRationale: promise.distinctRationale,
      performanceObligationId: promise.performanceObligationId,
    });
  }

  if (errors.length > 0 || !price.ok) return { ok: false, errors };

  return {
    ok: true,
    input: {
      customerName: draft.contract.customerName,
      contractNumber: draft.contract.contractNumber,
      transactionPriceCents: price.cents,
      performanceObligations,
      promises,
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 5A: material-right lifecycle adapter.
//
// Separate from buildPhase1Input on purpose. A customer option does not carry
// ordinary distinctness/classification/SSP data, so nothing is fabricated here:
// an incomplete material-right draft fails instead of defaulting.
// ---------------------------------------------------------------------------

export type MaterialRightAdapterResult =
  | { ok: true; input: MaterialRightContractInput }
  | { ok: false; errors: string[] };

export function buildMaterialRightContractInput(draft: WorkflowDraft): MaterialRightAdapterResult {
  const errors: string[] = [];

  const price = parseUsdToCents(draft.transactionPriceInput);
  if (!price.ok) errors.push(`Transaction price: ${price.error}`);
  if (draft.contract.customerName.trim() === "") errors.push("Customer name is required.");
  if (draft.contract.contractNumber.trim() === "") errors.push("Contract number is required.");

  const standardPerformanceObligations: PerformanceObligationInput[] = [];
  const materialRights: MaterialRightInput[] = [];

  for (const po of draft.performanceObligations) {
    const label = po.name || po.id;

    if (po.kind !== "material_right") {
      const ssp = parseUsdToCents(po.sspInput);
      if (!ssp.ok || ssp.cents <= 0) {
        errors.push(`Standalone selling price for "${label}" is missing or invalid.`);
      }
      if (po.name.trim() === "") errors.push(`Performance obligation "${po.id}" requires a name.`);
      if (po.recognitionMethod === null) {
        errors.push(`Recognition method for "${label}" is required.`);
        continue;
      }
      if (!ssp.ok) continue;
      const base = {
        id: po.id,
        seq: po.seq,
        name: po.name,
        sspCents: ssp.cents,
        sspBasis: po.sspBasis,
        ...(po.classification ? { classification: po.classification } : {}),
      };
      if (po.recognitionMethod === "over_time_ratable") {
        if (!po.serviceStart || !po.serviceEnd) {
          errors.push(`Service dates for "${label}" are required.`);
          continue;
        }
        standardPerformanceObligations.push({
          ...base,
          recognitionMethod: "over_time_ratable",
          serviceStart: po.serviceStart,
          serviceEnd: po.serviceEnd,
          overTimeConvention: "daily_ratable",
        });
      } else {
        if (!po.recognitionDate) {
          errors.push(`Recognition date for "${label}" is required.`);
          continue;
        }
        standardPerformanceObligations.push({
          ...base,
          recognitionMethod: "point_in_time",
          recognitionDate: po.recognitionDate,
        });
      }
      continue;
    }

    // ---- Material right ----------------------------------------------------
    if (po.name.trim() === "") errors.push(`Material right "${po.id}" requires a name.`);
    if (po.underlyingGoodOrServiceName.trim() === "") {
      errors.push(`Name the good or service the customer would obtain on exercise of "${label}".`);
    }
    const benefit = parseUsdToCents(po.benefitAmountInput);
    if (!benefit.ok) errors.push(`Economic benefit for "${label}": ${benefit.error}`);
    const probability = parsePercentToBps(po.exerciseProbabilityInput);
    if (!probability.ok) errors.push(`Exercise probability for "${label}": ${probability.error}`);
    if (!benefit.ok || !probability.ok) continue;

    const right: MaterialRightInput = {
      id: po.id,
      seq: po.seq,
      name: po.name,
      underlyingGoodOrServiceName: po.underlyingGoodOrServiceName,
      benefitAmountCents: benefit.cents,
      exerciseProbabilityBps: probability.bps,
      sspBasis: po.sspBasis,
      status: po.materialRightStatus,
    };

    if (po.materialRightStatus === "expired") {
      if (!po.expirationDate) {
        errors.push(`An expiration date for "${label}" is required.`);
        continue;
      }
      right.expirationDate = po.expirationDate;
    }

    if (po.materialRightStatus === "exercised") {
      const consideration = parseUsdToCents(po.exerciseConsiderationInput);
      if (!po.exerciseDate) errors.push(`An exercise date for "${label}" is required.`);
      if (!consideration.ok) {
        errors.push(`New consideration on exercise of "${label}": ${consideration.error}`);
      }
      if (po.recognitionMethod === null) {
        errors.push(
          `Select a recognition method for the good or service obtained on exercise of "${label}".`,
        );
        continue;
      }
      if (!po.exerciseDate || !consideration.ok) continue;
      const exercise: MaterialRightExerciseInput = {
        exerciseDate: po.exerciseDate,
        newConsiderationCents: consideration.cents,
        recognitionMethod: po.recognitionMethod,
        recognitionRationale: po.recognitionRationale,
      };
      if (po.recognitionMethod === "over_time_ratable") {
        if (!po.serviceStart || !po.serviceEnd) {
          errors.push(`Service dates for the exercised option "${label}" are required.`);
          continue;
        }
        exercise.serviceStart = po.serviceStart;
        exercise.serviceEnd = po.serviceEnd;
      } else {
        if (!po.recognitionDate) {
          errors.push(`A recognition date for the exercised option "${label}" is required.`);
          continue;
        }
        exercise.recognitionDate = po.recognitionDate;
      }
      right.exercise = exercise;
    }

    materialRights.push(right);
  }

  if (standardPerformanceObligations.length + materialRights.length === 0) {
    errors.push("At least one performance obligation is required.");
  }
  if (errors.length > 0 || !price.ok) return { ok: false, errors };

  return {
    ok: true,
    input: {
      transactionPriceCents: price.cents,
      standardPerformanceObligations,
      materialRights,
    },
  };
}
