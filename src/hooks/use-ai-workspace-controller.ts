/**
 * Phase 9G — Task 5. The AI workspace client controller.
 *
 * One mounted controller owns the whole client side of the AI lifecycle:
 * the initial safe read, reconnecting to a run that is already executing,
 * active-run polling, the deliberate Analyze / Re-analyze action and the three
 * accepted review actions.
 *
 * What it deliberately does NOT own: run state, ownership, lock validation,
 * allowance, source freshness, review fingerprints, review resolution,
 * provenance, failure classification and whether a result may apply. All of
 * that is read from the safe Task 3 DTO, which is the browser's only read
 * model — no AI table, no run store, no provider and no raw run history is
 * reachable from here.
 *
 * Every server call arrives through injected ports, so the controller is
 * testable without a framework transform and without any network at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AI_ANALYSIS_NOT_STARTED_NO_ALLOWANCE,
  AI_ANALYSIS_NOT_STARTED_UNSAVED,
  AI_POLL_INTERVAL_MS,
  analyzeModeOf,
  isRunActive,
  locksOf,
  progressOf,
  safeControllerMessage,
  type AiAnalyzeMode,
  type AiWorkspaceLocks,
  type AiWorkspaceProgress,
} from "@/lib/arc/ai/workspace-client";
import type {
  AiEvidenceLinkDto,
  AiReviewGuidanceDto,
} from "@/lib/arc/ai/review-evidence.handlers";
import type { AiAnalysisRequestDto, AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

/* ---------------------------------------------------------------- ports */

export interface AiWorkspacePorts {
  getWorkspaceState(input: { revisionId: string | null }): Promise<AiWorkspaceStateDto>;
  requestAnalysis(input: { revisionId: string | null }): Promise<AiAnalysisRequestDto>;
  /** Phase 9F execution. Long-lived; never called by a read or a poll. */
  executeAnalysis(input: { runId: string; revisionId: string | null }): Promise<unknown>;
  affirmReviewItem(input: {
    revisionId: string | null;
    reviewItemId: string;
    expectedReviewFingerprint: string;
    method?: "individual" | "page_all" | "global_all";
  }): Promise<AiWorkspaceStateDto>;
  resolveReviewIssue(input: {
    revisionId: string | null;
    reviewItemId: string;
    expectedReviewFingerprint: string;
    reason: string;
    note?: string | null;
  }): Promise<AiWorkspaceStateDto>;
  acknowledgeStaleSources(input: {
    revisionId: string | null;
    expectedSourceSetFingerprint: string;
  }): Promise<AiWorkspaceStateDto>;
  /** Task 9A. Returns an ephemeral signed view link; never persisted. */
  openReviewEvidence(input: {
    revisionId: string | null;
    reviewItemId: string;
    expectedReviewFingerprint: string;
    citationIndex: number;
  }): Promise<AiEvidenceLinkDto>;
  /** Task 9B. Returns the approved accountant-facing Guidance cards only. */
  getReviewGuidance(input: {
    revisionId: string | null;
    reviewItemId: string;
    expectedReviewFingerprint: string;
  }): Promise<AiReviewGuidanceDto>;
  /** Task 9C. Deliberate whole-run restore to the exact pre-run snapshot. */
  restoreAnalysis(input: {
    revisionId: string | null;
    expectedRunId: string;
  }): Promise<{ restoredRunId: string; workspace: AiWorkspaceStateDto }>;
  /**
   * Waits for the accepted Task 4 autosave pipeline to settle. The controller
   * never implements a second save mechanism; it only refuses to analyze
   * against a draft the server has not accepted.
   */
  flushAutosave(): Promise<{ ok: boolean }>;
  /** The established authoritative canonical reload. Never a client-side merge. */
  reloadCanonicalAnalysis(): void;
}

/* ---------------------------------------------------------------- state */

export type AiLoadState = "idle" | "loading" | "ready" | "error";
export type AiActionState = "idle" | "requesting" | "executing";

