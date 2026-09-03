/**
 * Phase 2 workflow draft model.
 *
 * Data only: no React, DOM, network, database or AI dependency. Every field is
 * serializable so a later service (including an AI extraction layer) can
 * populate the same conceptual fields.
 *
 * Unanswered accounting judgments are `null` — never `false`, never zero.
 */

import type { IsoDate, PoClassification, RecognitionMethod } from "@/lib/asc606";

/** A yes / no / unanswered accounting judgment. */
export type Judgment = boolean | null;

export type Step1CriterionId =
  | "approval_and_commitment"
  | "rights_identifiable"
  | "payment_terms_identifiable"
  | "commercial_substance"
  | "collectibility_probable";

export interface Step1CriterionDefinition {
  id: Step1CriterionId;
  label: string;
  description: string;
}

export const STEP1_CRITERIA: readonly Step1CriterionDefinition[] = [
  {
    id: "approval_and_commitment",
    label: "Approval and commitment",
    description:
      "The parties have approved the arrangement (in writing, orally or per customary practice) and are committed to perform their respective obligations.",
  },
  {
    id: "rights_identifiable",
    label: "Rights are identifiable",
    description:
      "Each party's rights regarding the goods or services to be transferred can be identified.",
  },
  {
    id: "payment_terms_identifiable",
    label: "Payment terms are identifiable",
    description: "The payment terms for the goods or services to be transferred can be identified.",
  },
  {
    id: "commercial_substance",
    label: "Commercial substance",
    description:
      "The arrangement has commercial substance: the risk, timing or amount of future cash flows is expected to change as a result of the contract.",
  },
  {
    id: "collectibility_probable",
    label: "Collectibility is probable",
    description:
      "Collection of the consideration to which the entity expects to be entitled in exchange for the goods or services is probable.",
  },
];

export interface CriterionAnswer {
  answer: Judgment;
  rationale: string;
}

export interface ContractDraft {
  customerName: string;
  contractNumber: string;
  /** Optional execution / effective date, "YYYY-MM-DD". */
  executionDate: string;
  /** USD only in Phase 2; not editable. */
  currency: "USD";
  criteria: Record<Step1CriterionId, CriterionAnswer>;
}

export interface PromiseDraft {
  id: string;
  seq: number;
  description: string;
  capableOfBeingDistinct: Judgment;
  distinctWithinContractContext: Judgment;
  distinctRationale: string;
  /** Assigned performance obligation; null = unassigned. */
  performanceObligationId: string | null;
}

export interface PoDraft {
  id: string;
  seq: number;
  name: string;
  classification: PoClassification | null;
  classificationRationale: string;
  /** Raw accountant-entered USD string; converted to cents by money-input.ts. */
  sspInput: string;
  sspBasis: string;
  recognitionMethod: RecognitionMethod | null;
  serviceStart: IsoDate | "";
  serviceEnd: IsoDate | "";
  recognitionDate: IsoDate | "";
  recognitionRationale: string;
}

export interface WorkflowDraft {
  contract: ContractDraft;
  promises: PromiseDraft[];
  performanceObligations: PoDraft[];
  /** Raw accountant-entered USD string for fixed consideration. */
  transactionPriceInput: string;
  transactionPriceNotes: string;
}

export const PO_CLASSIFICATION_LABELS: Record<PoClassification, string> = {
  single_distinct: "Single distinct promise",
  bundle_not_distinct: "Bundle of non-distinct promises",
  series: "Series",
};

export function createEmptyContract(): ContractDraft {
  const criteria = {} as Record<Step1CriterionId, CriterionAnswer>;
  for (const criterion of STEP1_CRITERIA) {
    criteria[criterion.id] = { answer: null, rationale: "" };
  }
  return {
    customerName: "",
    contractNumber: "",
    executionDate: "",
    currency: "USD",
    criteria,
  };
}

export function createPromiseDraft(seq: number, id: string): PromiseDraft {
  return {
    id,
    seq,
    description: "",
    capableOfBeingDistinct: null,
    distinctWithinContractContext: null,
    distinctRationale: "",
    performanceObligationId: null,
  };
}

export function createPoDraft(seq: number, id: string): PoDraft {
  return {
    id,
    seq,
    name: "",
    classification: null,
    classificationRationale: "",
    sspInput: "",
    sspBasis: "",
    recognitionMethod: null,
    serviceStart: "",
    serviceEnd: "",
    recognitionDate: "",
    recognitionRationale: "",
  };
}

export function createEmptyDraft(): WorkflowDraft {
  return {
    contract: createEmptyContract(),
    promises: [],
    performanceObligations: [],
    transactionPriceInput: "",
    transactionPriceNotes: "",
  };
}

export type Step1Conclusion = "qualified" | "not_qualified" | "incomplete";

/**
 * Derived Step 1 conclusion. Never stored, never accountant-editable:
 * any No is a completed judgment that fails the criteria; any unanswered
 * criterion leaves the analysis incomplete.
 */
export function deriveStep1Conclusion(contract: ContractDraft): Step1Conclusion {
  const answers = STEP1_CRITERIA.map((c) => contract.criteria[c.id]?.answer ?? null);
  if (answers.some((a) => a === false)) return "not_qualified";
  if (answers.some((a) => a === null)) return "incomplete";
  return "qualified";
}

/** Derived Step 2A conclusion; null while either judgment is unanswered. */
export function derivePromiseDistinct(
  promise: Pick<PromiseDraft, "capableOfBeingDistinct" | "distinctWithinContractContext">,
): boolean | null {
  if (promise.capableOfBeingDistinct === null || promise.distinctWithinContractContext === null) {
    return null;
  }
  return promise.capableOfBeingDistinct && promise.distinctWithinContractContext;
}

/** Simple id factory for locally-created draft rows. */
export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  let n = existing.length + 1;
  const taken = new Set(existing.map((row) => row.id));
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

export function nextSeq(existing: readonly { seq: number }[]): number {
  return existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
}
