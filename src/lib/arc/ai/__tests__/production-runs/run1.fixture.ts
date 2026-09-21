// Derived from the immutable production run stored in `ai_runs.result_metadata`.
// Run id: c7ba39d7-3e16-4de0-9178-454b8aadb781
// Sanitization: only the structural identity fields required by cross-run reconciliation are kept,
// and citation excerpts are reduced to the bounded validated excerpt normalized to lowercase with
// collapsed whitespace. No page corpus, prompt text, credentials or unrelated contract prose.

import type { ProductionRunFixture } from "./index";

export const run1Fixture: ProductionRunFixture = {
  runId: "c7ba39d7-3e16-4de0-9178-454b8aadb781",
  label: "Run 1 — accepted canonical analysis",
  promises: [
    {
      semanticKey: "hosted_platform_access",
      promiseType: "hosted_service",
      description:
        "Continuous access to the HelixFlow Cloud CLIA/CAP multi-tenant variant-calling suite for two sites during the subscription term, including the contracted annual high-throughput tier of up to 50,000 samples.",
      distinctConclusion: "yes",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 1,
          pageEnd: 1,
          normalizedExcerpt:
            "2.1 provision of access: subject to compliance with this agreement and payment of fees in applicable order forms, provider grants customer a worldwide, non-exclusive, non-transferable right during the subscription term to access and use the saas platform strictly for customer’s clia-certified genomic diagnostic workflows. 2.2 authorized users & identity governance:",
        },
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
    {
      semanticKey: "included_throughput_capacity",
      promiseType: "hosted_service",
      description:
        "Annual capacity of up to 50,000 samples under the high-throughput whole exome/genome tier.",
      distinctConclusion: "no",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
    {
      semanticKey: "gxp_validation_artifacts",
      promiseType: "validation",
      description: "IQ/OQ/PQ computerized-system validation evidence artifact package.",
      distinctConclusion: "yes",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
    {
      semanticKey: "clinical_bioinformatics_engineering_support",
      promiseType: "professional_service",
      description:
        "Dedicated clinical bioinformatics engineering support hours, stated as 40 hours annually.",
      distinctConclusion: "yes",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
  ],
  performanceObligations: [
    {
      semanticKey: "po_hosted_platform_series",
      description:
        "A series of daily hosted HelixFlow platform-access and availability services over the 24-month subscription term, at the contracted two-site scope and including up to 50,000 samples annually.",
      promiseKeys: ["hosted_platform_access", "included_throughput_capacity"],
      satisfactionPattern: "over_time",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 1,
          pageEnd: 1,
          normalizedExcerpt:
            "2.1 provision of access: subject to compliance with this agreement and payment of fees in applicable order forms, provider grants customer a worldwide, non-exclusive, non-transferable right during the subscription term to access and use the saas platform strictly for customer’s clia-certified genomic diagnostic workflows. 2.2 authorized users & identity governance:",
        },
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 4,
          pageEnd: 4,
          normalizedExcerpt:
            "target commitment: provider guarantees monthly platform availability of 99.95% (“service commitment”). validated maintenance windows communicated ≥ 96 hours prior are excluded. 2. service credit schedule monthly measured availability % service credit percentage (% of monthly platform",
        },
      ],
    },
    {
      semanticKey: "po_gxp_validation_artifacts",
      description: "IQ/OQ/PQ computerized-system validation evidence artifact package.",
      promiseKeys: ["gxp_validation_artifacts"],
      satisfactionPattern: "point_in_time",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
    {
      semanticKey: "po_engineering_support",
      description:
        "Dedicated clinical bioinformatics engineering support, stated as 40 hours annually.",
      promiseKeys: ["clinical_bioinformatics_engineering_support"],
      satisfactionPattern: "over_time",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
  ],
  variableConsiderationComponents: [
    {
      semanticKey: "throughput_overage",
      type: "usage",
      description:
        "Usage-based charge for sample throughput beyond the included annual high-throughput tier.",
      unitDescription: "USD per sample above the contracted annual throughput tier",
      billingFrequency: "quarterly",
      trigger:
        "Tier overtaking: sample usage exceeding the included tier; the order form states the overage is billed quarterly at $1.35 per sample.",
      contractualRateOrAmountInput: "1.35",
      targetPerformanceObligationKey: "po_hosted_platform_series",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 3,
          pageEnd: 3,
          normalizedExcerpt:
            "1. specimen tier overtaking: tier 2 overage billed quarterly at $1.35/sample. 2. baa execution: hipaa baa attached as exhibit b governs phi ingress.",
        },
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 1,
          pageEnd: 1,
          normalizedExcerpt:
            "3.1 fees and invoicing: customer shall pay all fees specified in attachment a (order form). platform subscription fees and sequencing batch throughput overages are invoiced net thirty (30) days from invoice date via electronic wire transfer.",
        },
      ],
    },
    {
      semanticKey: "sla_service_credits",
      type: "service_credit",
      description:
        "Credits against recurring SaaS platform license fees if monthly measured availability falls below 99.95%.",
      unitDescription:
        "15%, 30%, or 50% of the applicable monthly platform fee, based on the measured-availability tier",
      billingFrequency: "quarterly",
      trigger:
        "Monthly measured availability below 99.95%, followed by Customer's written request within 15 days after month-end; credit is applied against subsequent quarterly invoices.",
      contractualRateOrAmountInput: null,
      targetPerformanceObligationKey: "po_hosted_platform_series",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 4, pageEnd: 4 },
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 4,
          pageEnd: 4,
          normalizedExcerpt:
            "*service credits apply exclusively to recurring saas platform license fees and are credited against subsequent quarterly invoices upon customer written request submitted within fifteen (15) days of month-end. 3. clinical incident response & severity classification severity level definition initial response",
        },
      ],
    },
  ],
  billingTerms: [
    {
      semanticKey: "fixed_annual_advance_billing",
      description:
        "Fixed annual contract value billed annually in advance for the contracted subscription, validation package, and support-hours components.",
      frequency: "annual",
      billingTiming: "advance",
      invoiceTrigger: "Annual advance billing under the order-form billing schedule.",
      dueDateRule: "Net 30 days from invoice date.",
      paymentTermsDays: 30,
      amountOrRateInput: "245000",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 3,
          pageEnd: 3,
          normalizedExcerpt:
            "order ref of-2026-syn-7718 (exec v2) effective term nov 1, 2026 – oct 31, 2028 (24 months) billing schedule annual advance ($245,000/yr net 30) account ae claire sterling (c.sterling@synthesisbio.com) sku / platform",
        },
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 1,
          pageEnd: 1,
          normalizedExcerpt:
            "3.1 fees and invoicing: customer shall pay all fees specified in attachment a (order form). platform subscription fees and sequencing batch throughput overages are invoiced net thirty (30) days from invoice date via electronic wire transfer.",
        },
      ],
    },
    {
      semanticKey: "throughput_overage_billing",
      description:
        "Incremental specimen-tier overages billed quarterly at the stated per-sample rate.",
      frequency: "quarterly",
      billingTiming: "on_usage",
      invoiceTrigger: "Tier overtaking resulting in throughput above the included annual tier.",
      dueDateRule: "Net 30 days from invoice date.",
      paymentTermsDays: 30,
      amountOrRateInput: "1.35",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 3,
          pageEnd: 3,
          normalizedExcerpt:
            "1. specimen tier overtaking: tier 2 overage billed quarterly at $1.35/sample. 2. baa execution: hipaa baa attached as exhibit b governs phi ingress.",
        },
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 1,
          pageEnd: 1,
          normalizedExcerpt:
            "3.1 fees and invoicing: customer shall pay all fees specified in attachment a (order form). platform subscription fees and sequencing batch throughput overages are invoiced net thirty (30) days from invoice date via electronic wire transfer.",
        },
      ],
    },
    {
      semanticKey: "sla_credit_application",
      description:
        "SLA service credits are applied against subsequent quarterly invoices when Customer submits the required written request within 15 days of month-end.",
      frequency: "quarterly",
      billingTiming: "on_usage",
      invoiceTrigger:
        "Customer's timely written request following a monthly availability result within a service-credit tier.",
      dueDateRule: null,
      paymentTermsDays: null,
      amountOrRateInput: null,
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 4,
          pageEnd: 4,
          normalizedExcerpt:
            "*service credits apply exclusively to recurring saas platform license fees and are credited against subsequent quarterly invoices upon customer written request submitted within fifteen (15) days of month-end. 3. clinical incident response & severity classification severity level definition initial response",
        },
      ],
    },
  ],
  expectedCanonicalStructure: {
    promises: 4,
    performanceObligations: 3,
    variableConsiderationComponents: 2,
    considerationEvents: 2,
    projectedCollections: 2,
  },
};
