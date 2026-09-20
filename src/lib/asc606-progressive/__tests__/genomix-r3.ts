/**
 * Phase 9G-R3 Part 2 — integrated synthetic Genomix fixture.
 *
 * Fictional demonstration data. No real customer, contract or amount.
 *
 *   fixed consideration            $490,000
 *   two annual fixed billings      $245,000 each, Net-30
 *   Hosted SaaS (series, ratable)  SSP $446,000, 11/1/2026 - 10/31/2028
 *   Validation package (point in time, transfer date not yet known) $29,600
 *   Support hours (over time, input measure, 300 hours)             $14,400
 *   Tier 2 usage overages          contractual rule known, no usage yet
 *   Monthly SLA credits            initial estimate $0, no trigger expected
 */

import type { ProgressiveContractInput } from "../contract";
import type { VcSeriesPeriod } from "../variable-consideration";

export const GENOMIX_FIXED_CENTS = 49_000_000;
export const GENOMIX_SAAS_CENTS = 44_600_000;
export const GENOMIX_VALIDATION_CENTS = 2_960_000;
export const GENOMIX_SUPPORT_CENTS = 1_440_000;

/** Contractual distinct service periods of the hosted series. */
export const GENOMIX_SERIES_PERIODS: VcSeriesPeriod[] = [
  { id: "y1", label: "Year 1 service period", startDate: "2026-11-01", endDate: "2027-10-31" },
  { id: "y2", label: "Year 2 service period", startDate: "2027-11-01", endDate: "2028-10-31" },
];

export function genomixR3Input(): ProgressiveContractInput {
  return {
    fixedConsiderationCents: GENOMIX_FIXED_CENTS,
    performanceObligations: [
      {
        id: "po-saas",
        seq: 1,
        name: "Hosted SaaS platform",
        sspCents: GENOMIX_SAAS_CENTS,
        sspConfidence: "provisional",
        isSeries: true,
        recognitionMethod: "over_time_ratable",
        serviceStart: "2026-11-01",
        serviceEnd: "2028-10-31",
      },
      {
        id: "po-validation",
        seq: 2,
        name: "Validation package",
        sspCents: GENOMIX_VALIDATION_CENTS,
        sspConfidence: "provisional",
        recognitionMethod: "point_in_time",
        // The transfer has not happened yet. No date is invented.
        transferDateUnknown: true,
      },
      {
        id: "po-support",
        seq: 3,
        name: "Support hours",
        sspCents: GENOMIX_SUPPORT_CENTS,
        sspConfidence: "provisional",
        recognitionMethod: "over_time_input_measure",
        totalExpectedUnits: 300,
        unitLabel: "hours",
        progressEvents: [],
      },
    ],
    variableComponents: [
      {
        id: "vc-sla",
        seq: 1,
        description: "Monthly SLA availability credits",
        effect: "decrease",
        treatment: "specific_series_period",
        targetPoId: "po-saas",
        seriesPeriods: GENOMIX_SERIES_PERIODS,
        // No availability failure is expected: the estimate is genuinely zero.
        estimateCents: 0,
        includedCents: 0,
      },
      {
        id: "vc-usage",
        seq: 2,
        description: "Tier 2 usage overages",
        effect: "increase",
        treatment: "specific_series_period",
        targetPoId: "po-saas",
        seriesPeriods: GENOMIX_SERIES_PERIODS,
        estimateCents: 0,
        includedCents: 0,
      },
    ],
    usage: [
      {
        rule: {
          componentId: "vc-usage",
          targetPoId: "po-saas",
          meters: [
            {
              id: "m-samples",
              seq: 1,
              name: "Tier 2 samples",
              rateAmountCents: 1_200,
              rateQuantity: 1,
              unit: "samples",
              includedQuantity: 0,
            },
          ],
          billing: { billOnRealization: true },
          seriesPeriods: GENOMIX_SERIES_PERIODS,
        },
        // No actual usage exists at inception. None is fabricated.
        actuals: [],
      },
    ],
    fixedBilling: [
      {
        id: "bill-y1",
        seq: 1,
        amountCents: 24_500_000,
        unconditionalRightDate: "2026-11-01",
        invoiceDate: "2026-11-01",
        paymentTermsDays: 30,
        description: "Year 1 annual fee",
      },
      {
        id: "bill-y2",
        seq: 2,
        amountCents: 24_500_000,
        unconditionalRightDate: "2027-11-01",
        invoiceDate: "2027-11-01",
        paymentTermsDays: 30,
        description: "Year 2 annual fee",
      },
    ],
    financing: {
      intervals: [
        { id: "y1", label: "Year 1 advance billing", days: 365 },
        { id: "y2", label: "Year 2 advance billing", days: 365 },
      ],
      practicalExpedientAccepted: true,
    },
  };
}

/** The accountant later records the validation transfer. */
export function withValidationTransfer(
  input: ProgressiveContractInput,
  date = "2027-03-15",
): ProgressiveContractInput {
  return {
    ...input,
    performanceObligations: input.performanceObligations.map((po) =>
      po.id === "po-validation" ? { ...po, transferDateUnknown: false, recognitionDate: date } : po,
    ),
  };
}

/** The accountant records actual support hours incurred. */
export function withSupportHours(
  input: ProgressiveContractInput,
  units = 150,
  date = "2027-01-31",
): ProgressiveContractInput {
  return {
    ...input,
    performanceObligations: input.performanceObligations.map((po) =>
      po.id === "po-support" ? { ...po, progressEvents: [{ id: "ph-1", date, units }] } : po,
    ),
  };
}

/** The accountant records actual Tier 2 usage for one month. */
export function withUsageActual(
  input: ProgressiveContractInput,
  quantity = 500,
): ProgressiveContractInput {
  return {
    ...input,
    usage: (input.usage ?? []).map((usage) => ({
      ...usage,
      actuals: [
        {
          id: "ua-2027-02",
          month: "2027-02",
          seriesPeriodId: "y1",
          date: "2027-02-28",
          quantitiesByMeterId: { "m-samples": quantity },
        },
      ],
    })),
  };
}

/** An SLA credit actually arises in one distinct service period. */
export function withRealizedSlaCredit(
  input: ProgressiveContractInput,
  amountCents = 150_000,
): ProgressiveContractInput {
  return {
    ...input,
    variableComponents: (input.variableComponents ?? []).map((component) =>
      component.id === "vc-sla"
        ? {
            ...component,
            estimateCents: amountCents,
            includedCents: amountCents,
            realizedEvents: [
              {
                id: "sla-2027-04",
                date: "2027-04-30",
                amountCents,
                seriesPeriodId: "y1",
                description: "April 2027 availability credit",
              },
            ],
          }
        : component,
    ),
  };
}
