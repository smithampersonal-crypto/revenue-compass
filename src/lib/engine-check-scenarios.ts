/**
 * Fictional demonstration contracts for the internal /engine-check page.
 * These are accountant-supplied INPUTS only — no accounting logic lives here.
 */
import type { Phase1ContractInput } from "@/lib/asc606";

export interface EngineCheckScenario {
  key: string;
  label: string;
  note: string;
  input: Phase1ContractInput;
}

export const ENGINE_CHECK_SCENARIOS: EngineCheckScenario[] = [
  {
    key: "a",
    label: "A — Basic Annual SaaS",
    note: "One SaaS performance obligation, $120,000 for calendar 2027, daily ratable.",
    input: {
      customerName: "Northwind Analytics (fictional)",
      contractNumber: "DEMO-A",
      transactionPriceCents: 12_000_000,
      performanceObligations: [
        {
          id: "po-saas",
          seq: 1,
          name: "SaaS subscription",
          sspCents: 12_000_000,
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-01-01",
          serviceEnd: "2027-12-31",
        },
      ],
    },
  },
  {
    key: "b",
    label: "B — Mid-Month SaaS",
    note: "$35,100 allocated to a single SaaS obligation running Jan 15 – Dec 31, 2027.",
    input: {
      customerName: "Cedar Peak Logistics (fictional)",
      contractNumber: "DEMO-B",
      transactionPriceCents: 3_510_000,
      performanceObligations: [
        {
          id: "po-saas",
          seq: 1,
          name: "SaaS subscription",
          sspCents: 3_510_000,
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-01-15",
          serviceEnd: "2027-12-31",
        },
      ],
    },
  },
  {
    key: "c",
    label: "C — SaaS + Training",
    note: "Two obligations: SaaS (SSP $120,000, over time) and training (SSP $20,000, point in time Jan 15, 2027).",
    input: {
      customerName: "Harborline Foods (fictional)",
      contractNumber: "DEMO-C",
      transactionPriceCents: 12_000_000,
      performanceObligations: [
        {
          id: "po-saas",
          seq: 1,
          name: "SaaS subscription",
          sspCents: 12_000_000,
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-01-01",
          serviceEnd: "2027-12-31",
        },
        {
          id: "po-training",
          seq: 2,
          name: "Implementation training",
          sspCents: 2_000_000,
          recognitionMethod: "point_in_time",
          recognitionDate: "2027-01-15",
        },
      ],
    },
  },
  {
    key: "d",
    label: "D — Equal SSP Penny Allocation",
    note: "$100,000 across three obligations with identical $10,000 SSPs; residual cent to the lowest sequence.",
    input: {
      customerName: "Bluefin Retail (fictional)",
      contractNumber: "DEMO-D",
      transactionPriceCents: 10_000_000,
      performanceObligations: [1, 2, 3].map((seq) => ({
        id: `po-${seq}`,
        seq,
        name: `Module ${seq}`,
        sspCents: 1_000_000,
        recognitionMethod: "over_time_ratable" as const,
        serviceStart: "2027-01-01",
        serviceEnd: "2027-12-31",
      })),
    },
  },
  {
    key: "e",
    label: "E — Invalid Input",
    note: "Service end date precedes the service start date; the engine must refuse to produce numbers.",
    input: {
      customerName: "Ridgeway Media (fictional)",
      contractNumber: "DEMO-E",
      transactionPriceCents: 5_000_000,
      performanceObligations: [
        {
          id: "po-saas",
          seq: 1,
          name: "SaaS subscription",
          sspCents: 5_000_000,
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-06-30",
          serviceEnd: "2027-01-01",
        },
      ],
    },
  },
];
