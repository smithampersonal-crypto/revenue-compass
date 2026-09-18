/**
 * Phase 9G-R Task R1 deterministic benchmark fixtures.
 *
 * Hand-authored synthetic analyses in the shape of the reviewed Genomix
 * contract. They are never produced by a model and never call a provider.
 * All companies, references and amounts are fictional demonstration data.
 */

import { AI_OUTPUT_SCHEMA_VERSION, type AiContractAnalysis } from "../schema";

export const R1_RUN_ID = "run-00000000-0000-4000-8000-000000000011";

const DOC = "doc-r1-fixture-1";

function cite(page: number, excerpt: string) {
  return {
    documentId: DOC,
    pageStart: page,
    pageEnd: page,
    evidenceMode: "text" as const,
    excerpt,
  };
}

function judgment(outcome: "yes" | "no" | "unknown", rationale: string) {
  return {
    outcome,
    rationale,
    citations: [cite(1, "Order Form")],
    guidanceIds: [1],
    reviewState: "supported" as const,
  };
}

function fact(value: string | null, rationale: string) {
  return {
    value,
    rationale,
    citations: [cite(1, "Order Form")],
    guidanceIds: [] as number[],
    reviewState: "supported" as const,
  };
}

export const R1_SAAS_PO_KEY = "po:saas-platform";
export const R1_CONTRACT_REFERENCE = "OF-2026-SYN-7718";

/**
 * 24-month term, $245,000 billed annually in advance, plus a per-sample
 * overage and an SLA service credit that the contract narrows to the
 * recurring platform fee.
 */
