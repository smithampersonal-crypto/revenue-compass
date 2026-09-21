// Derived from the immutable production run stored in `ai_runs.result_metadata`.
// Run id: ccd364d3-a283-41d7-ad6f-851ce4142f8d
// Sanitization: only the structural identity fields required by cross-run reconciliation are kept,
// and citation excerpts are reduced to the bounded validated excerpt normalized to lowercase with
// collapsed whitespace. No page corpus, prompt text, credentials or unrelated contract prose.

import type { ProductionRunFixture } from "./index";

export const runBFixture: ProductionRunFixture = {
  runId: "ccd364d3-a283-41d7-ad6f-851ce4142f8d",
  label: "Run B — same-source re-analysis (duplicated canonical rows)",
  promises: [
    {
      semanticKey: "promise_hosted_platform_and_included_throughput",
      promiseType: "hosted_service",
      description:
        "Continuous access to the HelixFlow Cloud clinical SaaS platform, including the contracted two-site platform tier and up to 50,000 samples per year of included throughput capacity.",
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
      semanticKey: "promise_validation_artifact_package",
      promiseType: "validation",
      description: "IQ/OQ/PQ computerized-system validation evidence artifact package.",
      distinctConclusion: "yes",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 1,
          pageEnd: 1,
          normalizedExcerpt:
            "1.3 “documentation” means provider’s validated bioinformatics pipeline manuals, gxp validation packages, and api schema specifications.",
        },
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
    {
      semanticKey: "promise_bioinformatics_engineering_support",
      promiseType: "support",
      description:
        "Dedicated clinical bioinformatics engineering support for 40 hours per annual order-form schedule.",
      distinctConclusion: "yes",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
  ],
  performanceObligations: [
    {
      semanticKey: "po_hosted_platform_service_series",
      description:
        "Series of distinct stand-ready hosted SaaS platform access services, with included throughput capacity as a feature of that service.",
      promiseKeys: ["promise_hosted_platform_and_included_throughput"],
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
          pageStart: 1,
          pageEnd: 1,
          normalizedExcerpt:
            "2.4 service availability & maintenance: provider shall maintain monthly infrastructure availability of not less than 99.95% excluding validated scheduled maintenance windows announced ≥ 96 hours in prior coordination. 3. commercial terms, fees, and taxes",
        },
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
    {
      semanticKey: "po_validation_artifact_package",
      description: "IQ/OQ/PQ computerized-system validation evidence artifact package.",
      promiseKeys: ["promise_validation_artifact_package"],
      satisfactionPattern: "point_in_time",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
    {
      semanticKey: "po_bioinformatics_engineering_support",
      description: "Dedicated clinical bioinformatics engineering support hours.",
      promiseKeys: ["promise_bioinformatics_engineering_support"],
      satisfactionPattern: "over_time",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    },
  ],
  variableConsiderationComponents: [
    {
      semanticKey: "variable_throughput_overages",
      type: "usage",
      description:
        "Tier 2 specimen throughput overages for samples above the included 50,000-samples-per-year tier.",
      unitDescription: "per sample above the included tier",
      billingFrequency: "quarterly",
      trigger:
        "Customer usage exceeds the contracted throughput tier; the order form states that Tier 2 overages are billed quarterly.",
      contractualRateOrAmountInput: "1.35",
      targetPerformanceObligationKey: "po_hosted_platform_service_series",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 3,
          pageEnd: 3,
          normalizedExcerpt:
            "enterprise helixflow clia/cap multi-tenant variant calling suite 2 sites $82,000.00 $164,000.00 syn-ngs-thru-50k high-throughput whole exome/genome tier (up to 50,000 samples/yr) 50k samples $1.18 / sample $59,000.00 syn-valid-pkg-gxp iq/oq/pq computerized system validation evidence artifact package 1 package $14,800.00 $14,800.00 prof-bioinfo- consult dedicated clinical bioinformatics engineering support",
        },
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 3,
          pageEnd: 3,
          normalizedExcerpt:
            "hours 40 hours $180.00 / hr $7,200.00 total annual contract value (acv — usd): $245,000.00 governing scope & commercial exceptions: 1. specimen tier overtaking: tier 2 overage billed quarterly at $1.35/sample. 2. baa execution: hipaa baa attached as exhibit b governs phi ingress.",
        },
      ],
    },
    {
      semanticKey: "variable_sla_service_credits",
      type: "service_credit",
      description:
        "Service credits of 15%, 30%, or 50% of the monthly recurring SaaS platform license fee, depending on monthly measured availability, if timely requested by Customer.",
      unitDescription:
        "15%, 30%, or 50% of monthly recurring SaaS platform license fees, based on the stated availability bands",
      billingFrequency: "quarterly",
      trigger:
        "Monthly platform availability falls below 99.95% and Customer submits a written request within 15 days of month-end; the credit is applied against subsequent quarterly invoices.",
      contractualRateOrAmountInput: null,
      targetPerformanceObligationKey: "po_hosted_platform_service_series",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 4,
          pageEnd: 4,
          normalizedExcerpt:
            "target commitment: provider guarantees monthly platform availability of 99.95% (“service commitment”). validated maintenance windows communicated ≥ 96 hours prior are excluded. 2. service credit schedule monthly measured availability % service credit percentage (% of monthly platform fee*) 99.8% to < 99.95% 15% credit 99.5% to < 99.8% 30% credit < 99.5% 50% credit",
        },
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
      semanticKey: "billing_fixed_annual_advance",
      description:
        "All fixed order-form fees are billed as one annual advance amount of 245000 per year during the 24-month term; the schedule states net 30.",
      frequency: "annual",
      billingTiming: "advance",
      invoiceTrigger:
        "Beginning of each annual service period, as indicated by the annual-advance billing schedule.",
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
      semanticKey: "billing_throughput_overage_quarterly",
      description: "Tier 2 throughput overages are billed quarterly at 1.35 per excess sample.",
      frequency: "quarterly",
      billingTiming: "on_usage",
      invoiceTrigger: "Excess usage above the contracted throughput tier is billed quarterly.",
      dueDateRule: "Net 30 days from invoice date.",
      paymentTermsDays: 30,
      amountOrRateInput: "1.35",
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 3,
          pageEnd: 3,
          normalizedExcerpt:
            "hours 40 hours $180.00 / hr $7,200.00 total annual contract value (acv — usd): $245,000.00 governing scope & commercial exceptions: 1. specimen tier overtaking: tier 2 overage billed quarterly at $1.35/sample. 2. baa execution: hipaa baa attached as exhibit b governs phi ingress.",
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
      semanticKey: "billing_sla_credit",
      description:
        "A qualifying, timely requested SLA service credit is credited against subsequent quarterly invoices; the credit percentage depends on the monthly availability band.",
      frequency: "quarterly",
      billingTiming: "on_usage",
      invoiceTrigger:
        "Customer submits a written service-credit request within 15 days after a month-end in which the applicable availability threshold is not met.",
      dueDateRule:
        "Applied as a credit against subsequent quarterly invoices; no separate payment due date is stated.",
      paymentTermsDays: null,
      amountOrRateInput: null,
      citations: [
        {
          documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
          pageStart: 4,
          pageEnd: 4,
          normalizedExcerpt:
            "fee*) 99.8% to < 99.95% 15% credit 99.5% to < 99.8% 30% credit < 99.5% 50% credit *service credits apply exclusively to recurring saas platform license fees and are credited against subsequent quarterly invoices upon customer written request submitted within fifteen (15) days of month-end. 3. clinical incident response & severity classification severity level definition initial response",
        },
      ],
    },
  ],
};
