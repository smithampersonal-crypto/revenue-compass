/**
 * Phase 9G-R3 Part 2, Stage A / C — workflow draft to progressive engine input.
 *
 * The draft stores FACTS only. Nothing derived is written back into it: every
 * amount, percentage, schedule row and balance is calculated by the
 * deterministic engines from these facts each time.
 *
 * Operational actuals (hours incurred, usage quantities, realized variable
 * amounts, transfer dates) are accountant-owned. This adapter reads them; it
 * never invents, defaults or back-fills one.
 *
 * FAIL-CLOSED: a fact that cannot be used is reported as a blocked fact with
 * its owner's identity and reason. An obligation, component, meter, period,
 * actual or billing event is NEVER dropped because one of its facts is
 * unusable, and missing fixed consideration is never coerced to $0.
 */

import { isValidIsoDate, type Cents } from "@/lib/asc606";
import type {
  ProgressiveContractInput,
  ProgressiveContractPo,
  ProgressiveUsageInput,
} from "@/lib/asc606-progressive";
import type {
  ProgressiveCashCollection,
  ProgressiveVcComponent,
  VcSeriesPeriod,
} from "@/lib/asc606-progressive";

import { parseUsageQuantity, parseUsdToCents } from "./money-input";
import { buildEstimatedLifecycle, usesAcceptedLifecycle } from "./vc-lifecycle";
import { previewVcCurrentMeasurement } from "./vc-measurement";
import type { PoDraft, VcComponentDraft, WorkflowDraft } from "./types";
import { variableConsiderationDisplayLabel } from "./vc-presentation";

/** Who owns a fact that could not be used. */
export type BlockedFactOwner =
  | "contract"
  | "performance_obligation"
  | "progress_event"
  | "variable_component"
  | "series_period"
  | "realized_event"
  | "usage_meter"
  | "usage_actual"
  | "billing_event";

export interface BlockedFact {
  ownerKind: BlockedFactOwner;
  ownerId: string;
  ownerName: string;
  /** Deterministic reason code, for example "ssp.unusable". */
  code: string;
  message: string;
}

export type ProgressiveInputResult =
  | { ok: true; input: ProgressiveContractInput; blocked: BlockedFact[] }
  | { ok: false; input: null; blocked: BlockedFact[] };

/** Marker value: present but unusable. Every dependent calculation blocks. */
const UNUSABLE = Number.NaN;

function cents(raw: string | undefined): Cents | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = parseUsdToCents(raw);
  return parsed.ok ? parsed.cents : null;
}

function quantity(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = parseUsageQuantity(raw);
  return parsed.ok ? parsed.value : null;
}

/**
 * A calendar date the accountant actually entered. ARC's canonical strict
 * calendar validation is the only definition of validity: 2027-02-29 and
 * 2027-02-30 are rejected, 2028-02-29 is accepted.
 */
function isUsableDate(raw: string | undefined): boolean {
  return isValidIsoDate(raw);
}

/** The R3 recognition method implied by the accepted workflow facts. */
export function progressiveRecognitionMethod(
  po: PoDraft,
): ProgressiveContractPo["recognitionMethod"] | null {
  if (po.recognitionMethod === "over_time_ratable") {
    return po.overTimeMeasure === "input_measure" ? "over_time_input_measure" : "over_time_ratable";
  }
  return po.recognitionMethod;
}