export function genomixR1Analysis(): AiContractAnalysis {
  return {
    schemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    analysisSummary: "Two-year hosted genomics platform subscription with overage and SLA credits.",
    logicalDocuments: [
      {
        semanticKey: "document:order-form",
        documentType: "order_form",
        title: "Order Form",
        effectiveDate: "2026-11-01",
        relationshipToAgreement: "Establishes the commercial term and pricing.",
        citations: [cite(1, "Order Form")],
        reviewState: "supported",
      },
    ],
    contractAssessment: {
      parties: [
        {
          semanticKey: "party:customer",
          name: "Genomix Clinical Diagnostics LLC",
          role: "customer",
          citations: [cite(1, "Genomix Clinical Diagnostics LLC")],
          reviewState: "supported",
        },
      ],
      contractReference: fact(R1_CONTRACT_REFERENCE, "Executed order-form reference."),
      contractEffectiveDate: fact("2026-11-01", "Stated effective date."),
      contractTerm: fact("24 months", "Stated term."),
      approvalAndCommitment: judgment("yes", "Both parties executed the order form."),
      identifiableRights: judgment("yes", "Access rights are specified."),
      identifiablePaymentTerms: judgment("yes", "Annual fee payable net thirty days."),
      commercialSubstance: judgment("yes", "Cash flows change as a result of the contract."),
      collectibility: judgment("yes", "The customer is an established paying account."),
      terminationRights: fact(null, "No termination for convenience is stated."),
      renewalTerms: fact(null, "No automatic renewal is stated."),
      currency: fact("USD", "Amounts are stated in US dollars."),
    },
    promises: [
      {
        semanticKey: "promise:saas-platform",
        description: "Hosted platform access with included processing capacity",
        promiseType: "hosted_service",
        otherPromiseTypeDescription: null,
        explicitOrImplicit: "explicit",
        distinctCapableOfBeingDistinct: "yes",
        distinctSeparatelyIdentifiable: "yes",
        distinctConclusion: "yes",
        distinctnessRationale: "Benefit available on its own; not significantly integrated.",
        citations: [cite(1, "hosted platform")],
        guidanceIds: [11],
        reviewState: "supported",
      },
    ],
    performanceObligations: [
      {
        semanticKey: R1_SAAS_PO_KEY,
        promiseKeys: ["promise:saas-platform"],
        description: "Hosted platform subscription",
        groupingRationale: "Single distinct hosted service.",
        satisfactionPattern: "over_time",
        recognitionRationale: "The customer simultaneously receives and consumes the service.",
        citations: [cite(1, "hosted platform")],
        guidanceIds: [11],
        reviewState: "supported",
      },
    ],
    transactionPrice: {
      currency: fact("USD", "Amounts are stated in US dollars."),
      // Deliberately the ANNUAL amount: R1 proves ARC derives the full term.
      fixedConsiderationInput: "245000",
      fixedConsiderationRationale: "The order form states an annual subscription fee.",
      fixedConsiderationCitations: [cite(1, "245,000 per year")],
      variableConsiderationComponents: [
        {
          semanticKey: "vc:sample-overage",
          description: "Excess sample processing overage",
          type: "usage",
          contractualRateOrAmountInput: "1.35",
          unitDescription: "per sample",
          billingFrequency: "quarterly",
          trigger: "Samples processed above the included annual tier.",
          estimationMethodProposal: "unknown",
          constraintAssessment: "Usage is recognized as it occurs.",
          allocationTreatmentProposal: "specific_series_period",
          targetPerformanceObligationKey: R1_SAAS_PO_KEY,
          relatesSpecifically: "yes",
          consistentWithAllocationObjective: "yes",
          allocationRationale:
            "Each period's overage relates specifically to the processing performed in that period.",
          citations: [cite(1, "1.35 per sample")],
          guidanceIds: [25],
          reviewState: "supported",
        },
        {
          semanticKey: "vc:sla-service-credit",
          description: "Availability service credit",
          type: "service_credit",
          contractualRateOrAmountInput: null,
          unitDescription: null,
          billingFrequency: "monthly",
          trigger: "Monthly availability below the committed level.",
          estimationMethodProposal: "expected_value",
          constraintAssessment: "Credits are constrained to amounts probable of being incurred.",
          allocationTreatmentProposal: "specific_po",
          targetPerformanceObligationKey: R1_SAAS_PO_KEY,
          relatesSpecifically: "yes",
          consistentWithAllocationObjective: "yes",
          allocationRationale:
            "The credit applies exclusively to the recurring platform license fees.",
          citations: [cite(1, "service credit")],
          guidanceIds: [25],
          reviewState: "supported",
        },
      ],
      financingAssessment: judgment("no", "Payment occurs within one year of transfer."),
      noncashConsideration: judgment("no", "Consideration is entirely cash."),
      considerationPayableToCustomer: judgment("no", "No amounts are payable to the customer."),
      transactionPriceConclusion: {
        conclusion: "The fixed transaction price is the enforceable subscription consideration.",
        rationale: "Overage and credits are variable consideration.",
        citations: [cite(1, "245,000 per year")],
        guidanceIds: [25],
        reviewState: "supported",
      },
    },
    sspAndAllocation: {
      relativeAllocationApplicable: judgment("no", "A single performance obligation exists."),
      items: [
        {
          semanticKey: "ssp:saas-platform",
          appliesToKey: R1_SAAS_PO_KEY,
          observableSspEvidence: "observable",
          observedAmountInput: "490000",
          proposedMethod: "observable_price",
          methodRationale: "Observable standalone renewal pricing.",
          missingInformation: "None.",
          citations: [cite(1, "245,000 per year")],
          guidanceIds: [44],
          reviewState: "supported",
        },
      ],
      discountOrVariableAllocationConsiderations: "No discount is stated.",
    },
    recognitionProposals: [
      {
        performanceObligationKey: R1_SAAS_PO_KEY,
        satisfactionPattern: "over_time",
        recognitionMethod: "ratable_over_time",
        serviceStartDate: "2026-11-01",
        serviceEndDate: "2028-10-31",
        measureDescription: "Time elapsed.",
        recognitionEventDescription: null,
        recognitionDateIfContractuallyDeterminable: null,
        rationale: "Customer simultaneously receives and consumes the hosted service.",
        citations: [cite(1, "term")],
        guidanceIds: [58],
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
      rationale: "No amendment is present.",
      citations: [cite(1, "Order Form")],
      guidanceIds: [],
      reviewState: "supported",
    },
    billingTerms: [
      {
        semanticKey: "billing:annual-advance",
        description: "Annual advance subscription invoice.",
        billingTiming: "advance",
        frequency: "annual",
        invoiceTrigger: "Start of each annual period.",
        amountOrRateInput: "245000",
        paymentTermsDays: 30,
        dueDateRule: "Net 30 from invoice date.",
        citations: [cite(1, "Net 30")],
        reviewState: "supported",
      },
      {
        semanticKey: "billing:overage",
        description: "Quarterly overage invoice.",
        billingTiming: "on_usage",
        frequency: "quarterly",
        invoiceTrigger: "Samples processed above the included tier.",
        amountOrRateInput: "1.35",
        paymentTermsDays: 30,
        dueDateRule: "Net 30 from invoice date.",
        citations: [cite(1, "1.35 per sample")],
        reviewState: "supported",
      },
    ],
    projectedCollectionAssumptions: {
      contractualDueDateBasis: "invoice_date_plus_terms",
      paymentTermsDays: 30,
      basisExplanation: "Invoices are payable net thirty days from invoice date.",
      citations: [cite(1, "Net 30")],
      reviewState: "supported",
    },
    additionalTopics: [],
    issues: [],
  };
}
