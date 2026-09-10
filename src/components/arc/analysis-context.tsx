import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  analyzeWorkflow,
  createEmptyDraft,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { createDemoDraftIfKnown, getDemoScenario, isDemoScenarioId } from "@/lib/demo-scenarios";
import type { DemoScenario } from "@/lib/demo-scenarios";
import { loadContractAnalysis, saveDraftRevision } from "@/lib/arc/persistence/revisions.functions";
import type { LoadedRevisionDto } from "@/lib/arc/persistence/revisions.functions";
import { serializeDraft } from "@/lib/arc/persistence/schema";
import type { SaveStatus } from "@/lib/arc/persistence/save-status";

/**
 * Presentation-only provenance of the analysis currently open. It affects
 * labels and contextual actions only; every origin renders the exact same
 * workspace and the exact same engine output.
 */
export type AnalysisOrigin = "manual" | "sample" | "ai";

export interface AnalysisPersistence {
  /** True when this workspace is backed by a saved, owned contract. */
  enabled: boolean;
  status: SaveStatus;
  /** Saved-analysis metadata, once loaded. */
  revision: LoadedRevisionDto | null;
  /** Finalized / superseded revisions open read-only. */
  readOnly: boolean;
  /** Reloads the saved copy, discarding unsaved local edits. */
  reload: () => void;
}

export interface AnalysisContextValue {
  /** The single authoritative in-memory analysis draft. */
  draft: WorkflowDraft;
  setDraft: (updater: WorkflowDraft | ((previous: WorkflowDraft) => WorkflowDraft)) => void;
  /** Deterministic engine output for the current draft. */
  result: WorkflowAnalysisResult;
  origin: AnalysisOrigin;
  /** The sample id in the URL, when one was supplied. */
  sample: string | undefined;
  loadedSample: DemoScenario | null;
  unknownSample: boolean;
  resetAnalysis: () => void;
  persistence: AnalysisPersistence;
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

const AUTOSAVE_DELAY_MS = 1200;

export function AnalysisProvider({
  sample,
  contractId,
  revisionId,
  children,
}: {
  sample: string | undefined;
  contractId?: string | undefined;
  revisionId?: string | undefined;
  children: ReactNode;
}) {
  // Samples are always ephemeral fixtures and are never autosaved, so a sample
  // in the URL disables persistence entirely.
  const persistenceEnabled = Boolean(contractId) && !sample;

  // Initial state only: later user edits are never overwritten by a rerender,
  // and navigating between parent areas never remounts this provider.
  const [draft, setDraft] = useState<WorkflowDraft>(
    () => createDemoDraftIfKnown(sample) ?? createEmptyDraft(),
  );

  const result = useMemo(() => analyzeWorkflow(draft), [draft]);

  const loadedSample = isDemoScenarioId(sample) ? getDemoScenario(sample) : null;
  const unknownSample = sample !== undefined && loadedSample === null;

  const loadRevision = useServerFn(loadContractAnalysis);
  const saveRevision = useServerFn(saveDraftRevision);

  const revisionQuery = useQuery({
    queryKey: ["arc-analysis-revision", contractId ?? null, revisionId ?? null],
    enabled: persistenceEnabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      loadRevision({
        data: { contractId: contractId!, ...(revisionId ? { revisionId } : {}) },
      }),
  });

  const loaded = revisionQuery.data ?? null;

  const [status, setStatus] = useState<SaveStatus>({ kind: "off" });
  const lockVersionRef = useRef<number>(0);
  const savedSnapshotRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const blockedRef = useRef(false);

  // Adopt the saved copy as the authoritative draft once it arrives.
  useEffect(() => {
    if (!loaded) return;
    lockVersionRef.current = loaded.lockVersion;
    savedSnapshotRef.current = serializeDraft(loaded.draft);
    blockedRef.current = loaded.readOnly;
    setDraft(loaded.draft);
    setStatus(loaded.readOnly ? { kind: "read-only" } : { kind: "saved", at: null });
  }, [loaded]);

  useEffect(() => {
    if (!persistenceEnabled) {
      setStatus({ kind: "off" });
      return;
    }
    if (revisionQuery.isPending) setStatus({ kind: "loading" });
  }, [persistenceEnabled, revisionQuery.isPending]);

  useEffect(() => {
    if (persistenceEnabled && revisionQuery.isError) {
      blockedRef.current = true;
      setStatus({
        kind: "error",
        message:
          revisionQuery.error instanceof Error
            ? revisionQuery.error.message
            : "That saved analysis could not be opened.",
      });
    }
  }, [persistenceEnabled, revisionQuery.isError, revisionQuery.error]);

  const flush = useCallback(
    async (snapshot: string, payload: WorkflowDraft, revision: string) => {
      inFlightRef.current = true;
      setStatus({ kind: "saving" });
      try {
        const outcome = await saveRevision({
          data: {
            revisionId: revision,
            expectedLockVersion: lockVersionRef.current,
            draft: payload,
          },
        });
        if (!outcome.ok) {
          blockedRef.current = true;
          setStatus({ kind: "conflict" });
          return;
        }
        lockVersionRef.current = outcome.lockVersion;
        savedSnapshotRef.current = snapshot;
        setStatus({ kind: "saved", at: outcome.savedAt });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Your latest edits could not be saved.",
        });
      } finally {
        inFlightRef.current = false;
      }
    },
    [saveRevision],
  );

  // Debounced autosave. A conflict or load failure stops further writes so the
  // browser can never overwrite work it has not seen.
  useEffect(() => {
    if (!persistenceEnabled || !loaded || loaded.readOnly || blockedRef.current) return;
    const snapshot = serializeDraft(draft);
    if (snapshot === savedSnapshotRef.current) return;
    if (inFlightRef.current) return;

    setStatus((current) => (current.kind === "saving" ? current : { kind: "unsaved" }));
    const timer = setTimeout(() => {
      void flush(snapshot, draft, loaded.revisionId);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, persistenceEnabled, loaded, flush]);

  const reload = useCallback(() => {
    blockedRef.current = false;
    void revisionQuery.refetch();
  }, [revisionQuery]);

  const persistence = useMemo<AnalysisPersistence>(
    () => ({
      enabled: persistenceEnabled,
      status,
      revision: loaded,
      readOnly: Boolean(loaded?.readOnly),
      reload,
    }),
    [persistenceEnabled, status, loaded, reload],
  );

  const value = useMemo<AnalysisContextValue>(
    () => ({
      draft,
      setDraft,
      result,
      origin: loadedSample ? "sample" : "manual",
      sample,
      loadedSample,
      unknownSample,
      // A sample resets back to its canonical fixture (the URL, and therefore
      // the sample origin, is untouched); a manual analysis resets to blank.
      resetAnalysis: () => {
        setDraft(createDemoDraftIfKnown(sample) ?? createEmptyDraft());
      },
      persistence,
    }),
    [draft, result, loadedSample, unknownSample, sample, persistence],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextValue {
  const value = useContext(AnalysisContext);
  if (!value) {
    throw new Error("useAnalysis must be used inside the /analysis layout route.");
  }
  return value;
}
