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
import type { MaterialRightStatus } from "@/lib/asc606-material-rights";

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

/**
 * Phase 5A: a promise is either an ordinary promised good or service or a
 * customer option. Existing drafts default to "good_or_service".
 */
export type PromiseKind = "good_or_service" | "customer_option";

export type PerformanceObligationKind = "standard" | "material_right";

export interface PromiseDraft {
  id: string;
  seq: number;
  kind: PromiseKind;
  description: string;
  /** Customer options only: accountant judgment that a material right exists. */
  conveysMaterialRight: Judgment;
  materialRightRationale: string;
  capableOfBeingDistinct: Judgment;
  distinctWithinContractContext: Judgment;
  distinctRationale: string;
  /** Assigned performance obligation; null = unassigned. */
  performanceObligationId: string | null;
}

export interface PoDraft {
  id: string;
  seq: number;
  kind: PerformanceObligationKind;
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

  // ---- Material-right fields (kind === "material_right" only) -------------
  /** The good or service the customer would obtain on exercise. */
  underlyingGoodOrServiceName: string;
  /** Accountant judgment: economic benefit of the option, USD string. */
  benefitAmountInput: string;
  /** Accountant judgment: inception exercise probability, percentage string. */
  exerciseProbabilityInput: string;
  materialRightStatus: MaterialRightStatus;
  exerciseDate: IsoDate | "";
  /** New consideration arising on exercise, USD string. */
  exerciseConsiderationInput: string;
  expirationDate: IsoDate | "";
}

/** Phase 3 draft: contract-level billing events and cash receipts. */
export interface ConsiderationEventDraft {
  id: string;
  seq: number;
  /** Raw accountant-entered USD string; converted by money-input.ts. */
  amountInput: string;
  unconditionalRightDate: IsoDate | "";
  invoiceDate: IsoDate | "";
}

export interface CashCollectionDraft {
  id: string;
  seq: number;
  considerationEventId: string | null;
  amountInput: string;
  collectionDate: IsoDate | "";
}

export interface ContractBalanceDraft {
  considerationEvents: ConsiderationEventDraft[];
  cashCollections: CashCollectionDraft[];
}

export interface WorkflowDraft {
  contract: ContractDraft;
  promises: PromiseDraft[];
  performanceObligations: PoDraft[];
  /** Raw accountant-entered USD string for fixed consideration. */
  transactionPriceInput: string;
  transactionPriceNotes: string;
  /** Phase 3 billing, receivables and contract-balance inputs. */
  contractBalances: ContractBalanceDraft;
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
    kind: "good_or_service",
    description: "",
    conveysMaterialRight: null,
    materialRightRationale: "",
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
    kind: "standard",
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
    underlyingGoodOrServiceName: "",
    benefitAmountInput: "",
    exerciseProbabilityInput: "",
    materialRightStatus: "outstanding",
    exerciseDate: "",
    exerciseConsiderationInput: "",
    expirationDate: "",
  };
}

/** A material-right performance obligation draft, created by the accountant. */
export function createMaterialRightPoDraft(seq: number, id: string): PoDraft {
  return { ...createPoDraft(seq, id), kind: "material_right" };
}

export const MATERIAL_RIGHT_STATUS_LABELS: Record<MaterialRightStatus, string> = {
  outstanding: "Outstanding (option not yet exercised or expired)",
  exercised: "Exercised by the customer",
  expired: "Expired unexercised",
};

/** True when the contract contains at least one material-right obligation. */
export function draftHasMaterialRights(draft: WorkflowDraft): boolean {
  return draft.performanceObligations.some((po) => po.kind === "material_right");
}

export function createConsiderationEventDraft(seq: number, id: string): ConsiderationEventDraft {
  return { id, seq, amountInput: "", unconditionalRightDate: "", invoiceDate: "" };
}

export function createCashCollectionDraft(seq: number, id: string): CashCollectionDraft {
  return { id, seq, considerationEventId: null, amountInput: "", collectionDate: "" };
}

export function createEmptyContractBalances(): ContractBalanceDraft {
  return { considerationEvents: [], cashCollections: [] };
}

export function createEmptyDraft(): WorkflowDraft {
  return {
    contract: createEmptyContract(),
    promises: [],
    performanceObligations: [],
    transactionPriceInput: "",
    transactionPriceNotes: "",
    contractBalances: createEmptyContractBalances(),
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
