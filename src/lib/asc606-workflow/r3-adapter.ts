/**
 * Phase 9G-R3 Part 2, Stage A — workflow draft to progressive engine input.
 *
 * The draft stores FACTS only. Nothing derived is written back into it: every
 * amount, percentage, schedule row and balance is calculated by the
 * deterministic engines from these facts each time.
 *
 * Operational actuals (hours incurred, usage quantities, realized variable
 * amounts, transfer dates) are accountant-owned. This adapter reads them; it
 * never invents, defaults or back-fills one.
 */

import type { Cents } from "@/lib/asc606";
import type {
  ProgressiveContractInput,
  ProgressiveContractPo,
  ProgressiveUsageInput,
} from "@/lib/asc606-progressive";
import type {
  ProgressiveVcComponent,
  VcSeriesPeriod,
} from "@/lib/asc606-progressive";

import { parseUsageQuantity, parseUsdToCents } from "./money-input";
import type {
  PoDraft,
  VcComponentDraft,
  WorkflowDraft,
} from "./types";

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

/** The R3 recognition method implied by the accepted workflow facts. */
export function progressiveRecognitionMethod(
  po: PoDraft,
): ProgressiveContractPo["recognitionMethod"] | null {
  if (po.recognitionMethod === "over_time_ratable") {
    return po.overTimeMeasure === "input_measure"
      ? "over_time_input_measure"
      : "over_time_ratable";
  }
  return po.recognitionMethod;
}

function toProgressivePo(po: PoDraft): ProgressiveContractPo | null {
  const method = progressiveRecognitionMethod(po);
  const ssp = cents(po.sspInput);
  if (method === null || ssp === null) return null;

  const base: ProgressiveContractPo = {
    id: po.id,
    seq: po.seq,
    name: po.name,
    sspCents: ssp,
    recognitionMethod: method,
    isSeries: po.classification === "series",
  };

  if (method === "over_time_ratable") {
    if (po.serviceStart) base.serviceStart = po.serviceStart;
    if (po.serviceEnd) base.serviceEnd = po.serviceEnd;
  }

  if (method === "over_time_input_measure") {
    const total = quantity(po.totalExpectedUnitsInput);
    if (total !== null) base.totalExpectedUnits = total;
    base.unitLabel = po.unitLabel && po.unitLabel !== "" ? po.unitLabel : "units";
    base.progressEvents = (po.progressEvents ?? [])
      .filter((event) => event.date !== "" && event.unitsInput.trim() !== "")
      .map((event) => ({
        id: event.id,
        date: event.date,
        units: quantity(event.unitsInput) ?? Number.NaN,
      }));
  }

  if (method === "point_in_time") {
    // "Not yet transferred" is only set when the accountant actually said so.
    if (po.transferStatus === "not_yet_transferred") {
      base.transferDateUnknown = true;
    } else if (po.recognitionDate !== "") {
      base.recognitionDate = po.recognitionDate;
    }
  }

  return base;
}

function seriesPeriods(component: VcComponentDraft): VcSeriesPeriod[] {
  return (component.seriesPeriods ?? [])
    .filter((period) => period.startDate !== "" && period.endDate !== "")
    .sort((a, b) => a.seq - b.seq)
    .map((period) => ({
      id: period.id,
      label: period.label || `${period.startDate} – ${period.endDate}`,
      startDate: period.startDate,
      endDate: period.endDate,
    }));
}

function toProgressiveVcComponent(
  component: VcComponentDraft,
): ProgressiveVcComponent | null {
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
      seriesPeriods: seriesPeriods(component),
      estimateCents: 0,
      includedCents: 0,
    };
  }

  const included = cents(component.inception.includedInput);
  if (included === null) return null;
  const latest = [...component.remeasurements].sort((a, b) => b.seq - a.seq)[0];
  const current = latest ? (cents(latest.includedInput) ?? included) : included;

  const realized = (component.realizedEvents ?? [])
    .filter((event) => event.date !== "" && cents(event.amountInput) !== null)
    .sort((a, b) => a.seq - b.seq)
    .map((event) => ({
      id: event.id,
      date: event.date,
      amountCents: cents(event.amountInput)!,
      ...(event.seriesPeriodId ? { seriesPeriodId: event.seriesPeriodId } : {}),
      billable: component.billOnRealization === true,
      description: event.description,
    }));

  return {
    id: component.id,
    seq: component.seq,
    description: component.description,
    effect: component.effect,
    treatment: component.allocationTreatment,
    ...(component.targetPoId ? { targetPoId: component.targetPoId } : {}),
    seriesPeriods: seriesPeriods(component),
    estimateCents: current,
    includedCents: current,
    realizedEvents: realized,
  };
}

