/**
 * Package 3D-Q.2 — synthetic "Test 03" contract (Cedar Analytics / Harbor
 * Medical Group pattern). Fictional companies and amounts.
 *
 * Three obligations: implementation (point in time), hosted subscription
 * (Jan 1 – Dec 31, 2027, over time) and training (completed Apr 15, 2027).
 * Fixed price $150,000; relative SSPs 30,000 / 120,000 / 10,000.
 */
import type { AiContractAnalysis } from "../schema";
import { genomixAnalysis, quote } from "./genomix-fixtures";

type Term = AiContractAnalysis["billingTerms"][number];

export const CEDAR_SUBSCRIPTION_SENTENCE =
  "The $120,000 hosted subscription fee will be invoiced in four equal quarterly installments in advance.";
export const CEDAR_COMMENCEMENT_SENTENCE =
  "The first quarterly installment is invoiced upon commencement of the subscription on January 1, 2027.";
export const CEDAR_TRAINING_SENTENCE =
  "The $6,000 training fee will be invoiced once, in full, upon completion of the training services.";
export const CEDAR_IMPLEMENTATION_SENTENCE =
  "Cedar will invoice $24,000 on January 1, 2027 for implementation services.";

const NEW_FIELDS = {
  targetPerformanceObligationKey: null,
  billingBasisTotalInput: null,
  installmentCount: null,
  equalInstallments: null,
  invoiceTriggerKind: "none",
} as const;

export function cedarTest03Analysis(): AiContractAnalysis {
  const base = genomixAnalysis();
  const [promise] = base.promises;
  const [po] = base.performanceObligations;
  const [overTime, pointInTime] = base.recognitionProposals;
  const [ssp] = base.sspAndAllocation.items;

  base.promises = [
    { ...promise!, semanticKey: "promise:implementation", description: "Implementation services", promiseType: "professional_service", citations: quote(2, CEDAR_IMPLEMENTATION_SENTENCE) },
    { ...promise!, semanticKey: "promise:subscription", description: "Hosted analytics subscription", citations: quote(2, CEDAR_SUBSCRIPTION_SENTENCE) },
    { ...promise!, semanticKey: "promise:training", description: "Training services", promiseType: "professional_service", citations: quote(3, CEDAR_TRAINING_SENTENCE) },
  ];
  base.performanceObligations = [
    { ...po!, semanticKey: "po:implementation", promiseKeys: ["promise:implementation"], description: "Implementation services", satisfactionPattern: "point_in_time", citations: quote(2, CEDAR_IMPLEMENTATION_SENTENCE) },
    { ...po!, semanticKey: "po:subscription", promiseKeys: ["promise:subscription"], description: "Hosted analytics subscription", citations: quote(2, CEDAR_SUBSCRIPTION_SENTENCE) },
    { ...po!, semanticKey: "po:training", promiseKeys: ["promise:training"], description: "Training services", satisfactionPattern: "point_in_time", citations: quote(3, CEDAR_TRAINING_SENTENCE) },
  ];
  base.recognitionProposals = [
    { ...pointInTime!, performanceObligationKey: "po:implementation", recognitionDateIfContractuallyDeterminable: "2027-01-31" },
    { ...overTime!, performanceObligationKey: "po:subscription", serviceStartDate: "2027-01-01", serviceEndDate: "2027-12-31" },
    { ...pointInTime!, performanceObligationKey: "po:training", recognitionDateIfContractuallyDeterminable: "2027-04-15" },
  ];
  base.sspAndAllocation.items = [
    { ...ssp!, semanticKey: "ssp:implementation", appliesToKey: "po:implementation", observedAmountInput: "30000" },
    { ...ssp!, semanticKey: "ssp:subscription", appliesToKey: "po:subscription", observedAmountInput: "120000" },
    { ...ssp!, semanticKey: "ssp:training", appliesToKey: "po:training", observedAmountInput: "10000" },
  ];
  base.transactionPrice.fixedConsiderationInput = "150000";
  base.transactionPrice.variableConsiderationComponents = [];

  const common = {
    paymentTermsDays: 30,
    dueDateRule: "Net 30 from invoice date.",
    reviewState: "supported",
    amountKind: "fixed_invoice_amount",
    explicitInvoices: [],
  } as const;
  const implementation: Term = {
    ...common,
    ...NEW_FIELDS,
    semanticKey: "billing:implementation",
    description: "Implementation fee invoice.",
    billingTiming: "advance",
    frequency: "one_time",
    invoiceTrigger: "Stated invoice date.",
    amountOrRateInput: null,
    citations: quote(2, CEDAR_IMPLEMENTATION_SENTENCE),
    explicitInvoices: [
      { invoiceDateInput: "2027-01-01", amountInput: "24000", coveragePeriodText: null, citations: quote(2, CEDAR_IMPLEMENTATION_SENTENCE) },
    ],
  } as Term;
  const subscription: Term = {
    ...common,
    semanticKey: "billing:subscription",
    description: "Hosted subscription in four equal quarterly installments.",
    billingTiming: "advance",
    frequency: "quarterly",
    invoiceTrigger: "Quarterly in advance; first installment upon commencement.",
    amountOrRateInput: null,
    citations: [...quote(2, CEDAR_SUBSCRIPTION_SENTENCE), ...quote(2, CEDAR_COMMENCEMENT_SENTENCE)],
    targetPerformanceObligationKey: "po:subscription",
    billingBasisTotalInput: "120000",
    installmentCount: 4,
    equalInstallments: true,
    invoiceTriggerKind: "commencement",
  } as Term;
  const training: Term = {
    ...common,
    semanticKey: "billing:training",
    description: "Training fee invoiced upon completion.",
    billingTiming: "milestone",
    frequency: "one_time",
    invoiceTrigger: "Upon completion of training.",
    amountOrRateInput: "6000",
    citations: quote(3, CEDAR_TRAINING_SENTENCE),
    targetPerformanceObligationKey: "po:training",
    billingBasisTotalInput: null,
    installmentCount: null,
    equalInstallments: null,
    invoiceTriggerKind: "completion_of_linked_obligation",
  } as Term;
  base.billingTerms = [implementation, subscription, training];
  return base;
}
