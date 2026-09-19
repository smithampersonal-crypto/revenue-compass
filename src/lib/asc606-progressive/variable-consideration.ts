/**
 * Phase 9G-R3 Part 2, Stage A — deterministic variable-consideration layer.
 *
 * This module replaces the transitional `externalPending` surface: a nonzero
 * included variable amount now lives INSIDE the transaction price and inside
 * reconciliation. It never floats outside the equation merely because the
 * operational event has not happened yet.
 *
 * Five things are modelled separately and never collapsed into one another:
 *
 *   1. the CONTRACTUAL RULE      (treatment, target, series periods)
 *   2. the ESTIMATE              (unconstrained magnitude)
 *   3. the CONSTRAINT / INCLUDED (magnitude included in the transaction price)
 *   4. the REALIZED ACTUAL EVENT (an amount that actually arose, with a date)
 *   5. the ALLOCATION TREATMENT  (general / specific_po / specific_series_period)
 *
 * Every component and every event carries a stable deterministic identity, so
 * downstream pending, billing and journal details are never identified by
 * `poId + reason` alone.
 *
 * Pure data: no React, DOM, network, database or AI dependency, no mutable
 * global state, integer cents everywhere.
 */

import {
  isValidCents,
  isValidIsoDate,
  monthKeyOf,
  sumCents,
  type Cents,
  type IsoDate,
  type MonthKey,
} from "@/lib/asc606";

import {
  mergeCalculationState,
  type BlockedComponent,
  type CalculationState,
  type PendingComponent,
} from "./types";

export type VcAllocationTreatmentR3 = "general" | "specific_po" | "specific_series_period";

export type VcEffectR3 = "increase" | "decrease";

