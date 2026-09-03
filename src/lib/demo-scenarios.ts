/**
 * Demonstration sample contracts for manual testing.
 *
 * Presentation/demo data only: every scenario is expressed with the existing
 * WorkflowDraft shape and existing money-input conventions. No accounting
 * logic lives here, and each call returns a fresh independent draft.
 *
 * All companies, customers and amounts are fictional.
 */

import {
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  createConsiderationEventDraft,
  createCashCollectionDraft,
  STEP1_CRITERIA,
  type CashCollectionDraft,
  type ConsiderationEventDraft,
  type PoDraft,
  type PromiseDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

export type DemoScenarioId = "redwood" | "apex" | "horizon" | "stellar";

export interface DemoScenario {
  id: DemoScenarioId;
  customer: string;
  headline: string;
  description: string;
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: "redwood",
    customer: "Redwood Retail",
    headline: "Basic Annual SaaS",
    description: "A simple one-performance-obligation annual SaaS arrangement.",
  },
  {
    id: "apex",
    customer: "Apex Manufacturing",
    headline: "SaaS + Training",
    description: "Tests multiple performance obligations and relative SSP allocation.",
  },
  {
    id: "horizon",
    customer: "Horizon Logistics",
    headline: "Advance Billing",
    description:
      "Tests multiple obligations, contract assets/liabilities, billing, cash and journal entries.",
  },
  {
    id: "stellar",
    customer: "Stellar",
    headline: "Arrears Billing",
    description: "Tests contract assets, unbilled AR, billing transitions and journal entries.",
  },
];

export function isDemoScenarioId(value: unknown): value is DemoScenarioId {
  return DEMO_SCENARIOS.some((s) => s.id === value);
}

