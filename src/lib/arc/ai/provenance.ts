/**
 * Phase 9D acceptance patch — material-provenance validation.
 *
 * The strict wire schema can only require that a citations ARRAY exists; an
 * empty array is structurally valid JSON. ARC therefore enforces, locally and
 * deterministically, that a material accounting conclusion actually carries
 * contract provenance.
 *
 * The rule:
 *
 *   supported / inference / needs_review / source_conflict
 *       -> at least one contract citation
 *   needs_user_input
 *       -> zero citations are allowed, because the point of the conclusion may
 *          be that the required fact is genuinely absent from the evidence
 *
 * Non-applicable sections (a contract with no modification, an additional topic
 * concluded not applicable) are not material conclusions about the contract's
 * content and are exempt.
 *
 * Pure: reads the analysis, never mutates it, never repairs a conclusion.
 */

import type { AiContractAnalysis, AiReviewState } from "./schema";

export const PROVENANCE_EXEMPT_REVIEW_STATE: AiReviewState = "needs_user_input";

export interface AiProvenanceIssue {
  code: "missing_material_citation";
  path: string;
  message: string;
}

interface Conclusion {
  reviewState: AiReviewState;
  citations: readonly unknown[];
}

function isConclusion(value: unknown): value is Conclusion {
  const record = value as Record<string, unknown> | null;
  return (
    !!record && typeof record["reviewState"] === "string" && Array.isArray(record["citations"])
  );
}

function check(node: unknown, path: string, label: string, out: AiProvenanceIssue[]): void {
  if (!isConclusion(node)) return;
  if (node.reviewState === PROVENANCE_EXEMPT_REVIEW_STATE) return;
  if (node.citations.length > 0) return;
  out.push({
    code: "missing_material_citation",
    path,
    message: `${label} is stated as "${node.reviewState}" but carries no contract citation`,
  });
}

/**
 * Every material conclusion ARC requires provenance for. Deliberately an
 * explicit list rather than a generic walk: a future schema section must be
 * added here on purpose.
 */
export function validateMaterialProvenance(analysis: AiContractAnalysis): AiProvenanceIssue[] {
  const out: AiProvenanceIssue[] = [];

  // Step 1 — contract judgments and the administrative facts they rest on.
  const step1 = analysis.contractAssessment;
  const step1Fields = [
    "contractEffectiveDate",
    "contractTerm",
    "approvalAndCommitment",
    "identifiableRights",
    "identifiablePaymentTerms",
    "commercialSubstance",
    "collectibility",
    "terminationRights",
    "renewalTerms",
    "currency",
  ] as const;
  for (const field of step1Fields) {
    check(step1[field], `contractAssessment.${field}`, `Step 1 conclusion "${field}"`, out);
  }

  // Step 2 — promises/distinctness and performance-obligation grouping.
  analysis.promises.forEach((promise, index) => {
    check(promise, `promises[${index}]`, `Promise "${promise.semanticKey}"`, out);
  });
  analysis.performanceObligations.forEach((po, index) => {
    check(
      po,
      `performanceObligations[${index}]`,
      `Performance obligation "${po.semanticKey}"`,
      out,
    );
  });

  // Step 3 — transaction price.
  const price = analysis.transactionPrice;
  check(price.currency, "transactionPrice.currency", "Transaction-price currency", out);
  check(
    price.financingAssessment,
    "transactionPrice.financingAssessment",
    "Significant-financing conclusion",
    out,
  );
  check(
    price.noncashConsideration,
    "transactionPrice.noncashConsideration",
    "Noncash-consideration conclusion",
    out,
  );
  check(
    price.considerationPayableToCustomer,
    "transactionPrice.considerationPayableToCustomer",
    "Consideration-payable-to-customer conclusion",
    out,
  );
  check(
    price.transactionPriceConclusion,
    "transactionPrice.transactionPriceConclusion",
    "Transaction-price conclusion",
    out,
  );
  if (price.fixedConsiderationInput !== null && price.fixedConsiderationCitations.length === 0) {
    out.push({
      code: "missing_material_citation",
      path: "transactionPrice.fixedConsiderationCitations",
      message: "a stated fixed consideration amount carries no contract citation",
    });
  }
  price.variableConsiderationComponents.forEach((component, index) => {
    check(
      component,
      `transactionPrice.variableConsiderationComponents[${index}]`,
      `Variable consideration "${component.semanticKey}"`,
      out,
    );
  });

  // Step 4 — SSP and allocation.
  check(
    analysis.sspAndAllocation.relativeAllocationApplicable,
    "sspAndAllocation.relativeAllocationApplicable",
    "Relative-allocation applicability",
    out,
  );
  analysis.sspAndAllocation.items.forEach((item, index) => {
    check(item, `sspAndAllocation.items[${index}]`, `SSP assessment "${item.semanticKey}"`, out);
  });

  // Step 5 — recognition proposals.
  analysis.recognitionProposals.forEach((proposal, index) => {
    check(
      proposal,
      `recognitionProposals[${index}]`,
      `Recognition proposal for "${proposal.performanceObligationKey}"`,
      out,
    );
  });

  // Modifications — only when a modification is actually asserted.
  if (analysis.contractModifications.hasModification !== "no") {
    check(analysis.contractModifications, "contractModifications", "Modification conclusion", out);
  }

  // Billing mechanics and contractual collection assumptions.
  analysis.billingTerms.forEach((term, index) => {
    check(term, `billingTerms[${index}]`, `Billing term "${term.semanticKey}"`, out);
  });
  check(
    analysis.projectedCollectionAssumptions,
    "projectedCollectionAssumptions",
    "Projected-collection assumption",
    out,
  );

  // Additional ASC 606 topics — only those concluded applicable.
  analysis.additionalTopics.forEach((topic, index) => {
    if (topic.applicable === "no") return;
    check(topic, `additionalTopics[${index}]`, `Additional topic "${topic.topic}"`, out);
  });

  return out;
}