function toProgressivePo(po: PoDraft, blocked: BlockedFact[]): ProgressiveContractPo {
  const method = progressiveRecognitionMethod(po);
  const ssp = cents(po.sspInput);
  const name = po.name || po.id;

  if (method === null) {
    blocked.push({
      ownerKind: "performance_obligation",
      ownerId: po.id,
      ownerName: name,
      code: "recognition_method.absent",
      message: `"${name}" needs a recognition method before its revenue can be scheduled.`,
    });
  }
  if (ssp === null) {
    blocked.push({
      ownerKind: "performance_obligation",
      ownerId: po.id,
      ownerName: name,
      code: "ssp.unusable",
      message: `"${name}" needs a usable standalone selling price before the transaction price can be allocated.`,
    });
  }

  const base: ProgressiveContractPo = {
    id: po.id,
    seq: po.seq,
    name,
    sspCents: ssp ?? UNUSABLE,
    // An absent method still keeps the obligation present; its schedule blocks.
    recognitionMethod: method ?? "point_in_time",
    isSeries: po.classification === "series",
  };

  if (method === "over_time_ratable") {
    if (po.serviceStart) base.serviceStart = po.serviceStart;
    if (po.serviceEnd) base.serviceEnd = po.serviceEnd;
  }

  if (method === "over_time_input_measure") {
    const total = quantity(po.totalExpectedUnitsInput);
    if (total === null) {
      blocked.push({
        ownerKind: "performance_obligation",
        ownerId: po.id,
        ownerName: name,
        code: "input_measure.denominator",
        message: `"${name}" is measured by inputs, so it needs a total expected quantity.`,
      });
    } else {
      base.totalExpectedUnits = total;
    }
    base.unitLabel = po.unitLabel && po.unitLabel !== "" ? po.unitLabel : "units";
    const events: { id: string; date: string; units: number }[] = [];
    for (const event of po.progressEvents ?? []) {
      const units = quantity(event.unitsInput);
      const entered = event.date !== "" || event.unitsInput.trim() !== "";
      if (!entered) continue;
      if (!isUsableDate(event.date) || units === null) {
        blocked.push({
          ownerKind: "progress_event",
          ownerId: event.id,
          ownerName: name,
          code: "progress_event.incomplete",
          message: `A progress entry for "${name}" needs both a date and a quantity.`,
        });
        // FAIL CLOSED: the unusable entry is retained as unusable, so this
        // obligation's recognition blocks. It is never silently omitted.
        events.push({ id: event.id, date: event.date, units: units ?? UNUSABLE });
        continue;
      }
      events.push({ id: event.id, date: event.date, units });
    }
    base.progressEvents = events;
  }

  if (method === "point_in_time") {
    // "Not yet transferred" is only set when the accountant actually said so.
    if (po.transferStatus === "not_yet_transferred") {
      base.transferDateUnknown = true;
    } else if (po.recognitionDate !== "") {
      if (!isUsableDate(po.recognitionDate)) {
        blocked.push({
          ownerKind: "performance_obligation",
          ownerId: po.id,
          ownerName: name,
          code: "transfer_date.unusable",
          message: `The transfer date entered for "${name}" is not a valid calendar date.`,
        });
      }
      base.recognitionDate = po.recognitionDate;
    }
  }

  return base;
}

interface SeriesPeriodFacts {
  periods: VcSeriesPeriod[];
  /** True when at least one declared period could not be used. */
  invalid: boolean;
}

function seriesPeriods(component: VcComponentDraft, blocked: BlockedFact[]): SeriesPeriodFacts {
  const periods: VcSeriesPeriod[] = [];
  let invalid = false;
  for (const period of [...(component.seriesPeriods ?? [])].sort((a, b) => a.seq - b.seq)) {
    // Strict calendar validity AND a coherent ordering: an impossible date or
    // an end before its start makes the period unusable.
    if (
      !isUsableDate(period.startDate) ||
      !isUsableDate(period.endDate) ||
      period.startDate > period.endDate
    ) {
      blocked.push({
        ownerKind: "series_period",
        ownerId: period.id,
        ownerName: period.label || variableConsiderationDisplayLabel(component),
        code: "series_period.incomplete",
        message:
          "A service period needs a valid start date and a valid end date that does not precede it.",
      });
      // FAIL CLOSED: an unusable period is not dropped; it makes every amount
      // that depends on this component's service periods unusable too.
      invalid = true;
      continue;
    }
    periods.push({
      id: period.id,
      label: period.label || `${period.startDate} – ${period.endDate}`,
      startDate: period.startDate,
      endDate: period.endDate,
    });
  }
  return { periods, invalid };
}

