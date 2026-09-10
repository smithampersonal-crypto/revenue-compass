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
import { loadContractAnalysis, saveDraftRevision } from "@/lib/arc/persistence/revisions.functions";
import type { LoadedRevisionDto } from "@/lib/arc/persistence/revisions.functions";
import type { DemoScenario } from "@/lib/demo-scenarios";
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
  /** Retries an ordinary failed save, keeping local edits. */
  retrySave: () => void;
}

export interface AnalysisContextValue {
  /** The single authoritative in-memory analysis draft. */
  draft: WorkflowDraft;
  setDraft: (updater: WorkflowDraft | ((previous: WorkflowDraft) => WorkflowDraft)) => void;
  /** Deterministic engine output for the current draft. */
  result: WorkflowAnalysisResult;
  /**
   * False for finalized / superseded revisions and while a saved analysis is
   * loading or failed to load. Every accounting input must respect it.
   */
  canEdit: boolean;
  origin: AnalysisOrigin;
  /** The sample id in the URL, when one was supplied. */
  sample: string | undefined;
  loadedSample: DemoScenario | null;
  unknownSample: boolean;
  resetAnalysis: () => void;
  persistence: AnalysisPersistence;
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

/** Approved autosave debounce. */
const AUTOSAVE_DELAY_MS = 750;

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
  const [draft, setDraftState] = useState<WorkflowDraft>(
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
  /**
   * The last server-accepted snapshot, held as state so it is committed in the
   * same batch as the draft it describes. A ref alone would make the autosave
   * effect briefly compare a new baseline against the previous draft and
   * report spurious unsaved changes.
   */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  /** Set on conflict or load failure; stops all further autosaves. */
  const blockedRef = useRef(false);
  /** Always the newest in-memory draft, even mid-save. */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Adopt the saved copy as the authoritative draft once it arrives.
  useEffect(() => {
    if (!loaded) return;
    lockVersionRef.current = loaded.lockVersion;
    savedSnapshotRef.current = serializeDraft(loaded.draft);
    setSavedSnapshot(savedSnapshotRef.current);
    blockedRef.current = loaded.readOnly;
    draftRef.current = loaded.draft;
    setDraftState(loaded.draft);
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
        kind: "load-error",
        message:
          revisionQuery.error instanceof Error
            ? revisionQuery.error.message
            : "That saved analysis could not be opened.",
      });
    }
  }, [persistenceEnabled, revisionQuery.isError, revisionQuery.error]);

  /**
   * Saves until the server holds the newest draft. If the draft changes while
   * a save is in flight, the newer draft is saved immediately afterwards with
   * the lock version the accepted save returned, and the UI never claims
   * "Saved" while newer local edits exist.
   */
  const runSave = useCallback(
    async (revision: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        for (;;) {
          if (blockedRef.current) break;
          const payload = draftRef.current;
          const snapshot = serializeDraft(payload);
          if (snapshot === savedSnapshotRef.current) break;

          setStatus({ kind: "saving" });
          let outcome;
          try {
            outcome = await saveRevision({
              data: {
                revisionId: revision,
                expectedLockVersion: lockVersionRef.current,
                draft: payload,
              },
            });
          } catch (error) {
            setStatus({
              kind: "error",
              message:
                error instanceof Error && error.message
                  ? error.message
                  : "Your latest edits could not be saved.",
            });
            break;
          }

          if (!outcome.ok) {
            blockedRef.current = true;
            setStatus({ kind: "conflict" });
            break;
          }

          lockVersionRef.current = outcome.lockVersion;
          savedSnapshotRef.current = snapshot;
          setSavedSnapshot(snapshot);

          if (serializeDraft(draftRef.current) === snapshot) {
            setStatus({ kind: "saved", at: outcome.savedAt });
            break;
          }
          // A newer draft arrived mid-save: keep saving before reporting Saved.
        }
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
    if (savedSnapshot === null) return;
    const snapshot = serializeDraft(draft);
    if (snapshot === savedSnapshot) return;

    setStatus((current) => (current.kind === "saving" ? current : { kind: "unsaved" }));
    const timer = setTimeout(() => {
      void runSave(loaded.revisionId);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, persistenceEnabled, loaded, runSave, savedSnapshot]);

  const reload = useCallback(() => {
    blockedRef.current = false;
    void revisionQuery.refetch();
  }, [revisionQuery]);

  const retrySave = useCallback(() => {
    if (!loaded || loaded.readOnly || blockedRef.current) return;
    void runSave(loaded.revisionId);
  }, [loaded, runSave]);

  // A saved analysis is only editable once its saved copy is in hand. Until
  // then the blank placeholder must not be editable, and a failed load must
  // never leave an editable blank workspace that looks like the contract.
  const canEdit = persistenceEnabled ? Boolean(loaded) && !loaded!.readOnly : true;

  const setDraft = useCallback<AnalysisContextValue["setDraft"]>(
    (updater) => {
      if (!canEdit) return;
      setDraftState((previous) =>
        typeof updater === "function"
          ? (updater as (p: WorkflowDraft) => WorkflowDraft)(previous)
          : updater,
      );
    },
    [canEdit],
  );

  const persistence = useMemo<AnalysisPersistence>(
    () => ({
      enabled: persistenceEnabled,
      status,
      revision: loaded,
      readOnly: Boolean(loaded?.readOnly),
      reload,
      retrySave,
    }),
    [persistenceEnabled, status, loaded, reload, retrySave],
  );

  const resetAnalysis = useCallback(() => {
    if (!canEdit) return;
    setDraftState(createDemoDraftIfKnown(sample) ?? createEmptyDraft());
  }, [canEdit, sample]);

  const value = useMemo<AnalysisContextValue>(
    () => ({
      draft,
      setDraft,
      result,
      canEdit,
      origin: loadedSample ? "sample" : "manual",
      sample,
      loadedSample,
      unknownSample,
      // A sample resets back to its canonical fixture (the URL, and therefore
      // the sample origin, is untouched); a manual analysis resets to blank.
      resetAnalysis,
      persistence,
    }),
    [
      draft,
      setDraft,
      result,
      canEdit,
      loadedSample,
      unknownSample,
      sample,
      resetAnalysis,
      persistence,
    ],
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
