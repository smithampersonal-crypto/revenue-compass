/**
 * The single authoritative boundary converting a completed Phase 2 workflow
 * draft into the existing engine input. Missing values are never manufactured:
 * an incomplete draft fails instead of defaulting to zeros or false.
 */

import type { ContractPromise, PerformanceObligationInput, Phase1ContractInput } from "@/lib/asc606";
import { parseUsdToCents } from "./money-input";
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