function toProgressiveVcComponent(
  component: VcComponentDraft,
  poIds: ReadonlySet<string>,
  blocked: BlockedFact[],
): ProgressiveVcComponent {
  const name = variableConsiderationDisplayLabel(component);
  const { periods, invalid: periodsInvalid } = seriesPeriods(component, blocked);
  // Any unusable dependent fact makes this component's amounts unusable, so the
  // layer it feeds blocks instead of quietly calculating without it.
  let unusable = periodsInvalid;

  if (component.treatment === "usage_as_incurred") {
    // Usage is expressed as its own rule plus the accountant's actuals; its
    // contractual estimate is zero until real usage arises.
    return {
      id: component.id,
      seq: component.seq,
      description: component.description,
      effect: component.effect,
      treatment: "specific_series_period",
      ...(component.targetPoId ? { targetPoId: component.targetPoId } : {}),
      seriesPeriods: periods,
      estimateCents: unusable ? UNUSABLE : 0,
      includedCents: unusable ? UNUSABLE : 0,
    };
  }

  // The ACCEPTED measurement path owns the inception assessment AND every
  // dated remeasurement: estimation method, outcomes, probabilities, the
  // constraint, effective dates and their chronology. Nothing here parses a
  // raw included amount for an estimated component.
  const measurement = previewVcCurrentMeasurement(component);

  const realized: {
    id: string;
    date: string;
    amountCents: Cents;
    seriesPeriodId?: string;
    billable: boolean;
    description: string;
  }[] = [];
  for (const event of [...(component.realizedEvents ?? [])].sort((a, b) => a.seq - b.seq)) {
    const amount = cents(event.amountInput);
    const entered = event.date !== "" || event.amountInput.trim() !== "";
    if (!entered) continue;
    if (!isUsableDate(event.date) || amount === null) {
      blocked.push({
        ownerKind: "realized_event",
        ownerId: event.id,
        ownerName: name,
        code: "vc.realized_event.incomplete",
        message: `A realized amount for "${name}" needs both a date and an amount.`,
      });
      // FAIL CLOSED: the unusable realized amount blocks this component rather
      // than disappearing from the accounting conclusion.
      unusable = true;
      realized.push({
        id: event.id,
        date: event.date,
        amountCents: amount ?? UNUSABLE,
        ...(event.seriesPeriodId ? { seriesPeriodId: event.seriesPeriodId } : {}),
        billable: component.billOnRealization === true,
        description: event.description,
      });
      continue;
    }
    realized.push({
      id: event.id,
      date: event.date,
      amountCents: amount,
      ...(event.seriesPeriodId ? { seriesPeriodId: event.seriesPeriodId } : {}),
      billable: component.billOnRealization === true,
      description: event.description,
    });
  }

  // The ACCEPTED Phase 5B lifecycle owns a general or specific-PO estimated
  // component end to end: inception, every dated remeasurement and the
  // resolution, with the signed transaction-price change at each date. R3
  // never recreates that arithmetic and never flattens it to one amount.
  const acceptedLifecycle = usesAcceptedLifecycle(component)
    ? buildEstimatedLifecycle(component, poIds)
    : null;
  if (acceptedLifecycle && acceptedLifecycle.lifecycle === null) {
    blocked.push({
      ownerKind: "variable_component",
      ownerId: component.id,
      ownerName: name,
      code: "vc.lifecycle.unusable",
      message:
        acceptedLifecycle.issues[0] ??
        `The variable consideration for "${name}" cannot be measured from the facts entered.`,
    });
    unusable = true;
  }
  const lifecycle = acceptedLifecycle?.lifecycle ?? null;

  let estimateNow: Cents;
  let includedNow: Cents | null;
  if (component.treatment === "estimated") {
    // FAIL CLOSED. For an estimated component the accepted measurement path
    // OWNS both the unconstrained estimate and the amount included after the
    // constraint, at inception AND at every dated remeasurement. If it reports
    // issues, or cannot produce an estimate, the component is unusable: a
    // constrained included amount is NEVER promoted into the estimate, and a
    // malformed later assessment never falls back to the earlier one.
    if (measurement.issues.length > 0) {
      blocked.push({
        ownerKind: "variable_component",
        ownerId: component.id,
        ownerName: name,
        code: "vc.measurement.unusable",
        message:
          measurement.issues[0] ??
          `The estimate for "${name}" cannot be measured from the facts entered.`,
      });
      unusable = true;
    }
    if (measurement.unconstrainedCents === null) unusable = true;
    estimateNow = measurement.unconstrainedCents ?? UNUSABLE;
    includedNow = measurement.includedCents;
  } else {
    // A known (non-estimated) amount carries no assessment to measure; its
    // included magnitude is the accountant's own entry. Its sign is carried by
    // the component's effect, so a negative entry is rejected, never
    // reinterpreted.
    const raw = cents(component.inception.includedInput);
    includedNow = raw !== null && raw < 0 ? null : raw;
    if (includedNow === null) {
      blocked.push({
        ownerKind: "variable_component",
        ownerId: component.id,
        ownerName: name,
        code: "vc.included.unusable",
        message: `"${name}" needs a usable included amount after the constraint.`,
      });
      unusable = true;
    }
    estimateNow = includedNow ?? UNUSABLE;
  }

  // The accepted resolution model is the SAME realization fact the progressive
  // layer needs; it is mapped here rather than modelled a second time.
  if (
    component.hasResolution &&
    lifecycle === null &&
    !usesAcceptedLifecycle(component) &&
    !realized.some((event) => event.id === resolutionEventId(component))
  ) {
    const resolved = cents(component.resolutionAmountInput);
    if (!isUsableDate(component.resolutionDate) || resolved === null) {
      blocked.push({
        ownerKind: "realized_event",
        ownerId: resolutionEventId(component),
        ownerName: name,
        code: "vc.resolution.incomplete",
        message: `The resolution of "${name}" needs both a date and an amount.`,
      });
      unusable = true;
    } else {
      realized.push({
        id: resolutionEventId(component),
        date: component.resolutionDate,
        amountCents: resolved,
        billable: component.billOnRealization === true,
        description: component.resolutionRationale || `Resolution of ${name}`,
      });
    }
  }

  return {
    id: component.id,
    seq: component.seq,
    description: component.description,
    effect: component.effect,
    treatment: component.allocationTreatment,
    ...(component.targetPoId ? { targetPoId: component.targetPoId } : {}),
    seriesPeriods: periods,
    // Distinct facts: the unconstrained estimate and the amount included after
    // the constraint are never collapsed into one another.
    estimateCents: unusable ? UNUSABLE : estimateNow,
    includedCents: unusable ? UNUSABLE : (includedNow ?? UNUSABLE),
    realizedEvents: realized,
    ...(lifecycle && !unusable
      ? {
          lifecycle: lifecycle.result.assessments.map((assessment) => ({
            assessmentId: assessment.assessmentId,
            effectiveDate: assessment.effectiveDate,
            unconstrainedCents: assessment.unconstrainedCents,
            includedCents: assessment.includedCents,
            changeCents: assessment.changeCents,
            isResolution: assessment.isResolution,
          })),
        }
      : {}),
  };
}