export interface AiWorkspaceController {
  workspace: AiWorkspaceStateDto | null;
  loadState: AiLoadState;
  actionState: AiActionState;
  active: boolean;
  progress: AiWorkspaceProgress | null;
  analyzeMode: AiAnalyzeMode;
  locks: AiWorkspaceLocks;
  /** Settled ARC copy only. Never a raw exception message. */
  message: string | null;
  analyze: () => Promise<void>;
  affirmReviewItem: (input: {
    reviewItemId: string;
    expectedReviewFingerprint: string;
    method?: "individual" | "page_all" | "global_all";
  }) => Promise<void>;
  resolveReviewIssue: (input: {
    reviewItemId: string;
    expectedReviewFingerprint: string;
    reason: string;
    note?: string | null;
  }) => Promise<void>;
  acknowledgeStaleSources: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface AiWorkspaceControllerOptions {
  /**
   * A deterministic key for the analysis currently open. `null` disables the
   * controller entirely (sample, in-memory or not-yet-loaded workspace), and
   * any change to it is a scope change: older responses are discarded.
   */
  scopeKey: string | null;
  /** The saved revision being read, or `null` for a guest workspace. */
  revisionId: string | null;
  ports: AiWorkspacePorts;
  pollIntervalMs?: number;
}

/* ----------------------------------------------------------- controller */

export function useAiWorkspaceController(
  options: AiWorkspaceControllerOptions,
): AiWorkspaceController {
  const { scopeKey, revisionId, ports, pollIntervalMs = AI_POLL_INTERVAL_MS } = options;
  const enabled = scopeKey !== null;

  const [workspace, setWorkspace] = useState<AiWorkspaceStateDto | null>(null);
  const [loadState, setLoadState] = useState<AiLoadState>("idle");
  const [actionState, setActionState] = useState<AiActionState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const portsRef = useRef(ports);
  portsRef.current = ports;

  /** Bumped on every scope change; a response from an older scope is dropped. */
  const generationRef = useRef(0);
  /** Monotonic read id, so an older poll can never overwrite a newer refresh. */
  const requestSeqRef = useRef(0);
  const adoptedSeqRef = useRef(0);
  /**
   * At most one outstanding workspace read — held as the token of the read
   * that owns the gate, never as a shared boolean. A scope change abandons the
   * old token, and the abandoned read's cleanup can no longer free the gate
   * the new scope's read is holding.
   */
  const readInFlightRef = useRef<{ generation: number; seq: number } | null>(null);
  /**
   * Single-flight guard for the deliberate action, owned by the generation
   * that started it: a new workspace may analyze while an older scope's
   * request is still unresolved, and the older action cannot clear the guard
   * the newer one holds.
   */
  const analyzeInFlightRef = useRef<number | null>(null);
  /** Runs whose terminal outcome has already been handled once. */
  const terminalHandledRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const workspaceRef = useRef<AiWorkspaceStateDto | null>(null);
  workspaceRef.current = workspace;
  const revisionIdRef = useRef(revisionId);
  revisionIdRef.current = revisionId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Adopts a server response if, and only if, it belongs to the current scope
   * and is newer than whatever has already been adopted.
   */
  const adopt = useCallback((next: AiWorkspaceStateDto, generation: number, seq: number) => {
    if (!mountedRef.current) return;
    if (generation !== generationRef.current) return;
    if (seq < adoptedSeqRef.current) return;
    adoptedSeqRef.current = seq;

    const previous = workspaceRef.current;
    workspaceRef.current = next;
    setWorkspace(next);
    setLoadState("ready");

    // A run that has just left the active set. Success means the server has
    // already applied a new canonical draft, so the authoritative analysis is
    // reloaded — never reconstructed in the browser.
    const previousRunId = previous?.activeRun?.runId ?? null;
    const finished =
      previousRunId !== null && (next.activeRun === null || next.activeRun.runId !== previousRunId);
    if (finished && !terminalHandledRef.current.has(previousRunId)) {
      terminalHandledRef.current.add(previousRunId);
      if (
        next.latestRun &&
        next.latestRun.runId === previousRunId &&
        next.latestRun.phase === "succeeded"
      ) {
        portsRef.current.reloadCanonicalAnalysis();
      }
    }
  }, []);

  const read = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    if (readInFlightRef.current) return;
    const generation = generationRef.current;
    const seq = ++requestSeqRef.current;
    const token = { generation, seq };
    readInFlightRef.current = token;
    try {
      const state = await portsRef.current.getWorkspaceState({
        revisionId: revisionIdRef.current,
      });
      adopt(state, generation, seq);
    } catch (error) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setMessage(safeControllerMessage(error));
      if (workspaceRef.current === null) setLoadState("error");
    } finally {
      // Only the read that still owns the gate may release it.
      if (readInFlightRef.current === token) readInFlightRef.current = null;
    }
  }, [adopt, enabled]);

  // Initial load, and a full reset whenever the workspace scope changes: the
  // previous scope's state is dropped immediately and its responses are
  // invalidated, so a slow read can never land on the new analysis.
  useEffect(() => {
    generationRef.current += 1;
    adoptedSeqRef.current = 0;
    // The previous scope's read is abandoned, not awaited.
    readInFlightRef.current = null;
    terminalHandledRef.current = new Set();
    workspaceRef.current = null;
    setWorkspace(null);
    setMessage(null);
    setActionState("idle");
    if (!enabled) {
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    void read();
  }, [scopeKey, enabled, read]);

  const active = isRunActive(workspace);

  // Active-run polling: one immediate read on entering the active state, then
  // a fixed cadence, stopped by a terminal run, a scope change or unmount.
  useEffect(() => {
    if (!enabled || !active) return;
    void read();
    const timer = setInterval(() => {
      void read();
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [enabled, active, pollIntervalMs, read]);

  /* ------------------------------------------------------ deliberate run */

  const analyze = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    const generation = generationRef.current;
    // Client-side hygiene only: a double click within one workspace is one
    // request, one execution and one allowance reservation. The guard belongs
    // to this generation, so a newly opened workspace is never held back by an
    // older scope's unresolved request. The server remains the real boundary.
    if (analyzeInFlightRef.current === generation) return;
    analyzeInFlightRef.current = generation;
    /**
     * The action is bound to the analysis that started it. Everything it sends
     * to the server uses this captured scope, even if the user navigates away
     * mid-request; only current-generation UI state is ever touched.
     */
    const invocationRevisionId = revisionIdRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current;
    setMessage(null);
    setActionState("requesting");

    let executing = false;
    try {
      // The analysis must run against the authoritative saved canonical draft.
      const flushed = await portsRef.current.flushAutosave();
      if (!flushed.ok) {
        if (isCurrent()) setMessage(AI_ANALYSIS_NOT_STARTED_UNSAVED);
        return;
      }
      if (generation !== generationRef.current) return;

      // No allowance means no run is created and the provider is never
      // contacted; the authoritative allowance is simply re-read.
      const current = workspaceRef.current;
      if (current && current.activeRun === null && current.allowance.remaining <= 0) {
        setMessage(AI_ANALYSIS_NOT_STARTED_NO_ALLOWANCE);
        await read();
        return;
      }

      const seq = ++requestSeqRef.current;
      const requested = await portsRef.current.requestAnalysis({
        revisionId: invocationRevisionId,
      });
      adopt(requested, generation, seq);

      const runId = requested.activeRun?.runId ?? null;
      if (requested.executionDisposition === "start_execution" && runId !== null) {
        executing = true;
        if (isCurrent()) setActionState("executing");
        // Execution is long-lived. Polling continues independently, the
        // promise can never become an unhandled rejection, and its raw error
        // text is never presented: the deterministic Task 3 failure is read
        // back from the server instead.
        void portsRef.current
          .executeAnalysis({ runId, revisionId: invocationRevisionId })
          .catch(() => undefined)
          .then(async () => {
            if (!isCurrent()) return;
            await read();
            if (isCurrent()) setActionState("idle");
          });
      }
    } catch (error) {
      if (isCurrent()) setMessage(safeControllerMessage(error));
    } finally {
      // An older action must never clear a newer generation's guard.
      if (analyzeInFlightRef.current === generation) analyzeInFlightRef.current = null;
      if (!executing && isCurrent()) setActionState("idle");
    }
  }, [adopt, enabled, read]);

  /* -------------------------------------------------------- review actions */

  const runReviewAction = useCallback(
    async (operation: () => Promise<AiWorkspaceStateDto>): Promise<void> => {
      if (!enabled) return;
      // Review actions are locked while a run is active; the server refuses
      // them too, so this is only a UX protection.
      if (isRunActive(workspaceRef.current)) return;
      const generation = generationRef.current;
      setMessage(null);
      try {
        const state = await operation();
        adopt(state, generation, ++requestSeqRef.current);
      } catch (error) {
        if (!mountedRef.current || generation !== generationRef.current) return;
        // A stale fingerprint, a reopened item or another tab acting first is
        // never merged locally: the authoritative state is re-read.
        setMessage(safeControllerMessage(error));
        await read();
      }
    },
    [adopt, enabled, read],
  );

  const affirmReviewItem = useCallback<AiWorkspaceController["affirmReviewItem"]>(
    (input) =>
      runReviewAction(() =>
        portsRef.current.affirmReviewItem({ ...input, revisionId: revisionIdRef.current }),
      ),
    [runReviewAction],
  );

  const resolveReviewIssue = useCallback<AiWorkspaceController["resolveReviewIssue"]>(
    (input) =>
      runReviewAction(() =>
        portsRef.current.resolveReviewIssue({ ...input, revisionId: revisionIdRef.current }),
      ),
    [runReviewAction],
  );

  const acknowledgeStaleSources = useCallback<
    AiWorkspaceController["acknowledgeStaleSources"]
  >(() => {
    const fingerprint = workspaceRef.current?.sourceSetFingerprint ?? null;
    if (fingerprint === null) return Promise.resolve();
    // The displayed fingerprint is only an optimistic precondition; the server
    // re-derives the authoritative one and fails closed. Nothing is cached.
    return runReviewAction(() =>
      portsRef.current.acknowledgeStaleSources({
        revisionId: revisionIdRef.current,
        expectedSourceSetFingerprint: fingerprint,
      }),
    );
  }, [runReviewAction]);

  const locks = useMemo(() => locksOf(workspace, actionState !== "idle"), [workspace, actionState]);

  return {
    workspace,
    loadState,
    actionState,
    active,
    progress: progressOf(workspace),
    analyzeMode: analyzeModeOf(workspace),
    locks,
    message,
    analyze,
    affirmReviewItem,
    resolveReviewIssue,
    acknowledgeStaleSources,
    refresh: read,
  };
}
