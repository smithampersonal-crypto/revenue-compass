/**
 * Pure presentation view-models for the accountant-facing results screen.
 *
 * No React, no accounting arithmetic: these helpers only decide WHICH
 * judgments are applicable to a promise or performance obligation, so the UI
 * never describes an intentionally inapplicable field as "incomplete" or
 * "not selected".
 */

import { PO_CLASSIFICATION_LABELS, derivePromiseDistinct, type PoDraft, type PromiseDraft } from "./types";

export interface PromiseAnalysisRow {
  id: string;
  description: string;
  /** "Promised good or service" | "Customer option". */
  promiseType: string;
  /** True when the ordinary distinctness analysis applies. */
  showsDistinctness: boolean;
  capableOfBeingDistinct: boolean | null;
  distinctWithinContractContext: boolean | null;
  /** Derived distinct conclusion; null when not applicable or incomplete. */
  derivedConclusion: "Distinct" | "Not distinct" | "Incomplete" | null;
  /** Customer options only: the material-right conclusion. */
  materialRightConclusion: "Yes" | "No" | "Incomplete" | null;
  rationale: string;
}

export function promiseAnalysisRow(promise: PromiseDraft): PromiseAnalysisRow {
  if (promise.kind === "customer_option") {
    return {
      id: promise.id,
      description: promise.description || promise.id,
      promiseType: "Customer option",
      showsDistinctness: false,
      capableOfBeingDistinct: null,
      distinctWithinContractContext: null,
      derivedConclusion: null,
      materialRightConclusion:
        promise.conveysMaterialRight === null
          ? "Incomplete"
          : promise.conveysMaterialRight
            ? "Yes"
            : "No",
      rationale: promise.materialRightRationale,
    };
  }
  const distinct = derivePromiseDistinct(promise);
  return {
    id: promise.id,
    description: promise.description || promise.id,
    promiseType: "Promised good or service",
    showsDistinctness: true,
    capableOfBeingDistinct: promise.capableOfBeingDistinct,
    distinctWithinContractContext: promise.distinctWithinContractContext,
    derivedConclusion: distinct === null ? "Incomplete" : distinct ? "Distinct" : "Not distinct",
    materialRightConclusion: null,
    rationale: promise.distinctRationale,
  };
}

export interface PoPresentation {
  id: string;
  name: string;
  isMaterialRight: boolean;
  classificationLabel: string;
  /** Entered SSP for a standard PO; a material right is engine-measured. */
  sspLabel: string;
  recognitionLabel: string;
}

export function poPresentation(po: PoDraft): PoPresentation {
  const name = po.name || po.id;
  if (po.kind === "material_right") {
    return {
      id: po.id,
      name,
      isMaterialRight: true,
      classificationLabel: "Not applicable — material right",
      sspLabel: "System-calculated material-right SSP (economic benefit × exercise probability)",
      recognitionLabel: "Lifecycle-dependent — determined by the option outcome",
    };
  }
  return {
    id: po.id,
    name,
    isMaterialRight: false,
    classificationLabel: po.classification
      ? PO_CLASSIFICATION_LABELS[po.classification]
      : "Not selected",
    sspLabel: po.sspInput || "—",
    recognitionLabel:
      po.recognitionMethod === "over_time_ratable"
        ? `Over time — daily ratable, ${po.serviceStart} to ${po.serviceEnd}`
        : po.recognitionMethod === "point_in_time"
          ? `Point in time on ${po.recognitionDate}`
          : "Not selected",
  };
}