function toUsageInput(component: VcComponentDraft): ProgressiveUsageInput | null {
  if (component.treatment !== "usage_as_incurred" || !component.targetPoId) return null;
  const meters = component.meters
    .map((meter) => {
      const rate = cents(meter.rateAmountInput);
      const denominator = quantity(meter.rateQuantityInput);
      if (rate === null || denominator === null) return null;
      const included = quantity(meter.includedQuantityInput);
      return {
        id: meter.id,
        seq: meter.seq,
        name: meter.name,
        rateAmountCents: rate,
        rateQuantity: denominator,
        unit: meter.unit,
        ...(included !== null ? { includedQuantity: included } : {}),
      };
    })
    .filter((meter): meter is NonNullable<typeof meter> => meter !== null);

  const periods = seriesPeriods(component);
  const actuals = component.usagePeriods
    .map((period) => {
      const quantities: Record<string, number> = {};
      for (const [meterId, raw] of Object.entries(period.quantities)) {
        const value = quantity(raw);
        // A blank quantity is MISSING, never zero: it is simply not reported.
        if (value !== null) quantities[meterId] = value;
      }
      if (Object.keys(quantities).length === 0) return null;
      const owning = periods.find(
        (candidate) =>
          `${period.month}-01` >= candidate.startDate.slice(0, 7) + "-01" &&
          `${period.month}-01` <= candidate.endDate,
      );
      if (!owning) return null;
      return {
        id: period.id,
        month: period.month,
        seriesPeriodId: owning.id,
        date: `${period.month}-01`,
        quantitiesByMeterId: quantities,
      };
    })
    .filter((actual): actual is NonNullable<typeof actual> => actual !== null);

  return {
    rule: {
      componentId: component.id,
      targetPoId: component.targetPoId,
      meters,
      billing: { billOnRealization: component.billOnRealization === true },
      seriesPeriods: periods,
    },
    actuals,
  };
}

/**
 * Builds the progressive engine input from the canonical draft. Obligations
 * and components whose required facts are absent are simply not supplied —
 * the engine reports them, and no placeholder value is invented here.
 */
export function toProgressiveContractInput(draft: WorkflowDraft): ProgressiveContractInput {
  const pos = draft.performanceObligations
    .map(toProgressivePo)
    .filter((po): po is ProgressiveContractPo => po !== null);

  const components = draft.hasVariableConsideration
    ? draft.variableConsiderationComponents
        .map(toProgressiveVcComponent)
        .filter((component): component is ProgressiveVcComponent => component !== null)
    : [];

  const usage = draft.hasVariableConsideration
    ? draft.variableConsiderationComponents
        .map(toUsageInput)
        .filter((entry): entry is ProgressiveUsageInput => entry !== null)
    : [];

  const fixedBilling = draft.contractBalances.considerationEvents
    .filter((event) => event.unconditionalRightDate !== "" && cents(event.amountInput) !== null)
    .map((event) => ({
      id: event.id,
      seq: event.seq,
      amountCents: cents(event.amountInput)!,
      unconditionalRightDate: event.unconditionalRightDate,
      ...(event.invoiceDate ? { invoiceDate: event.invoiceDate } : {}),
      description: "Contractual billing",
    }));

  return {
    fixedConsiderationCents: cents(draft.transactionPriceInput) ?? 0,
    performanceObligations: pos,
    variableComponents: components,
    usage,
    fixedBilling,
  };
}
