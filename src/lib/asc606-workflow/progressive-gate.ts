/**
 * Phase 9G-R3 — the single workflow-owned dependency gate.
 *
 * One determination of whether the progressive contract's BALANCES and
 * JOURNALS may be presented as authoritative accounting. Every production
 * surface (the balance workpaper, the journal workpaper, finalization and the
 * progressive results panel) reads THIS result, so no two presenters can ever
 * disagree about whether an output is available.
 *
 * Presentation only: nothing is calculated here. The gate observes facts the
 * adapter and the deterministic engine already reported.
 *
 * Central R3 invariant is preserved: allocation and determinable revenue stay
 * available; only the output that mathematically depends on an unusable
 * billing or cash fact is withheld.
 */

import {
  mergeCalculationState,
  type CalculationState,
  type ProgressiveContractAnalysis,
} from "@/lib/asc606-progressive";

import type { BlockedFact } from "./r3-adapter";

export interface ProgressiveGate {
  /** Unusable billing / cash facts: the balance and journal dependencies. */
  dependencyBlockers: BlockedFact[];
  /** Engine-level blocked amounts (usage, variable consideration, allocation). */
  engineBlocked: boolean;
  balancesPresentable: boolean;
  journalsPresentable: boolean;
  /** The state every presenter must show; never "complete" while blocked. */
  state: CalculationState;
  blockedReason: string | null;
}

export function buildProgressiveGate(
  progressive: ProgressiveContractAnalysis,
  adapterBlocked: readonly BlockedFact[],
): ProgressiveGate {
  // Billing events and cash collections share the "billing_event" owner kind:
  // they are exactly the facts the Phase 3 rollforward depends on.
  const dependencyBlockers: BlockedFact[] = [];
  const _unusedDependencyBlockers = adapterBlocked.filter((fact) => fact.ownerKind === "billing_event");
  const engineBlocked = progressive.blocked.length > 0;

  const balancesPresentable =
    progressive.balances !== null && dependencyBlockers.length === 0 && !engineBlocked;
  const journalsPresentable = balancesPresentable && progressive.journals !== null;

  const state = mergeCalculationState(
    progressive.state,
    balancesPresentable ? "complete" : "blocked",
    adapterBlocked.length > 0 ? "blocked" : "complete",
  );

  // The first blocker a presenter should show: the dependency fact, then the
  // engine's own blocked amount, then any other unusable fact.
  let blockedReason: string | null = null;
  const firstDependency = dependencyBlockers[0];
  const firstEngine = progressive.blocked[0];
  const firstAdapter = adapterBlocked[0];
  if (firstDependency !== undefined) blockedReason = firstDependency.message;
  else if (engineBlocked && firstEngine !== undefined) blockedReason = firstEngine.message;
  else if (firstAdapter !== undefined) blockedReason = firstAdapter.message;

  return {
    dependencyBlockers: [...dependencyBlockers],
    engineBlocked,
    balancesPresentable,
    journalsPresentable,
    state,
    blockedReason,
  };
}
