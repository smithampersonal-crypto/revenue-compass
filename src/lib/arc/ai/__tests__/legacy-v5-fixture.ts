/**
 * Package 2C-A — historical `arc.ai.schema.v5` compatibility fixture.
 *
 * This is a hand-authored literal of a stored pre-2C analysis exactly as the
 * accepted v5 contract produced it. It is DELIBERATELY not derived from the
 * current v6 fixture with `accountingLabel` deleted: the point of this file is
 * to prove that a real historical payload — authored before the label contract
 * existed — still loads through the frozen v5 parser and never gains a
 * synthesized label.
 *
 * Do not add `accountingLabel` anywhere in this file. Do not "modernize" it.
 * Synthetic data only.
 */

export const LEGACY_V5_DOCUMENT_ID = "doc-legacy-northwind-1";

/** Typed as `unknown` on purpose: v5 is frozen history, not a live type. */
export const legacyV5Analysis: unknown = {
  schemaVersion: "arc.ai.schema.v5",
  analysisSummary:
    "Thirty-six month hosted logistics telemetry subscription with onboarding services.",
  logicalDocuments: [
    {
      semanticKey: "document:northwind-master",
      documentType: "master_agreement",
      title: "Northwind Telemetry Master Services Agreement",
      effectiveDate: "2025-04-01",
      relationshipToAgreement: "Governing master terms for the telemetry subscription.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text",
          excerpt: "Northwind Telemetry Master Services Agreement",
        },
      ],
      reviewState: "supported",
    },
  ],
  contractAssessment: {
    parties: [
      {
        semanticKey: "party:customer",
        name: "Northwind Freight Systems Inc.",
        role: "customer",
        citations: [
          {
            documentId: LEGACY_V5_DOCUMENT_ID,
            pageStart: 1,
            pageEnd: 1,
            evidenceMode: "text",
            excerpt: "Northwind Freight Systems Inc.",
          },
        ],
        reviewState: "supported",
      },
    ],
    contractReference: {
      value: "OF-2025-0417",
      rationale: "The order form prints its own reference number.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Order Form OF-2025-0417",
        },
      ],
      guidanceIds: [],
      reviewState: "supported",
    },
    contractEffectiveDate: {
      value: "2025-04-01",
      rationale: "Stated effective date of the master agreement.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text",
          excerpt: "Effective Date: April 1, 2025",
        },
      ],
      guidanceIds: [],
      reviewState: "supported",
    },
    contractTerm: {
      value: "36 months",
      rationale: "The order form states a thirty-six month term.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "36 Months",
        },
      ],
      guidanceIds: [],
      reviewState: "supported",
    },
    approvalAndCommitment: {
      outcome: "yes",
      rationale: "Both parties executed the master agreement.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text",
          excerpt: "Northwind Telemetry Master Services Agreement",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    identifiableRights: {
      outcome: "yes",
      rationale: "The agreement grants a defined right of access to the telemetry platform.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text",
          excerpt: "right to access the Telemetry Platform",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    identifiablePaymentTerms: {
      outcome: "yes",
      rationale: "Invoices are payable on stated net terms.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text",
          excerpt: "net forty-five (45) days",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    commercialSubstance: {
      outcome: "yes",
      rationale: "Consideration is exchanged for a substantive hosted service.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Annual Advance",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    collectibility: {
      outcome: "unknown",
      rationale: "The contract does not evidence the customer's ability to pay.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Annual Advance",
        },
      ],
      guidanceIds: [1],
      reviewState: "needs_user_input",
    },
    terminationRights: {
      value: "Termination for convenience on 90 days notice.",
      rationale: "Stated in the master agreement termination article.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 3,
          pageEnd: 3,
          evidenceMode: "text",
          excerpt: "ninety (90) days written notice",
        },
      ],
      guidanceIds: [],
      reviewState: "supported",
    },
    renewalTerms: {
      value: null,
      rationale: "No renewal mechanics are printed in the selected evidence.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Effective Term",
        },
      ],
      guidanceIds: [],
      reviewState: "needs_user_input",
    },
    currency: {
      value: "USD",
      rationale: "Amounts are stated in US dollars.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "$180,000/yr",
        },
      ],
      guidanceIds: [],
      reviewState: "supported",
    },
  },
  promises: [
    {
      semanticKey: "promise:telemetry-platform",
      description:
        "Access to the hosted telemetry platform for the thirty-six month subscription term, including standard updates made generally available.",
      promiseType: "hosted_service",
      otherPromiseTypeDescription: null,
      explicitOrImplicit: "explicit",
      distinctCapableOfBeingDistinct: "yes",
      distinctSeparatelyIdentifiable: "yes",
      distinctConclusion: "yes",
      distinctnessRationale: "The hosted platform benefits the customer on its own.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text",
          excerpt: "right to access the Telemetry Platform",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
  ],
  performanceObligations: [
    {
      semanticKey: "po:telemetry-platform",
      promiseKeys: ["promise:telemetry-platform"],
      description:
        "Provision of continuous access to the hosted telemetry platform across the stated subscription term.",
      groupingRationale: "Single distinct hosted service.",
      satisfactionPattern: "over_time",
      recognitionRationale: "The customer simultaneously receives and consumes the service.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text",
          excerpt: "right to access the Telemetry Platform",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
  ],
  transactionPrice: {
    currency: {
      value: "USD",
      rationale: "Amounts are stated in US dollars.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "$180,000/yr",
        },
      ],
      guidanceIds: [],
      reviewState: "supported",
    },
    fixedConsiderationInput: "540000.00",
    fixedConsiderationRationale: "Three annual advances of the stated annual value.",
    fixedConsiderationCitations: [
      {
        documentId: LEGACY_V5_DOCUMENT_ID,
        pageStart: 2,
        pageEnd: 2,
        evidenceMode: "visual",
        excerpt: null,
      },
    ],
    variableConsiderationComponents: [
      {
        semanticKey: "variable:telemetry-overage",
        description: "Overage above the contracted telemetry event tier.",
        type: "usage",
        contractualRateOrAmountInput: "0.0025",
        unitDescription: "per telemetry event",
        billingFrequency: "monthly",
        trigger: "Events processed above the contracted tier.",
        estimationMethodProposal: "not_estimable",
        initialEstimateBasis: "not_applicable_usage_as_incurred",
        initialEstimatedAmountInput: null,
        initialIncludedAmountInput: null,
        initialEstimateRationale: "Usage is measured as incurred.",
        constraintAssessment: "Future volumes are not determinable from the contract.",
        allocationTreatmentProposal: "specific_series_period",
        targetPerformanceObligationKey: "po:telemetry-platform",
        relatesSpecifically: "yes",
        consistentWithAllocationObjective: "yes",
        allocationRationale: "Each period's overage relates to that period's processing.",
        citations: [
          {
            documentId: LEGACY_V5_DOCUMENT_ID,
            pageStart: 2,
            pageEnd: 2,
            evidenceMode: "text",
            excerpt: "overage billed monthly at $0.0025 per event",
          },
        ],
        guidanceIds: [1],
        reviewState: "needs_user_input",
      },
    ],
    financingAssessment: {
      outcome: "no",
      rationale: "Annual advance billing is not a significant financing component.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Annual Advance",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    noncashConsideration: {
      outcome: "no",
      rationale: "All consideration is monetary.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Annual Advance",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    considerationPayableToCustomer: {
      outcome: "no",
      rationale: "No payment or credit to the customer is described.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 3,
          pageEnd: 3,
          evidenceMode: "text",
          excerpt: "Service credit percentage",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    transactionPriceConclusion: {
      conclusion: "Fixed term consideration plus constrained usage-based amounts.",
      rationale: "The order form states the annual value; overage is usage dependent.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "visual",
          excerpt: null,
        },
      ],
      guidanceIds: [1],
      reviewState: "inference",
    },
  },
  sspAndAllocation: {
    relativeAllocationApplicable: {
      outcome: "yes",
      rationale: "The order form prices the subscription separately.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Order Form OF-2025-0417",
        },
      ],
      guidanceIds: [1],
      reviewState: "supported",
    },
    items: [
      {
        semanticKey: "ssp:telemetry-platform",
        appliesToKey: "po:telemetry-platform",
        observableSspEvidence: "not_observable",
        observedAmountInput: null,
        proposedMethod: "stated_contract_price_assumption",
        proposedSspAmountInput: "540000.00",
        methodRationale: "The contract states a separate full-term price for the subscription.",
        missingInformation: "Standalone pricing history for the telemetry platform.",
        citations: [
          {
            documentId: LEGACY_V5_DOCUMENT_ID,
            pageStart: 2,
            pageEnd: 2,
            evidenceMode: "visual",
            excerpt: null,
          },
        ],
        guidanceIds: [1],
        reviewState: "inference",
      },
    ],
    discountOrVariableAllocationConsiderations: "No explicit discount is stated in the order form.",
  },
  recognitionProposals: [
    {
      performanceObligationKey: "po:telemetry-platform",
      satisfactionPattern: "over_time",
      recognitionMethod: "ratable_over_time",
      serviceStartDate: "2025-04-01",
      serviceEndDate: "2028-03-31",
      measureDescription: "Time elapsed over the subscription term.",
      recognitionEventDescription: null,
      recognitionDateIfContractuallyDeterminable: null,
      rationale: "Continuous access over a stated thirty-six month term.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Apr 1, 2025 - Mar 31, 2028",
        },
      ],
      guidanceIds: [1],
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
    citations: [
      {
        documentId: LEGACY_V5_DOCUMENT_ID,
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text",
        excerpt: "Northwind Telemetry Master Services Agreement",
      },
    ],
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
      amountOrRateInput: "180000.00",
      paymentTermsDays: 45,
      dueDateRule: "Net 45 from invoice date.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "text",
          excerpt: "Annual Advance ($180,000/yr Net 45)",
        },
      ],
      reviewState: "supported",
    },
  ],
  projectedCollectionAssumptions: {
    contractualDueDateBasis: "invoice_date_plus_terms",
    paymentTermsDays: 45,
    basisExplanation: "Invoices are payable net forty-five days from invoice date.",
    citations: [
      {
        documentId: LEGACY_V5_DOCUMENT_ID,
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text",
        excerpt: "net forty-five (45) days",
      },
    ],
    reviewState: "supported",
  },
  additionalTopics: [
    {
      topic: "licenses",
      applicable: "no",
      conclusion: "No license of intellectual property transfers to the customer.",
      rationale: "The provider retains all rights to the platform.",
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 3,
          pageEnd: 3,
          evidenceMode: "text",
          excerpt: "Provider retains all right, title and interest",
        },
      ],
      guidanceIds: [1],
      reviewState: "inference",
    },
  ],
  issues: [
    {
      semanticKey: "issue:collectibility-unknown",
      section: "step_1",
      reviewState: "needs_user_input",
      message: "Collectibility is not evidenced by the contract alone.",
      relatedSemanticKeys: ["po:telemetry-platform"],
      citations: [
        {
          documentId: LEGACY_V5_DOCUMENT_ID,
          pageStart: 2,
          pageEnd: 2,
          evidenceMode: "visual",
          excerpt: null,
        },
      ],
      guidanceIds: [1],
    },
  ],
};
