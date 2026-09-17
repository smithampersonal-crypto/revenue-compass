/**
 * Phase 9G — Task 5. The pure, browser-safe part of the AI workspace client.
 *
 * Everything here is a total function of the safe Task 3 DTO. There is no
 * persistence, no provider, no Supabase client, no timer and no React: the
 * controller hook owns the effects, this module owns the derivations, so the
 * client model can be reasoned about (and tested) without a rendered tree.
 *
 * The server stays authoritative for run state, ownership, allowance, source
 * freshness, review fingerprints and whether a result may apply. Nothing in
 * this file decides any of those; it only projects what the server already
 * said into the shape later UI tasks consume.
 */

import { isApprovedWorkspaceMessage } from "./workspace.boundary";
import type { AiWorkspacePhase, AiWorkspaceStateDto } from "./workspace.handlers";

/** Approved active-run polling cadence. Fixed; never derived from elapsed time. */
export const AI_POLL_INTERVAL_MS = 2_000;

/* ------------------------------------------------------------- ARC copy */

/** Anything unexpected in the client, the network or the controller itself. */
export const AI_CONTROLLER_UNAVAILABLE =
  "AI analysis is unavailable right now. Reload the analysis and try again.";

/** The canonical draft could not be saved, so nothing was analyzed. */
export const AI_ANALYSIS_NOT_STARTED_UNSAVED =
  "Your latest changes could not be saved, so the analysis did not start. Try again once your changes are saved.";

/** The authoritative allowance is exhausted; no run was created or executed. */
export const AI_ANALYSIS_NOT_STARTED_NO_ALLOWANCE =
  "No analyses remain right now, so the analysis did not start.";

/**
 * Collapses anything thrown on the client into settled ARC copy. A message the
 * Task 3 boundary already approved stays distinguishable; everything else —
 * network text, framework text, an unknown throw — becomes one generic string.
 */
export function safeControllerMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : null;
  return message !== null && isApprovedWorkspaceMessage(message)
    ? message
    : AI_CONTROLLER_UNAVAILABLE;
}

/* ------------------------------------------------------------- progress */

export type AiActiveProgressPhase = "preparing" | "analyzing" | "validating" | "applying";

export interface AiWorkspaceProgress {
  phase: AiActiveProgressPhase;
  step: 1 | 2 | 3 | 4;
  label: string;
}

const PROGRESS: Record<AiActiveProgressPhase, AiWorkspaceProgress> = {
  preparing: { phase: "preparing", step: 1, label: "Preparing documents" },
  analyzing: { phase: "analyzing", step: 2, label: "Analyzing contract" },
  validating: { phase: "validating", step: 3, label: "Validating analysis" },
  applying: { phase: "applying", step: 4, label: "Updating workspace" },
};

function isActiveProgressPhase(phase: AiWorkspacePhase): phase is AiActiveProgressPhase {
  return (
    phase === "preparing" || phase === "analyzing" || phase === "validating" || phase === "applying"
  );
}

/**
 * The deterministic progress state. There is no percentage, no elapsed-time
 * estimate and no invented intermediate step: an active run is at exactly the
 * phase the server reported.
 */
export function progressOf(workspace: AiWorkspaceStateDto | null): AiWorkspaceProgress | null {
  const run = workspace?.activeRun ?? null;
  if (!run || !run.active) return null;
  return isActiveProgressPhase(run.phase) ? PROGRESS[run.phase] : null;
}

/* ----------------------------------------------------------------- mode */

export type AiAnalyzeMode = "analyze" | "reanalyze";

/** Derived from authoritative state; the browser never declares re-analysis. */
export function analyzeModeOf(workspace: AiWorkspaceStateDto | null): AiAnalyzeMode {
  return workspace?.hasAnalysis ? "reanalyze" : "analyze";
}

/* ---------------------------------------------------------------- locks */

export interface AiWorkspaceLocks {
  analyze: boolean;
  reviewActions: boolean;
  sourceDocuments: boolean;
  finalize: boolean;
}

export function isRunActive(workspace: AiWorkspaceStateDto | null): boolean {
  return workspace?.activeRun?.active === true;
}

/**
 * Client UX protection only — the server refuses these itself. Canonical
 * accounting editing, autosave and navigation are deliberately never locked.
 */
export function locksOf(workspace: AiWorkspaceStateDto | null, busy: boolean): AiWorkspaceLocks {
  const active = isRunActive(workspace) || busy;
  return {
    analyze: active,
    reviewActions: active,
    sourceDocuments: active,
    finalize: active,
  };
}
