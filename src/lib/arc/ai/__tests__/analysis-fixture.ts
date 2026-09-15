/**
 * Deterministic valid `AiContractAnalysis` used by the Phase 9D regressions.
 * Hand-written, never model-produced, so schema/citation failures are provable.
 */

import type { AiContractAnalysis } from "../schema";
import { AI_OUTPUT_SCHEMA_VERSION } from "../schema";

export const FIXTURE_DOCUMENT_ID = "doc-genomix-1";

export const FIXTURE_PAGE_TEXT: Record<number, string> = {
  1: "Master Subscription Agreement. Effective Date: November 1, 2026. Provider grants Customer a worldwide, non-exclusive right to access the SaaS Platform. Fees are invoiced net thirty (30) days from invoice date.",
  2: "Provider retains all right, title and interest in and to the SaaS Platform. Nothing herein transfers source code to Customer.",
  3: "Order Form. Effective Term Nov 1, 2026 - Oct 31, 2028 (24 Months). Annual Advance ($245,000/yr Net 30). Tier 2 overage billed quarterly at $1.35/sample.",
  4: "Service Level Agreement. Provider guarantees monthly platform availability of 99.95%. Service credit percentage 15% credit, 30% credit, 50% credit.",
};

export const FIXTURE_PAGE_COUNT = 4;

function textCitation(page: number, excerpt: string) {
  return {
    documentId: FIXTURE_DOCUMENT_ID,
    pageStart: page,
    pageEnd: page,
    evidenceMode: "text" as const,
    excerpt,
  };
}

function visualCitation(page: number) {
  return {
    documentId: FIXTURE_DOCUMENT_ID,
    pageStart: page,
    pageEnd: page,
    evidenceMode: "visual" as const,
    excerpt: null,
  };
}

const guidanceIds = [1];

function judgment(outcome: "yes" | "no" | "unknown", page: number, excerpt: string) {
  return {
    outcome,
    rationale: "Supported by the executed agreement.",
    citations: [textCitation(page, excerpt)],
    guidanceIds,
    reviewState: "supported" as const,
  };
}

function fact(value: string | null, page: number, excerpt: string) {
  return {
    value,
    rationale: "Extracted administrative fact.",
    citations: [textCitation(page, excerpt)],
    guidanceIds: [] as number[],
    reviewState: "supported" as const,
  };
}