/** A distinct service period of a series that a variable amount can target. */
export interface VcSeriesPeriod {
  id: string;
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * An amount that ACTUALLY arose. Accountant/operational data only — never
 * inferred, estimated or fabricated by ARC or by the AI layer.
 */
export interface VcRealizedEvent {
  id: string;
  date: IsoDate;
  /** Magnitude in cents; the component effect supplies the sign. */
  amountCents: Cents;
  /** Required when the treatment is specific_series_period. */
  seriesPeriodId?: string;
  /** True when the accepted contractual billing rule makes this amount billable. */
  billable?: boolean;
  /** Provenance label, for example the usage meter breakdown. */
  description?: string;
}

export interface ProgressiveVcComponent {
  id: string;
  seq: number;
  description: string;
  effect: VcEffectR3;
  treatment: VcAllocationTreatmentR3;
  /** Required for specific_po and specific_series_period. */
  targetPoId?: string;
  /** Declared distinct service periods; only meaningful for a series target. */
  seriesPeriods?: readonly VcSeriesPeriod[];
  /** Unconstrained estimate magnitude. */
  estimateCents: Cents;
  /** Magnitude included after the constraint. May legitimately be zero. */
  includedCents: Cents;
  realizedEvents?: readonly VcRealizedEvent[];
}

export interface VcSpecificPoAllocation {
  /** Stable identity: `vc:<componentId>:included`. */
  id: string;
  componentId: string;
  description: string;
  poId: string;
  /** Signed. */
  amountCents: Cents;
}

export interface VcSeriesPeriodAllocation {
  /** Stable identity: `vc:<componentId>:<eventId>`. */
  id: string;
  componentId: string;
  eventId: string;
  poId: string;
  seriesPeriodId: string;
  seriesPeriodLabel: string;
  date: IsoDate;
  month: MonthKey;
  /** Signed. */
  amountCents: Cents;
  billable: boolean;
  description: string;
}

export interface VcComponentState {
  componentId: string;
  description: string;
  treatment: VcAllocationTreatmentR3;
  targetPoId: string | null;
  state: CalculationState;
  /** Signed estimate before the constraint. */
  estimateSignedCents: Cents;
  /** Signed amount included in the transaction price at inception. */
  includedSignedCents: Cents;
  /** Signed total of realized actual events. */
  realizedSignedCents: Cents;
  /** Signed included amount still awaiting its realizing event. */
  pendingSignedCents: Cents;
}

/**
 * The SIGNED unresolved effect of one component on one obligation.
 *
 * `PendingComponent.amountCents` is a nonnegative magnitude by contract, so the
 * economic sign of an unrealized decrease lives here (and in the component's
 * `direction`), never inside the magnitude.
 */
export interface VcPendingAllocation {
  /** Stable identity: `vc:<componentId>:unrealized`. */
  id: string;
  componentId: string;
  poId: string;
  signedCents: Cents;
}

export interface ProgressiveVcLayers {
  state: CalculationState;
  /** Signed general pool allocated across obligations on a relative SSP basis. */
  generalPoolCents: Cents;
  specificPo: VcSpecificPoAllocation[];
  seriesPeriod: VcSeriesPeriodAllocation[];
  components: VcComponentState[];
  pending: PendingComponent[];
  /** Signed unresolved amounts, per component and obligation. */
  pendingByPo: VcPendingAllocation[];
  blocked: BlockedComponent[];
  /** Signed total added to the fixed consideration to form the price. */
  transactionPriceEffectCents: Cents;
}

export interface VcLayerPoRef {
  id: string;
  name: string;
  /** True when the obligation is an over-time series a period can target. */
  isSeries: boolean;
}

function signed(effect: VcEffectR3, magnitude: Cents): Cents {
  return effect === "increase" ? magnitude : -magnitude;
}

function validMagnitude(value: unknown): value is Cents {
  return typeof value === "number" && isValidCents(value) && value >= 0;
}

/**
 * Builds the three allocation layers.
 *
 *  A. general                 — included amount joins the relative-SSP pool
 *  B. specific_po             — included amount goes entirely to the target PO
 *  C. specific_series_period  — realized amounts adjust ONLY their own period;
 *                               an included-but-unrealized amount is retained
 *                               against the target obligation as pending.
 *
 * A zero included estimate with no realized event is COMPLETE: no future
 * period, billing event, probability or credit is fabricated to validate it,
 * and it has exactly zero effect on the fixed allocation.
 */
export function buildVcLayers(
  components: readonly ProgressiveVcComponent[],
  pos: readonly VcLayerPoRef[],
): ProgressiveVcLayers {
  const poById = new Map(pos.map((po) => [po.id, po]));
  const ordered = [...components].sort((a, b) => a.seq - b.seq);

  const specificPo: VcSpecificPoAllocation[] = [];
  const seriesPeriod: VcSeriesPeriodAllocation[] = [];
  const states: VcComponentState[] = [];
  const pending: PendingComponent[] = [];
  const pendingByPo: VcPendingAllocation[] = [];
  const blocked: BlockedComponent[] = [];

  let generalPool = 0;
  const seenComponentIds = new Set<string>();

  for (const component of ordered) {
    const poName = poById.get(component.targetPoId ?? "")?.name ?? component.description;
    const fail = (code: string, message: string) => {
      blocked.push({
        poId: component.targetPoId ?? "",
        poName,
        amountCents: 0,
        code,
        message,
      });
      states.push({
        componentId: component.id,
        description: component.description,
        treatment: component.treatment,
        targetPoId: component.targetPoId ?? null,
        state: "blocked",
        estimateSignedCents: 0,
        includedSignedCents: 0,
        realizedSignedCents: 0,
        pendingSignedCents: 0,
      });
    };

    if (seenComponentIds.has(component.id)) {
      fail(
        "variable_consideration.identity.duplicate",
        `Variable consideration component "${component.description}" is defined more than once.`,
      );
      continue;
    }
    seenComponentIds.add(component.id);

    if (!validMagnitude(component.includedCents) || !validMagnitude(component.estimateCents)) {
      fail(
        "variable_consideration.amount.invalid",
        `Variable consideration component "${component.description}" has an invalid amount.`,
      );
      continue;
    }
    if (component.includedCents > component.estimateCents) {
      fail(
        "variable_consideration.constraint.invalid",
        `The amount included for "${component.description}" exceeds its estimate.`,
      );
      continue;
    }

    const includedSigned = signed(component.effect, component.includedCents);
    const estimateSigned = signed(component.effect, component.estimateCents);
    const events = [...(component.realizedEvents ?? [])].sort((a, b) =>
      a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1,
    );

    // ---- A. general ------------------------------------------------------
    if (component.treatment === "general") {
      if (events.length > 0) {
        // A realized general amount simply remeasures the included amount; it
        // is still allocated through the relative-SSP pool.
        const realized = sumRealized(events);
        if (realized === null) {
          fail(
            "variable_consideration.event.invalid",
            `A realized amount for "${component.description}" is invalid.`,
          );
          continue;
        }
      }
      generalPool = sumCents([generalPool, includedSigned]);
      states.push({
        componentId: component.id,
        description: component.description,
        treatment: "general",
        targetPoId: null,
        state: "complete",
        estimateSignedCents: estimateSigned,
        includedSignedCents: includedSigned,
        realizedSignedCents: 0,
        pendingSignedCents: 0,
      });
      continue;
    }

    // Both exceptions need a real target obligation: fail closed otherwise.
    const target = poById.get(component.targetPoId ?? "");
    if (!target) {
      fail(
        "variable_consideration.target.unmappable",
        `Variable consideration component "${component.description}" targets a performance obligation that does not exist.`,
      );
      continue;
    }

    // ---- B. specific_po --------------------------------------------------
    if (component.treatment === "specific_po") {
      if (component.includedCents !== 0) {
        specificPo.push({
          id: `vc:${component.id}:included`,
          componentId: component.id,
          description: component.description,
          poId: target.id,
          amountCents: includedSigned,
        });
      }
      states.push({
        componentId: component.id,
        description: component.description,
        treatment: "specific_po",
        targetPoId: target.id,
        state: "complete",
        estimateSignedCents: estimateSigned,
        includedSignedCents: includedSigned,
        realizedSignedCents: 0,
        pendingSignedCents: 0,
      });
      continue;
    }

    // ---- C. specific_series_period --------------------------------------
    if (!target.isSeries) {
      fail(
        "variable_consideration.series.invalid_parent",
        `"${target.name}" is not a series obligation, so a distinct service period cannot be targeted.`,
      );
      continue;
    }

    const periods = new Map((component.seriesPeriods ?? []).map((period) => [period.id, period]));
    let realizedSigned = 0;
    let eventFailure = false;
    const seenEventIds = new Set<string>();

    for (const event of events) {
      if (seenEventIds.has(event.id)) {
        fail(
          "variable_consideration.event.duplicate",
          `"${component.description}" has a duplicate realized event.`,
        );
        eventFailure = true;
        break;
      }
      seenEventIds.add(event.id);

      if (!validMagnitude(event.amountCents) || !isValidIsoDate(event.date)) {
        fail(
          "variable_consideration.event.invalid",
          `A realized amount for "${component.description}" is invalid.`,
        );
        eventFailure = true;
        break;
      }
      const period = periods.get(event.seriesPeriodId ?? "");
      if (!period) {
        fail(
          "variable_consideration.series.period_unmappable",
          `A realized amount for "${component.description}" references a service period that does not exist.`,
        );
        eventFailure = true;
        break;
      }
      if (event.date < period.startDate || event.date > period.endDate) {
        fail(
          "variable_consideration.series.period_mismatch",
          `A realized amount for "${component.description}" falls outside the service period it is assigned to.`,
        );
        eventFailure = true;
        break;
      }

      const amount = signed(component.effect, event.amountCents);
      realizedSigned = sumCents([realizedSigned, amount]);
      seriesPeriod.push({
        id: `vc:${component.id}:${event.id}`,
        componentId: component.id,
        eventId: event.id,
        poId: target.id,
        seriesPeriodId: period.id,
        seriesPeriodLabel: period.label,
        date: event.date,
        month: monthKeyOf(event.date),
        amountCents: amount,
        billable: event.billable === true,
        description: event.description ?? component.description,
      });
    }
    if (eventFailure) continue;

    // An included estimate that has not yet been realized is retained against
    // the target obligation, never dropped and never recognized. Its magnitude
    // stays nonnegative; its economic direction is explicit.
    const unrealizedMagnitude = Math.max(component.includedCents - absCents(realizedSigned), 0);
    if (unrealizedMagnitude > 0) {
      pending.push({
        poId: target.id,
        poName: target.name,
        amountCents: unrealizedMagnitude,
        reason: "awaiting_variable_consideration_event",
        direction: component.effect,
        detail: {
          componentId: component.id,
          identity: `vc:${component.id}:unrealized`,
          description: component.description,
          direction: component.effect,
        },
      });
      pendingByPo.push({
        id: `vc:${component.id}:unrealized`,
        componentId: component.id,
        poId: target.id,
        signedCents: signed(component.effect, unrealizedMagnitude),
      });
    }


    states.push({
      componentId: component.id,
      description: component.description,
      treatment: "specific_series_period",
      targetPoId: target.id,
      state: unrealizedMagnitude > 0 ? "pending" : "complete",
      estimateSignedCents: estimateSigned,
      includedSignedCents: includedSigned,
      realizedSignedCents: realizedSigned,
      pendingSignedCents: signed(component.effect, unrealizedMagnitude),
    });
  }

  const transactionPriceEffectCents = sumCents([
    generalPool,
    ...specificPo.map((row) => row.amountCents),
    ...seriesPeriod.map((row) => row.amountCents),
    ...states
      .filter((state) => state.treatment === "specific_series_period")
      .map((state) => state.pendingSignedCents),
  ]);

  return {
    state: mergeCalculationState(
      ...states.map((state) => state.state),
      blocked.length > 0 ? "blocked" : "complete",
    ),
    generalPoolCents: generalPool,
    specificPo,
    seriesPeriod,
    components: states,
    pending,
    pendingByPo,
    blocked,
    transactionPriceEffectCents,
  };
}

function absCents(value: Cents): Cents {
  return value < 0 ? -value : value;
}

function sumRealized(events: readonly VcRealizedEvent[]): Cents | null {
  let total = 0;
  for (const event of events) {
    if (!validMagnitude(event.amountCents)) return null;
    total = sumCents([total, event.amountCents]);
  }
  return total;
}