export function getDemoScenario(id: DemoScenarioId): DemoScenario {
  const found = DEMO_SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown demo scenario: ${String(id)}`);
  return found;
}

const RATIONALE = "Demonstration contract; criterion supported by the fictional contract terms.";

function answeredStep1(draft: WorkflowDraft): WorkflowDraft["contract"]["criteria"] {
  const criteria = { ...draft.contract.criteria };
  for (const criterion of STEP1_CRITERIA) {
    criteria[criterion.id] = { answer: true, rationale: RATIONALE };
  }
  return criteria;
}

function base(customer: string, contractNumber: string): WorkflowDraft {
  const draft = createEmptyDraft();
  return {
    ...draft,
    contract: {
      ...draft.contract,
      customerName: customer,
      contractNumber,
      criteria: answeredStep1(draft),
    },
  };
}

function distinctPromise(
  seq: number,
  id: string,
  description: string,
  poId: string,
): PromiseDraft {
  return {
    ...createPromiseDraft(seq, id),
    description,
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale:
      "The customer can benefit from the good or service on its own and it is not significantly integrated with the other promises.",
    performanceObligationId: poId,
  };
}

function overTimePo(
  seq: number,
  id: string,
  name: string,
  sspInput: string,
  serviceStart: string,
  serviceEnd: string,
): PoDraft {
  return {
    ...createPoDraft(seq, id),
    name,
    classification: "single_distinct",
    classificationRationale: "A single distinct promise transferred to the customer.",
    sspInput,
    sspBasis: "Observable standalone renewal pricing for comparable customers.",
    recognitionMethod: "over_time_ratable",
    serviceStart: serviceStart as PoDraft["serviceStart"],
    serviceEnd: serviceEnd as PoDraft["serviceEnd"],
    recognitionRationale:
      "The customer simultaneously receives and consumes the benefit as the entity performs.",
  };
}

function pointInTimePo(
  seq: number,
  id: string,
  name: string,
  sspInput: string,
  recognitionDate: string,
): PoDraft {
  return {
    ...createPoDraft(seq, id),
    name,
    classification: "single_distinct",
    classificationRationale: "A single distinct promise transferred to the customer.",
    sspInput,
    sspBasis: "Observable standalone price list for the service.",
    recognitionMethod: "point_in_time",
    recognitionDate: recognitionDate as PoDraft["recognitionDate"],
    recognitionRationale: "Control transfers when the service is delivered.",
  };
}

function billingEvent(
  seq: number,
  id: string,
  amountInput: string,
  unconditionalRightDate: string,
  invoiceDate: string,
): ConsiderationEventDraft {
  return {
    ...createConsiderationEventDraft(seq, id),
    amountInput,
    unconditionalRightDate: unconditionalRightDate as ConsiderationEventDraft["unconditionalRightDate"],
    invoiceDate: invoiceDate as ConsiderationEventDraft["invoiceDate"],
  };
}

function cashReceipt(
  seq: number,
  id: string,
  considerationEventId: string,
  amountInput: string,
  collectionDate: string,
): CashCollectionDraft {
  return {
    ...createCashCollectionDraft(seq, id),
    considerationEventId,
    amountInput,
    collectionDate: collectionDate as CashCollectionDraft["collectionDate"],
  };
}

function redwood(): WorkflowDraft {
  const draft = base("Redwood Retail", "DEMO-REDWOOD");
  const po = overTimePo(1, "po-saas", "SaaS subscription", "120,000.00", "2027-01-01", "2027-12-31");
  return {
    ...draft,
    transactionPriceInput: "120,000.00",
    transactionPriceNotes: "Fixed annual subscription fee; no variable consideration.",
    promises: [distinctPromise(1, "promise-saas", "Annual hosted SaaS subscription", po.id)],
    performanceObligations: [po],
  };
}

function apex(): WorkflowDraft {
  const draft = base("Apex Manufacturing", "DEMO-APEX");
  const saas = overTimePo(1, "po-saas", "SaaS subscription", "120,000.00", "2027-01-01", "2027-12-31");
  const training = pointInTimePo(2, "po-training", "Training", "20,000.00", "2027-01-15");
  return {
    ...draft,
    transactionPriceInput: "126,000.00",
    transactionPriceNotes: "Fixed bundled fee for the subscription and the training session.",
    promises: [
      distinctPromise(1, "promise-saas", "Annual hosted SaaS subscription", saas.id),
      distinctPromise(2, "promise-training", "One-day onsite employee training", training.id),
    ],
    performanceObligations: [saas, training],
  };
}

function horizon(): WorkflowDraft {
  const draft = base("Horizon Logistics", "DEMO-HORIZON");
  const saas = overTimePo(1, "po-saas", "SaaS subscription", "144,000.00", "2027-07-01", "2028-06-30");
  const training = overTimePo(2, "po-training", "Training", "12,000.00", "2027-07-10", "2027-07-11");
  const support = overTimePo(
    3,
    "po-support",
    "Premium Support",
    "24,000.00",
    "2027-07-01",
    "2028-06-30",
  );
  return {
    ...draft,
    transactionPriceInput: "153,000.00",
    transactionPriceNotes: "Fixed fee for the bundled subscription, training and premium support.",
    promises: [
      distinctPromise(1, "promise-saas", "Hosted SaaS subscription", saas.id),
      distinctPromise(2, "promise-training", "Implementation training", training.id),
      distinctPromise(3, "promise-support", "Premium support services", support.id),
    ],
    performanceObligations: [saas, training, support],
    contractBalances: {
      considerationEvents: [
        billingEvent(1, "billing-1", "75,000.00", "2027-07-01", "2027-07-01"),
        billingEvent(2, "billing-2", "39,000.00", "2028-01-01", "2028-01-01"),
        billingEvent(3, "billing-3", "39,000.00", "2028-04-01", "2028-04-01"),
      ],
      cashCollections: [
        cashReceipt(1, "cash-1", "billing-1", "75,000.00", "2027-07-31"),
        cashReceipt(2, "cash-2", "billing-2", "39,000.00", "2028-03-15"),
        cashReceipt(3, "cash-3", "billing-3", "39,000.00", "2028-04-30"),
      ],
    },
  };
}

function stellar(): WorkflowDraft {
  const draft = base("Stellar", "DEMO-STELLAR");
  const saas = overTimePo(1, "po-saas", "SaaS subscription", "240,000.00", "2027-01-01", "2027-12-31");
  return {
    ...draft,
    transactionPriceInput: "240,000.00",
    transactionPriceNotes: "Fixed annual fee invoiced quarterly in arrears.",
    promises: [distinctPromise(1, "promise-saas", "Annual hosted SaaS subscription", saas.id)],
    performanceObligations: [saas],
    contractBalances: {
      considerationEvents: [
        billingEvent(1, "billing-q1", "60,000.00", "2027-03-31", "2027-04-01"),
        billingEvent(2, "billing-q2", "60,000.00", "2027-06-30", "2027-07-01"),
        billingEvent(3, "billing-q3", "60,000.00", "2027-09-30", "2027-10-01"),
        billingEvent(4, "billing-q4", "60,000.00", "2027-12-31", "2028-01-01"),
      ],
      cashCollections: [
        cashReceipt(1, "cash-q1", "billing-q1", "60,000.00", "2027-04-30"),
        cashReceipt(2, "cash-q2", "billing-q2", "60,000.00", "2027-07-31"),
        cashReceipt(3, "cash-q3", "billing-q3", "60,000.00", "2027-10-31"),
        cashReceipt(4, "cash-q4", "billing-q4", "60,000.00", "2028-01-31"),
      ],
    },
  };
}

const BUILDERS: Record<DemoScenarioId, () => WorkflowDraft> = {
  redwood,
  apex,
  horizon,
  stellar,
};

/** Builds a fresh, fully editable WorkflowDraft for the requested sample. */
export function createDemoDraft(id: DemoScenarioId): WorkflowDraft {
  const build = BUILDERS[id];
  if (!build) throw new Error(`Unknown demo scenario: ${String(id)}`);
  return build();
}

/** Returns a fresh sample draft, or null when the value is not a known sample. */
export function createDemoDraftIfKnown(value: unknown): WorkflowDraft | null {
  return isDemoScenarioId(value) ? createDemoDraft(value) : null;
}
