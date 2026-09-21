// Derived from the immutable production run stored in `ai_runs.result_metadata`.
// Run id: d3675d38-42ba-46e1-8384-4604f0b40310
// Sanitization: only the structural identity fields required by cross-run reconciliation are kept,
// and citation excerpts are reduced to the bounded validated excerpt normalized to lowercase with
// collapsed whitespace. No page corpus, prompt text, credentials or unrelated contract prose.

import type { ProductionRunFixture } from "./index";

export const runAFixture: ProductionRunFixture = {
  runId: "d3675d38-42ba-46e1-8384-4604f0b40310",
  label: "Run A — same-source re-analysis (restored)",
  promises: [
    {
      semanticKey: "promise_hosted_platform_and_included_throughput",
      promiseType: "hosted_service",
      description: "Stand-ready hosted access to the HelixFlow CLIA/CAP multi-tenant variant-calling platform during the subscription term, including the contracted capacity of up to 50,000 samples per year.",
      distinctConclusion: "yes",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 1, pageEnd: 1, normalizedExcerpt: "2.1 provision of access: subject to compliance with this agreement and payment of fees in applicable order forms, provider grants customer a worldwide, non-exclusive, non-transferable right during the subscription term to access and use the saas platform strictly for customer’s clia-certified genomic diagnostic workflows. 2.2 authorized users & identity governance:" },
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
    {
      semanticKey: "promise_validation_artifact_package",
      promiseType: "validation",
      description: "IQ/OQ/PQ computerized system validation evidence artifact package.",
      distinctConclusion: "yes",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
    {
      semanticKey: "promise_bioinformatics_support_hours",
      promiseType: "professional_service",
      description: "Dedicated clinical bioinformatics engineering support, stated as 40 hours in each annual commercial schedule.",
      distinctConclusion: "yes",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
  ],
  performanceObligations: [
    {
      semanticKey: "po_hosted_platform_series",
      description: "A series of stand-ready hosted SaaS platform-access services over the 24-month order-form term, including the annual 50,000-sample throughput capacity as a quantity/capacity attribute of that service.",
      promiseKeys: ["promise_hosted_platform_and_included_throughput"],
      satisfactionPattern: "over_time",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 1, pageEnd: 1, normalizedExcerpt: "2.1 provision of access: subject to compliance with this agreement and payment of fees in applicable order forms, provider grants customer a worldwide, non-exclusive, non-transferable right during the subscription term to access and use the saas platform strictly for customer’s clia-certified genomic diagnostic workflows. 2.2 authorized users & identity governance:" },
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 4, pageEnd: 4, normalizedExcerpt: "monthly uptime calculation formula uptime % = [(total calendar minutes − unscheduled pipeline downtime minutes) ÷ total calendar minutes] × 100 target commitment: provider guarantees monthly platform availability of 99.95% (“service commitment”). validated maintenance windows communicated ≥ 96 hours prior are excluded. 2. service credit schedule monthly measured availability % service credit percentage (% of monthly platform" },
      ],
    },
    {
      semanticKey: "po_validation_artifact_package",
      description: "IQ/OQ/PQ computerized system validation evidence artifact package.",
      promiseKeys: ["promise_validation_artifact_package"],
      satisfactionPattern: "point_in_time",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
    {
      semanticKey: "po_bioinformatics_support_services",
      description: "Dedicated clinical bioinformatics engineering support services up to the contracted hours.",
      promiseKeys: ["promise_bioinformatics_support_hours"],
      satisfactionPattern: "over_time",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 },
      ],
    },
  ],
  variableConsiderationComponents: [
    {
      semanticKey: "variable_throughput_overages",
      type: "usage",
      description: "Conditional Tier 2 specimen throughput overages beyond the included annual throughput tier.",
      unitDescription: "USD per sample for Tier 2 overage beyond the included annual 50,000-sample tier",
      billingFrequency: "quarterly",
      trigger: "Customer usage exceeds the contracted Tier 2 throughput allocation.",
      contractualRateOrAmountInput: "1.35",
      targetPerformanceObligationKey: "po_hosted_platform_series",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3, normalizedExcerpt: "1. specimen tier overtaking: tier 2 overage billed quarterly at $1.35/sample. 2. baa execution: hipaa baa attached as exhibit b governs phi ingress." },
      ],
    },
    {
      semanticKey: "variable_sla_service_credits",
      type: "service_credit",
      description: "Conditional monthly service credits of 15%, 30%, or 50% of the monthly platform fee when measured availability falls below the stated thresholds; credits require a written customer request within 15 days after month-end and are applied against subsequent quarterly invoices.",
      unitDescription: "Percentage of monthly recurring SaaS platform license fee: 15%, 30%, or 50%, depending on monthly measured availability",
      billingFrequency: "monthly",
      trigger: "Monthly measured availability is below 99.95% and Customer timely submits the required written request.",
      contractualRateOrAmountInput: null,
      targetPerformanceObligationKey: "po_hosted_platform_series",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 4, pageEnd: 4 },
      ],
    },
  ],
  billingTerms: [
    {
      semanticKey: "billing_fixed_annual_advance",
      description: "Fixed annual contract value billed annually in advance for the subscription package.",
      frequency: "annual",
      billingTiming: "advance",
      invoiceTrigger: "Each annual advance billing period under the order-form billing schedule.",
      dueDateRule: "Net 30 days from invoice date.",
      paymentTermsDays: 30,
      amountOrRateInput: "245000",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3, normalizedExcerpt: "order ref of-2026-syn-7718 (exec v2) effective term nov 1, 2026 – oct 31, 2028 (24 months) billing schedule annual advance ($245,000/yr net 30) account ae claire sterling (c.sterling@synthesisbio.com) sku / platform" },
      ],
    },
    {
      semanticKey: "billing_throughput_overage_quarterly",
      description: "Tier 2 specimen-throughput overage charge for usage beyond the included annual tier.",
      frequency: "quarterly",
      billingTiming: "on_usage",
      invoiceTrigger: "Tier 2 specimen throughput overage occurs; the order form states that overage is billed quarterly.",
      dueDateRule: "Net 30 days from invoice date.",
      paymentTermsDays: 30,
      amountOrRateInput: "1.35",
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3, normalizedExcerpt: "1. specimen tier overtaking: tier 2 overage billed quarterly at $1.35/sample. 2. baa execution: hipaa baa attached as exhibit b governs phi ingress." },
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 1, pageEnd: 1, normalizedExcerpt: "3.1 fees and invoicing: customer shall pay all fees specified in attachment a (order form). platform subscription fees and sequencing batch throughput overages are invoiced net thirty (30) days from invoice date via electronic wire transfer." },
      ],
    },
    {
      semanticKey: "billing_sla_credit_application",
      description: "Conditional SLA credit applied against a subsequent quarterly invoice after Customer submits a written request within 15 days of month-end.",
      frequency: "quarterly",
      billingTiming: "on_usage",
      invoiceTrigger: "Customer timely requests an earned service credit after a monthly availability result below the applicable threshold.",
      dueDateRule: null,
      paymentTermsDays: null,
      amountOrRateInput: null,
      citations: [
        { documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 4, pageEnd: 4, normalizedExcerpt: "fee*) 99.8% to < 99.95% 15% credit 99.5% to < 99.8% 30% credit < 99.5% 50% credit *service credits apply exclusively to recurring saas platform license fees and are credited against subsequent quarterly invoices upon customer written request submitted within fifteen (15) days of month-end. 3. clinical incident response & severity classification severity level definition initial response" },
      ],
    },
  ],
};