/** Deterministic identity of the accepted resolution fact as a realized event. */
function resolutionEventId(component: VcComponentDraft): string {
  return `${component.id}:resolution`;
}

function toUsageInput(
  component: VcComponentDraft,
  blocked: BlockedFact[],
): ProgressiveUsageInput | null {
  if (component.treatment !== "usage_as_incurred") return null;
  const name = variableConsiderationDisplayLabel(component);
  if (!component.targetPoId) {
    blocked.push({
      ownerKind: "variable_component",
      ownerId: component.id,
      ownerName: name,
      code: "usage.target.absent",
      message: `Usage-based consideration "${name}" needs the obligation it relates to.`,
    });
    return null;
  }

  const meters = [];
  for (const meter of component.meters) {
    const rate = cents(meter.rateAmountInput);
    const denominator = quantity(meter.rateQuantityInput);
    const included = quantity(meter.includedQuantityInput);
    const meterName = meter.name || meter.id;
    if (rate === null || denominator === null || denominator <= 0) {
      blocked.push({
        ownerKind: "usage_meter",
        ownerId: meter.id,
        ownerName: meterName,
        code: "usage.meter.rate",
        message: `Meter "${meterName}" needs a rate amount and a quantity greater than zero.`,
      });
      // FAIL CLOSED: the meter is retained as unusable so nothing is priced
      // under a rule that is only partly readable.
      meters.push({
        id: meter.id,
        seq: meter.seq,
        name: meter.name,
        rateAmountCents: rate ?? UNUSABLE,
        rateQuantity: denominator !== null && denominator > 0 ? denominator : UNUSABLE,
        unit: meter.unit,
      });
      continue;
    }
    if (meter.includedQuantityInput !== undefined && meter.includedQuantityInput.trim() !== "") {
      if (included === null || included < 0) {
        blocked.push({
          ownerKind: "usage_meter",
          ownerId: meter.id,
          ownerName: meterName,
          code: "usage.meter.included_quantity",
          message: `The included quantity for meter "${meterName}" must be a quantity of zero or more.`,
        });
        meters.push({
          id: meter.id,
          seq: meter.seq,
          name: meter.name,
          rateAmountCents: UNUSABLE,
          rateQuantity: denominator,
          unit: meter.unit,
        });
        continue;
      }
    }
    meters.push({
      id: meter.id,
      seq: meter.seq,
      name: meter.name,
      rateAmountCents: rate,
      rateQuantity: denominator,
      unit: meter.unit,
      ...(included !== null ? { includedQuantity: included } : {}),
    });
  }

  const { periods, invalid: periodsInvalid } = seriesPeriods(component, blocked);
  const actuals = [];
  for (const period of component.usagePeriods) {
    const quantities: Record<string, number> = {};
    let entered = false;
    for (const [meterId, raw] of Object.entries(period.quantities)) {
      if (raw.trim() === "") continue;
      entered = true;
      // The meter a reported quantity refers to must exist. An orphan
      // reference is reported and retained as unusable; it is never silently
      // dropped and never priced.
      if (!component.meters.some((meter) => meter.id === meterId)) {
        blocked.push({
          ownerKind: "usage_actual",
          ownerId: period.id,
          ownerName: name,
          code: "usage.actual.orphan_meter",
          message: `Usage reported for ${period.month} refers to a meter that no longer exists.`,
        });
        quantities[meterId] = UNUSABLE;
        continue;
      }
      const value = quantity(raw);
      if (value === null || value < 0) {
        blocked.push({
          ownerKind: "usage_actual",
          ownerId: period.id,
          ownerName: name,
          code: "usage.actual.quantity",
          message: `Usage reported for ${period.month} is not a valid quantity.`,
        });
        // FAIL CLOSED: an unreadable quantity is kept as unusable, so this
        // month's usage blocks instead of being priced as if it were blank.
        quantities[meterId] = UNUSABLE;
        continue;
      }
      quantities[meterId] = value;
    }
    if (!entered) continue;
    if (Object.keys(quantities).length === 0) continue;

    const owning = owningPeriod(periods, period.month);
    if (!owning) {
      blocked.push({
        ownerKind: "usage_actual",
        ownerId: period.id,
        ownerName: name,
        code: "usage.actual.period",
        message: `Usage reported for ${period.month} does not fall inside a declared service period.`,
      });
    }
    actuals.push({
      id: period.id,
      month: period.month,
      // An unmapped month keeps an unmappable reference: the usage engine then
      // blocks this rule rather than silently dropping real usage.
      seriesPeriodId: owning ? owning.id : `unmapped:${period.month}`,
      date: monthEnd(period.month),
      quantitiesByMeterId: quantities,
    });
  }

  return {
    rule: {
      componentId: component.id,
      targetPoId: component.targetPoId,
      meters,
      billing: { billOnRealization: component.billOnRealization === true },
      seriesPeriods: periodsInvalid ? [] : periods,
    },
    actuals,
  };
}

