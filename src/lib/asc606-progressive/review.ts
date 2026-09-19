/**
 * Phase 9G-R3 Part 2, Stage D — material R3 facts for the accepted 9G review,
 * provenance and fingerprint model.
 *
 * Each material fact has a deterministic key and a deterministic fingerprint.
 * Changing one fact reopens ONLY the conclusion that depends on it; every
 * unrelated approval carries forward untouched.
 *
 * Fail-closed behaviour is preserved: an unknown or malformed fact produces a
 * fingerprint that cannot collide with a known one, and orphan details that
 * reference no valid owner are rejected rather than tolerated.
 */

export type MaterialFactKind =
  | "recognition_method"
  | "transfer_status"
  | "input_measure_denominator"
  | "progress_event"
  | "vc_treatment"
  | "vc_target"
  | "series_period_target"
  | "usage_actual"
  | "realized_vc_amount";

export interface MaterialFact {
  /** Deterministic key, for example `po:po-support:input_measure_denominator`. */
  key: string;
  kind: MaterialFactKind;
  /** The component, obligation or event the fact belongs to. */
  ownerId: string;
  /** Deterministic value fingerprint. */
  fingerprint: string;
}

export interface MaterialFactSource {
  performanceObligations: readonly {
    id: string;
    recognitionMethod: string;
    transferDateUnknown?: boolean;
    recognitionDate?: string;
    totalExpectedUnits?: number;
    unitLabel?: string;
    progressEvents?: readonly { id: string; date: string; units: number }[];
  }[];
  variableComponents?: readonly {
    id: string;
    treatment: string;
    targetPoId?: string;
    includedCents: number;
    seriesPeriods?: readonly { id: string; startDate: string; endDate: string }[];
    realizedEvents?: readonly {
      id: string;
      date: string;
      amountCents: number;
      seriesPeriodId?: string;
    }[];
  }[];
  usageActuals?: readonly {
    id: string;
    componentId: string;
    month: string;
    quantitiesByMeterId: Readonly<Record<string, number>>;
  }[];
}

function stable(value: unknown): string {
  if (value === undefined) return "\u0000absent";
  if (value === null) return "\u0000null";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${k}=${stable(v)}`).join(",")}}`;
  }
  return String(value);
}

/** Every material R3 fact, in deterministic key order. */
export function materialFacts(source: MaterialFactSource): MaterialFact[] {
  const facts: MaterialFact[] = [];

  for (const po of source.performanceObligations) {
    facts.push({
      key: `po:${po.id}:recognition_method`,
      kind: "recognition_method",
      ownerId: po.id,
      fingerprint: stable(po.recognitionMethod),
    });
    facts.push({
      key: `po:${po.id}:transfer_status`,
      kind: "transfer_status",
      ownerId: po.id,
      fingerprint: stable({
        unknown: po.transferDateUnknown === true,
        date: po.recognitionDate ?? "",
      }),
    });
    if (po.totalExpectedUnits !== undefined || po.unitLabel !== undefined) {
      facts.push({
        key: `po:${po.id}:input_measure_denominator`,
        kind: "input_measure_denominator",
        ownerId: po.id,
        fingerprint: stable({ total: po.totalExpectedUnits, unit: po.unitLabel }),
      });
    }
    for (const event of po.progressEvents ?? []) {
      facts.push({
        key: `po:${po.id}:progress:${event.id}`,
        kind: "progress_event",
        ownerId: po.id,
        fingerprint: stable({ date: event.date, units: event.units }),
      });
    }
  }

  for (const component of source.variableComponents ?? []) {
    facts.push({
      key: `vc:${component.id}:treatment`,
      kind: "vc_treatment",
      ownerId: component.id,
      fingerprint: stable({ treatment: component.treatment, included: component.includedCents }),
    });
    facts.push({
      key: `vc:${component.id}:target`,
      kind: "vc_target",
      ownerId: component.id,
      fingerprint: stable(component.targetPoId ?? ""),
    });
    for (const period of component.seriesPeriods ?? []) {
      facts.push({
        key: `vc:${component.id}:series_period:${period.id}`,
        kind: "series_period_target",
        ownerId: component.id,
        fingerprint: stable({ start: period.startDate, end: period.endDate }),
      });
    }
    for (const event of component.realizedEvents ?? []) {
      facts.push({
        key: `vc:${component.id}:realized:${event.id}`,
        kind: "realized_vc_amount",
        ownerId: component.id,
        fingerprint: stable({
          date: event.date,
          amount: event.amountCents,
          period: event.seriesPeriodId ?? "",
        }),
      });
    }
  }

  for (const actual of source.usageActuals ?? []) {
    facts.push({
      key: `usage:${actual.componentId}:${actual.id}`,
      kind: "usage_actual",
      ownerId: actual.componentId,
      fingerprint: stable({ month: actual.month, quantities: actual.quantitiesByMeterId }),
    });
  }

  return facts.sort((a, b) => a.key.localeCompare(b.key));
}

export interface MaterialFactDiff {
  /** Keys whose value changed, plus keys added or removed. */
  changedKeys: string[];
  addedKeys: string[];
  removedKeys: string[];
}

export function diffMaterialFacts(
  before: readonly MaterialFact[],
  after: readonly MaterialFact[],
): MaterialFactDiff {
  const beforeMap = new Map(before.map((fact) => [fact.key, fact.fingerprint]));
  const afterMap = new Map(after.map((fact) => [fact.key, fact.fingerprint]));

  const changedKeys: string[] = [];
  const addedKeys: string[] = [];
  const removedKeys: string[] = [];

  for (const [key, fingerprint] of afterMap) {
    if (!beforeMap.has(key)) addedKeys.push(key);
    else if (beforeMap.get(key) !== fingerprint) changedKeys.push(key);
  }
  for (const key of beforeMap.keys()) {
    if (!afterMap.has(key)) removedKeys.push(key);
  }

  return {
    changedKeys: changedKeys.sort(),
    addedKeys: addedKeys.sort(),
    removedKeys: removedKeys.sort(),
  };
}

export type ReviewConclusionState = "open" | "affirmed" | "resolved";

/**
 * Carries accepted review conclusions forward across a re-analysis. Only a
 * conclusion whose own material fact changed (or disappeared) is reopened.
 */
export function carryForwardReviewConclusions(
  previous: Readonly<Record<string, ReviewConclusionState>>,
  diff: MaterialFactDiff,
): Record<string, ReviewConclusionState> {
  const reopened = new Set([...diff.changedKeys, ...diff.removedKeys]);
  const next: Record<string, ReviewConclusionState> = {};
  for (const [key, state] of Object.entries(previous)) {
    next[key] = reopened.has(key) ? "open" : state;
  }
  return next;
}

export interface OrphanCheckInput {
  validPoIds: readonly string[];
  validComponentIds: readonly string[];
  details: readonly { id: string; ownerId: string; ownerKind: "po" | "component" }[];
}

/** Rejects any pending, blocked, VC, usage or schedule detail with no owner. */
export function findOrphanDetails(input: OrphanCheckInput): string[] {
  const pos = new Set(input.validPoIds);
  const components = new Set(input.validComponentIds);
  return input.details
    .filter((detail) =>
      detail.ownerKind === "po" ? !pos.has(detail.ownerId) : !components.has(detail.ownerId),
    )
    .map((detail) => detail.id)
    .sort();
}