export function validAnalysisFixture(): AiContractAnalysis {
  return {
    schemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    analysisSummary: "Two-year hosted genomics SaaS subscription with validation and support.",
    logicalDocuments: [
      {
        semanticKey: "document:master-agreement",
        documentType: "master_agreement",
        title: "Master Subscription Agreement",
        effectiveDate: "2026-11-01",
        relationshipToAgreement: "Governing master terms for all order forms.",
        citations: [textCitation(1, "Master Subscription Agreement")],
        reviewState: "supported",
      },
    ],
    contractAssessment: {
      parties: [
        {
          semanticKey: "party:customer",
          name: "Genomix Clinical Diagnostics LLC",
          role: "customer",
          citations: [textCitation(1, "Customer")],
          reviewState: "supported",
        },
      ],
      contractEffectiveDate: fact("2026-11-01", 1, "Effective Date: November 1, 2026"),
      contractTerm: fact("24 months", 3, "24 Months"),
      approvalAndCommitment: judgment("yes", 1, "Master Subscription Agreement"),
      identifiableRights: judgment("yes", 1, "right to access the SaaS Platform"),
      identifiablePaymentTerms: judgment("yes", 1, "net thirty (30) days"),
      commercialSubstance: judgment("yes", 3, "Annual Advance"),
      collectibility: {
        outcome: "unknown",
        rationale: "The contract does not evidence the customer's ability to pay.",
        citations: [textCitation(3, "Annual Advance")],
        guidanceIds,
        reviewState: "needs_user_input",
      },
      terminationRights: fact(null, 2, "Provider retains all right"),
      renewalTerms: fact(null, 3, "Effective Term"),
      currency: fact("USD", 3, "$245,000/yr"),
    },
    promises: [
      {
        semanticKey: "promise:hosted-platform",
        description: "Access to the hosted variant-calling platform for the subscription term.",
        promiseType: "hosted_service",
        otherPromiseTypeDescription: null,
        explicitOrImplicit: "explicit",
        distinctCapableOfBeingDistinct: "yes",
        distinctSeparatelyIdentifiable: "yes",
        distinctConclusion: "yes",
        distinctnessRationale: "The hosted platform benefits the customer on its own.",
        citations: [textCitation(1, "access the SaaS Platform")],
        guidanceIds,
        reviewState: "supported",
      },
    ],
    performanceObligations: [
      {
        semanticKey: "po:hosted-platform",
        promiseKeys: ["promise:hosted-platform"],
        description: "Hosted platform access.",
        groupingRationale: "Single distinct hosted service.",
        satisfactionPattern: "over_time",
        recognitionRationale: "The customer simultaneously receives and consumes the service.",
        citations: [textCitation(1, "access the SaaS Platform")],
        guidanceIds,
        reviewState: "supported",
      },
    ],
    transactionPrice: {
      currency: fact("USD", 3, "$245,000/yr"),
      fixedConsiderationInput: "245000.00",
      fixedConsiderationRationale: "Annual contract value stated in the order form.",
      fixedConsiderationCitations: [visualCitation(3)],
      variableConsiderationComponents: [
        {
          semanticKey: "variable:throughput-overage",
          description: "Overage above the 50,000 sample tier.",
          type: "usage",
          contractualRateOrAmountInput: "1.35",
          unitDescription: "per sample",
          billingFrequency: "quarterly",
          trigger: "Samples processed above the contracted throughput tier.",
          estimationMethodProposal: "not_estimable",
          constraintAssessment: "Future volumes are not determinable from the contract.",
          citations: [textCitation(3, "overage billed quarterly at $1.35/sample")],
          guidanceIds,
          reviewState: "needs_user_input",
        },
      ],
      financingAssessment: judgment("no", 3, "Annual Advance"),
      noncashConsideration: judgment("no", 3, "Annual Advance"),
      considerationPayableToCustomer: judgment("no", 4, "Service credit percentage"),
      transactionPriceConclusion: {
        conclusion: "Fixed annual consideration plus constrained usage-based variable amounts.",
        rationale: "Order form states the fixed annual value; overage is usage dependent.",
        citations: [visualCitation(3)],
        guidanceIds,
        reviewState: "inference",
      },
    },
    sspAndAllocation: {
      relativeAllocationApplicable: judgment("yes", 3, "Order Form"),
      items: [
        {
          semanticKey: "ssp:hosted-platform",
          appliesToKey: "po:hosted-platform",
          observableSspEvidence: "not_observable",
          observedAmountInput: null,
          proposedMethod: "insufficient_information",
          methodRationale: "The contract does not evidence standalone selling prices.",
          missingInformation: "Standalone pricing history for the hosted platform.",
          citations: [visualCitation(3)],
          guidanceIds,
          reviewState: "needs_user_input",
        },
      ],
      discountOrVariableAllocationConsiderations:
        "No explicit discount is stated in the order form.",
    },
    recognitionProposals: [
      {
        performanceObligationKey: "po:hosted-platform",
        satisfactionPattern: "over_time",
        recognitionMethod: "ratable_over_time",
        serviceStartDate: "2026-11-01",
        serviceEndDate: "2028-10-31",
        measureDescription: "Time elapsed over the subscription term.",
        recognitionEventDescription: null,
        recognitionDateIfContractuallyDeterminable: null,
        rationale: "Continuous access over a stated 24-month term.",
        citations: [textCitation(3, "Nov 1, 2026 - Oct 31, 2028")],
        guidanceIds,
        reviewState: "supported",
      },
    ],
    contractModifications: {
      hasModification: "no",
      effectiveDate: null,
      addedGoodsOrServices: null,
      addedGoodsDistinct: "unknown",
      priceIncreaseInput: null,
      priceReflectsSsp: "unknown",
      remainingGoodsDistinct: "unknown",
      treatmentCandidate: "not_applicable",
      rationale: "No amendment is present in the selected evidence.",
      citations: [textCitation(1, "Master Subscription Agreement")],
      guidanceIds: [],
      reviewState: "supported",
    },
    billingTerms: [
      {
        semanticKey: "billing:annual-advance",
        description: "Annual advance invoice of the contracted annual value.",
        billingTiming: "advance",
        frequency: "annual",
        invoiceTrigger: "Start of each annual subscription period.",
        amountOrRateInput: "245000.00",
        paymentTermsDays: 30,
        dueDateRule: "Net 30 from invoice date.",
        citations: [textCitation(3, "Annual Advance ($245,000/yr Net 30)")],
        reviewState: "supported",
      },
    ],
    projectedCollectionAssumptions: {
      contractualDueDateBasis: "invoice_date_plus_terms",
      paymentTermsDays: 30,
      basisExplanation: "Invoices are payable net thirty days from invoice date.",
      citations: [textCitation(1, "net thirty (30) days from invoice date")],
      reviewState: "supported",
    },
    additionalTopics: [
      {
        topic: "licenses",
        applicable: "no",
        conclusion: "No license of intellectual property transfers to the customer.",
        rationale: "The provider retains all rights to the platform.",
        citations: [textCitation(2, "Provider retains all right, title and interest")],
        guidanceIds,
        reviewState: "inference",
      },
    ],
    issues: [
      {
        semanticKey: "issue:ssp-missing",
        section: "step_4",
        reviewState: "needs_user_input",
        message: "Standalone selling prices are not evidenced by the contract.",
        relatedSemanticKeys: ["po:hosted-platform"],
        citations: [visualCitation(3)],
        guidanceIds,
      },
    ],
  };
}