/** The declared service period an accounting month belongs to, by month key. */
function owningPeriod(
  periods: readonly VcSeriesPeriod[],
  month: string,
): VcSeriesPeriod | undefined {
  const matches = periods.filter(
    (candidate) =>
      month >= candidate.startDate.slice(0, 7) && month <= candidate.endDate.slice(0, 7),
  );
  // Ambiguous ownership FAILS CLOSED: if two declared periods both cover the
  // month, no period is selected and the usage rule blocks.
  return matches.length === 1 ? matches[0] : undefined;
}

/** Last calendar day of an accounting month, "YYYY-MM". */
function monthEnd(month: string): string {
  const [year, index] = month.split("-").map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(index)) return `${month}-01`;
  const day = new Date(Date.UTC(year!, index!, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/**
 * Builds the progressive engine input from the canonical draft, fail-closed.
 *
 * Every obligation and component survives. A fact that cannot be used is
 * reported with its owner so only the calculations that depend on it block.
 */
export function buildProgressiveInput(draft: WorkflowDraft): ProgressiveInputResult {
  const blocked: BlockedFact[] = [];

  const fixed = cents(draft.transactionPriceInput);
  if (fixed === null) {
    blocked.push({
      ownerKind: "contract",
      ownerId: "contract",
      ownerName: draft.contract.customerName || "This contract",
      code: "transaction_price.unusable",
      message:
        "Fixed consideration is missing or cannot be read, so the transaction price cannot be determined.",
    });
  }

  const pos = draft.performanceObligations.map((po) => toProgressivePo(po, blocked));

  const poIds = new Set(draft.performanceObligations.map((po) => po.id));
  const components = draft.hasVariableConsideration
    ? draft.variableConsiderationComponents.map((component) =>
        toProgressiveVcComponent(component, poIds, blocked),
      )
    : [];

  const usage = draft.hasVariableConsideration
    ? draft.variableConsiderationComponents
        .map((component) => toUsageInput(component, blocked))
        .filter((entry): entry is ProgressiveUsageInput => entry !== null)
    : [];

  const fixedBilling = [];
  for (const event of draft.contractBalances.considerationEvents) {
    const amount = cents(event.amountInput);
    const entered = event.amountInput.trim() !== "" || event.unconditionalRightDate !== "";
    if (!entered) continue;
    if (amount === null || !isUsableDate(event.unconditionalRightDate)) {
      blocked.push({
        ownerKind: "billing_event",
        ownerId: event.id,
        ownerName: "Contractual billing",
        code: "billing.incomplete",
        message: "A billing event needs both an amount and an unconditional-right date.",
      });
      // FAIL CLOSED: the unusable billing event is retained as unusable, so the
      // billing schedule, balances and journals block instead of presenting a
      // schedule that quietly omits a real billing event.
      fixedBilling.push({
        id: event.id,
        seq: event.seq,
        amountCents: amount ?? UNUSABLE,
        unconditionalRightDate: event.unconditionalRightDate,
        ...(isUsableDate(event.invoiceDate) ? { invoiceDate: event.invoiceDate! } : {}),
        description: "Contractual billing",
      });
      continue;
    }
    // The invoice date of an ENTERED fixed billing event is an accountant-owned
    // fact. It is never manufactured from the unconditional-right date: billed
    // versus unbilled receivable timing depends on it. A missing or unreadable
    // invoice date blocks the billing, balance and journal output that depends
    // on that timing, while allocation and determinable revenue stay available.
    // (A variable amount billed on realization is a separate, genuinely
    // deterministic same-day rule and is unaffected.)
    if (!isUsableDate(event.invoiceDate)) {
      blocked.push({
        ownerKind: "billing_event",
        ownerId: event.id,
        ownerName: "Contractual billing",
        code: "billing.invoice_date",
        message:
          "A contractual billing event needs the date the invoice was issued before billed and unbilled receivables can be presented.",
      });
    }
    fixedBilling.push({
      id: event.id,
      seq: event.seq,
      amountCents: amount,
      unconditionalRightDate: event.unconditionalRightDate,
      ...(isUsableDate(event.invoiceDate) ? { invoiceDate: event.invoiceDate! } : {}),
      description: "Contractual billing",
    });
  }

  if (fixed === null) return { ok: false, input: null, blocked };

  return {
    ok: true,
    input: {
      fixedConsiderationCents: fixed,
      performanceObligations: pos,
      variableComponents: components,
      usage,
      fixedBilling,
      cashCollections: cashCollections(draft, blocked),
    },
    blocked,
  };
}

/**
 * True when the draft carries a Phase 9G-R3 progressive fact: an input measure,
 * an explicit transfer status, progress actuals, usage, or a series-period
 * variable amount. Those contracts are analysed by the progressive engine,
 * which is the authoritative path for them.
 */
/** Cash actually received, mapped to its known billing event; fail closed. */
function cashCollections(
  draft: WorkflowDraft,
  blocked: BlockedFact[],
): ProgressiveCashCollection[] {
  const rows: ProgressiveCashCollection[] = [];
  for (const collection of draft.contractBalances.cashCollections) {
    const entered = collection.amountInput.trim() !== "" || collection.collectionDate !== "";
    if (!entered) continue;
    const amount = cents(collection.amountInput);
    if (
      amount === null ||
      !isUsableDate(collection.collectionDate) ||
      !collection.considerationEventId
    ) {
      blocked.push({
        ownerKind: "billing_event",
        ownerId: collection.id,
        ownerName: "Cash collection",
        code: "cash_collection.incomplete",
        message: "A cash collection needs an amount, a date and the billing event it settles.",
      });
      // FAIL CLOSED: a receipt whose billing event is known stays in the input
      // as unusable, so Phase 3 blocks the balances that depend on it.
      if (collection.considerationEventId) {
        rows.push({
          id: collection.id,
          seq: collection.seq,
          billingEventId: collection.considerationEventId,
          amountCents: amount ?? UNUSABLE,
          collectionDate: collection.collectionDate,
        });
      }
      continue;
    }
    rows.push({
      id: collection.id,
      seq: collection.seq,
      billingEventId: collection.considerationEventId,
      amountCents: amount,
      collectionDate: collection.collectionDate,
    });
  }
  return rows;
}

export function draftRequiresProgressive(draft: WorkflowDraft): boolean {
  for (const po of draft.performanceObligations) {
    if (po.overTimeMeasure === "input_measure") return true;
    if (po.transferStatus === "not_yet_transferred") return true;
    if ((po.progressEvents?.length ?? 0) > 0) return true;
  }
  if (draft.hasVariableConsideration) {
    for (const component of draft.variableConsiderationComponents) {
      if (component.treatment === "usage_as_incurred") {
        // Usage facts whose meaning is owned ONLY by the R3 engine must route
        // here; a usage contract can never silently stay on a legacy path that
        // ignores them. Ordinary usage keeps its accepted Phase 5B treatment.
        if ((component.seriesPeriods?.length ?? 0) > 0) return true;
        if (component.billOnRealization === true) return true;
        if (component.meters.some((meter) => (meter.includedQuantityInput ?? "").trim() !== "")) {
          return true;
        }
        continue;
      }
      if (component.allocationTreatment === "specific_series_period") return true;
      if ((component.realizedEvents?.length ?? 0) > 0) return true;
    }
  }
  return false;
}

export class ProgressiveInputBlockedError extends Error {
  readonly blocked: BlockedFact[];
  constructor(blocked: BlockedFact[]) {
    super(blocked[0]?.message ?? "This contract cannot be calculated yet.");
    this.name = "ProgressiveInputBlockedError";
    this.blocked = blocked;
  }
}

/**
 * Convenience for callers that already know the contract-level facts are
 * usable. Throws with the blocked facts rather than inventing a $0 price.
 */
export function toProgressiveContractInput(draft: WorkflowDraft): ProgressiveContractInput {
  const result = buildProgressiveInput(draft);
  if (!result.ok) throw new ProgressiveInputBlockedError(result.blocked);
  return result.input;
}
