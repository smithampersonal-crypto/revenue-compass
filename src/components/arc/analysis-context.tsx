import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  createEmptyDraft,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { buildWorkpaper, type ArcWorkpaper } from "@/lib/arc/persistence/snapshot";
import { createDemoDraftIfKnown, getDemoScenario, isDemoScenarioId } from "@/lib/demo-scenarios";
import { loadContractAnalysis, saveDraftRevision } from "@/lib/arc/persistence/revisions.functions";
import type { LoadedRevisionDto } from "@/lib/arc/persistence/revisions.functions";
import { resumeGuestWorkspace, saveGuestDraft } from "@/lib/arc/persistence/guest.functions";
import type { GuestWorkspaceDto } from "@/lib/arc/persistence/guest.functions";
import type { DemoScenario } from "@/lib/demo-scenarios";
import { serializeDraft } from "@/lib/arc/persistence/schema";
import type { SaveStatus } from "@/lib/arc/persistence/save-status";

/**
 * Presentation-only provenance of the analysis currently open. It affects
 * labels and contextual actions only; every origin renders the exact same
 * workspace and the exact same engine output.
 */
export type AnalysisOrigin = "manual" | "sample" | "ai";

/**
 * Where the open analysis is stored.
 *  - `sample`   fixture only; never autosaved.
 *  - `memory`   in-memory only; nothing is stored anywhere.
 *  - `guest`    temporary 9-hour server-side workspace, authorized by an
 *               HttpOnly credential the browser cannot read.
 *  - `contract` a saved, owned contract revision.
 */
export type AnalysisBackingStore = "sample" | "memory" | "guest" | "contract";

export interface AnalysisPersistence {
  /** True when edits are saved server-side (guest workspace or saved contract). */
  enabled: boolean;
  mode: AnalysisBackingStore;
  status: SaveStatus;
  /** Saved-analysis metadata, once a fresh server load has been adopted. */
  revision: LoadedRevisionDto | null;
  /** Guest only: when this temporary workspace stops working. */
  guestExpiresAt: string | null;
  /**
   * The newest lock version the server has accepted for this revision. It is
   * initialized from the adopted fresh load and advances only on an accepted
   * save; a conflict or a failed save never advances it. Finalization (7D)
   * must use this value, not `revision.lockVersion`.
   */
  lockVersion: number | null;
  /** Finalized / superseded revisions open read-only. */
  readOnly: boolean;
  /** Reloads the saved copy, discarding unsaved local edits. */
  reload: () => void;
  /**
   * Adopts a lock version accepted by another trusted operation on the same
   * revision (Phase 8C source-document selection). Source documents and the
   * accounting form share one authoritative revision lock, so the next
   * autosave must send the version the server just returned.
   */
  applyLockVersion: (next: number) => void;
  /** Retries an ordinary failed save, keeping local edits. */
  retrySave: () => void;
  /**
   * True from the moment the accountant confirms finalization until the server
   * answers. The whole workspace is non-editable while it is true, so nothing
   * can change the draft the server is finalizing.
   */
  finalizing: boolean;
  setFinalizing: (value: boolean) => void;
}

/**
 * A finalized or superseded revision presented from its recorded snapshot.
 * `error` is set when the recording is missing or unusable: the workspace then
 * fails closed instead of recalculating the inputs with the current engine.
 */
export interface HistoricalPresentation {
  active: boolean;
  status: "finalized" | "superseded" | null;
  engineVersion: string | null;
  engineVersionMatchesCurrent: boolean;
  error: string | null;
}

export interface AnalysisContextValue {
  /** The single authoritative in-memory analysis draft. */
  draft: WorkflowDraft;
  setDraft: (updater: WorkflowDraft | ((previous: WorkflowDraft) => WorkflowDraft)) => void;
  /**
   * Deterministic engine output presented by the workspace. For an editable,
   * manual, sample or draft analysis this is the live engine run; for a
   * finalized or superseded revision it is the recorded snapshot.
   */
  result: WorkflowAnalysisResult;
  /** Every engine output the workspace presents, from the same source. */
  workpaper: ArcWorkpaper;
  historical: HistoricalPresentation;
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

/**
 * Inert placeholder used only when a historical recording cannot be read. It
 * is derived from an empty draft, never from the historical draft, so no
 * current engine ever sees historical inputs. Every output area is suppressed
 * in that state; this only keeps the context shape stable.
 */
let placeholder: ArcWorkpaper | null = null;
function placeholderWorkpaper(): ArcWorkpaper {
  placeholder ??= buildWorkpaper(createEmptyDraft());
  return placeholder;
}

/** The adopted server copy, normalized across the two backing stores. */
type LoadedAnalysis =
  | {
      kind: "contract";
      draft: WorkflowDraft;
      lockVersion: number;
      readOnly: boolean;
      revision: LoadedRevisionDto;
      guestExpiresAt: null;
    }
  | {
      kind: "guest";
      draft: WorkflowDraft;
      lockVersion: number;
      readOnly: false;
      revision: null;
      guestExpiresAt: string;
    };

function normalizeLoaded(data: LoadedRevisionDto | GuestWorkspaceDto): LoadedAnalysis {
  if ("kind" in data && data.kind === "guest") {
    return {
      kind: "guest",
      draft: data.draft,
      lockVersion: data.lockVersion,
      readOnly: false,
      revision: null,
      guestExpiresAt: data.expiresAt,
    };
  }
  const revision = data as LoadedRevisionDto;
  return {
    kind: "contract",
    draft: revision.draft,
    lockVersion: revision.lockVersion,
    readOnly: revision.readOnly,
    revision,
    guestExpiresAt: null,
  };
}

export function AnalysisProvider({
  sample,
  contractId,
  revisionId,
  guest = false,
  children,
}: {
  sample: string | undefined;
  contractId?: string | undefined;
  revisionId?: string | undefined;
  /** Bare /analysis in the running app: back the analysis with a guest workspace. */
  guest?: boolean;
  children: ReactNode;
}) {
  // Samples are always ephemeral fixtures and are never autosaved, so a sample
  // in the URL disables persistence entirely. Bare /analysis is backed by a
  // temporary guest workspace; a contract id opens the saved analysis.
  const mode: AnalysisBackingStore = sample
    ? "sample"
    : contractId
      ? "contract"
      : guest
        ? "guest"
        : "memory";
  const persistenceEnabled = mode === "contract" || mode === "guest";

  // Initial state only: later user edits are never overwritten by a rerender,
  // and navigating between parent areas never remounts this provider.
  const [draft, setDraftState] = useState<WorkflowDraft>(
    () => createDemoDraftIfKnown(sample) ?? createEmptyDraft(),
  );

  // The live engines run only for an editable manual / sample / draft
  // analysis. A historical revision never reaches them — see `workpaper`.

  const loadedSample = isDemoScenarioId(sample) ? getDemoScenario(sample) : null;
  const unknownSample = sample !== undefined && loadedSample === null;

  const loadRevision = useServerFn(loadContractAnalysis);
  const saveRevision = useServerFn(saveDraftRevision);
  const resumeGuest = useServerFn(resumeGuestWorkspace);
  const saveGuest = useServerFn(saveGuestDraft);
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => ["arc-analysis-revision", mode, contractId ?? null, revisionId ?? null] as const,
    [mode, contractId, revisionId],
  );

  /**
   * Only a server response received at or after this moment counts as a fresh
   * authoritative load. It starts at mount time (so React Query's retained
   * cache is never adopted as authoritative) and is reset by an explicit
   * Reload saved version.
   */
  const [loadEpoch, setLoadEpoch] = useState<number>(() => Date.now());

  const revisionQuery = useQuery({
    queryKey,
    enabled: persistenceEnabled,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: (): Promise<LoadedRevisionDto | GuestWorkspaceDto> =>
      mode === "guest"
        ? resumeGuest({ data: undefined as never })
        : loadRevision({
            data: { contractId: contractId!, ...(revisionId ? { revisionId } : {}) },
          }),
  });

  /**
   * The adopted, freshly loaded workspace. Cached query data is never adopted:
   * a persistent revision only becomes editable and authoritative after the
   * current identity's own load has completed successfully.
   */
  const [loaded, setLoaded] = useState<LoadedAnalysis | null>(null);

  const [status, setStatus] = useState<SaveStatus>({ kind: "off" });
  const lockVersionRef = useRef<number>(0);
  /** Authoritative server-accepted lock version, exposed to consumers. */
  const [lockVersion, setLockVersion] = useState<number | null>(null);
  /** Time of the last accepted save, reused when a reverted draft returns to Saved. */
  const lastSavedAtRef = useRef<string | null>(null);
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
  /** `dataUpdatedAt` of the response already adopted (or deliberately skipped). */
  const consumedAtRef = useRef<number>(0);
  const loadedRef = useRef<LoadedAnalysis | null>(null);
  loadedRef.current = loaded;

  // Adopt a fresh server response as the authoritative draft. A response that
  // predates this mount (or the current explicit reload) is React Query cache,
  // not an authoritative load, and is never adopted.
  useEffect(() => {
    if (!persistenceEnabled) return;
    const data = revisionQuery.data;
    if (!data || revisionQuery.isFetching) return;
    const updatedAt = revisionQuery.dataUpdatedAt;
    if (updatedAt < loadEpoch) return;
    if (updatedAt === consumedAtRef.current) return;
    consumedAtRef.current = updatedAt;

    const next = normalizeLoaded(data);

    // A background refetch must never silently discard local work.
    const current = loadedRef.current;
    if (current && savedSnapshotRef.current !== null) {
      const dirty = serializeDraft(draftRef.current) !== savedSnapshotRef.current;
      if (dirty) {
        if (next.lockVersion !== lockVersionRef.current) {
          blockedRef.current = true;
          setStatus({ kind: "conflict" });
        }
        return;
      }
    }

    lockVersionRef.current = next.lockVersion;
    setLockVersion(next.lockVersion);
    lastSavedAtRef.current = null;
    savedSnapshotRef.current = serializeDraft(next.draft);
    setSavedSnapshot(savedSnapshotRef.current);
    blockedRef.current = next.readOnly;
    draftRef.current = next.draft;
    setDraftState(next.draft);
    setLoaded(next);
    setStatus(next.readOnly ? { kind: "read-only" } : { kind: "saved", at: null });
  }, [
    persistenceEnabled,
    revisionQuery.data,
    revisionQuery.isFetching,
    revisionQuery.dataUpdatedAt,
    loadEpoch,
  ]);

  // Until a fresh load is adopted the workspace is a disabled placeholder,
  // never a Saved analysis.
  useEffect(() => {
    if (!persistenceEnabled) {
      setStatus({ kind: "off" });
      return;
    }
    if (loaded) return;
    if (revisionQuery.isError && revisionQuery.errorUpdatedAt >= loadEpoch) {
      blockedRef.current = true;
      setStatus({
        kind: "load-error",
        message:
          revisionQuery.error instanceof Error
            ? revisionQuery.error.message
            : "That saved analysis could not be opened.",
      });
      return;
    }
    setStatus({ kind: "loading" });
  }, [
    persistenceEnabled,
    loaded,
    revisionQuery.isError,
    revisionQuery.error,
    revisionQuery.errorUpdatedAt,
    loadEpoch,
  ]);

  /**
   * Saves until the server holds the newest draft. If the draft changes while
   * a save is in flight, the newer draft is saved immediately afterwards with
   * the lock version the accepted save returned, and the UI never claims
   * "Saved" while newer local edits exist.
   *
   * The guest workspace uses the same optimistic-lock sequencing; only the
   * transport differs, and the guest credential stays in the HttpOnly cookie.
   */
  const runSave = useCallback(
    async (target: LoadedAnalysis) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        for (;;) {
          if (blockedRef.current) break;
          const payload = draftRef.current;
          const snapshot = serializeDraft(payload);
          if (snapshot === savedSnapshotRef.current) {
            // The draft was reverted to the server-accepted copy mid-flight.
            setStatus((current) =>
              current.kind === "saving" ? { kind: "saved", at: lastSavedAtRef.current } : current,
            );
            break;
          }

          setStatus({ kind: "saving" });
          let outcome;
          try {
            outcome =
              target.kind === "guest"
                ? await saveGuest({
                    data: { expectedLockVersion: lockVersionRef.current, draft: payload },
                  })
                : await saveRevision({
                    data: {
                      revisionId: target.revision.revisionId,
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
            setStatus(
              "reason" in outcome && outcome.reason === "expired"
                ? { kind: "guest-expired" }
                : { kind: "conflict" },
            );
            break;
          }

          lockVersionRef.current = outcome.lockVersion;
          setLockVersion(outcome.lockVersion);
          lastSavedAtRef.current = outcome.savedAt;
          savedSnapshotRef.current = snapshot;
          setSavedSnapshot(snapshot);

          // Keep React Query's cache coherent with what the server accepted so
          // a later remount can never resurrect the pre-save draft or lock.
          queryClient.setQueryData(
            queryKey,
            (previous: LoadedRevisionDto | GuestWorkspaceDto | undefined) =>
              previous
                ? { ...previous, draft: payload, lockVersion: outcome.lockVersion }
                : previous,
          );
          const state = queryClient.getQueryState(queryKey);
          if (state) consumedAtRef.current = state.dataUpdatedAt;

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
    [saveRevision, saveGuest, queryClient, queryKey],
  );

  // Debounced autosave. A conflict or load failure stops further writes so the
  // browser can never overwrite work it has not seen.
  useEffect(() => {
    if (!persistenceEnabled || !loaded || loaded.readOnly || blockedRef.current) return;
    if (savedSnapshot === null) return;
    const snapshot = serializeDraft(draft);
    if (snapshot === savedSnapshot) {
      // Edits were reverted back to the server-accepted copy: nothing is
      // outstanding, so an "Unsaved changes" or "Save failed" state (and its
      // retry action) must clear. A conflict is deliberately never cleared
      // this way — the server may hold a genuinely newer version.
      if (!inFlightRef.current) {
        setStatus((current) =>
          current.kind === "unsaved" || current.kind === "error"
            ? { kind: "saved", at: lastSavedAtRef.current }
            : current,
        );
      }
      return;
    }

    setStatus((current) => (current.kind === "saving" ? current : { kind: "unsaved" }));
    const timer = setTimeout(() => {
      void runSave(loaded);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, persistenceEnabled, loaded, runSave, savedSnapshot]);

  // Explicit reload is a real loading boundary: the workspace stops being
  // editable and stops autosaving until the new server copy has arrived.
  const reload = useCallback(() => {
    blockedRef.current = false;
    setLoaded(null);
    setLockVersion(null);
    setSavedSnapshot(null);
    savedSnapshotRef.current = null;
    setStatus({ kind: "loading" });
    setLoadEpoch(Date.now());
    void revisionQuery.refetch();
  }, [revisionQuery]);

  /**
   * A source-document mutation advanced the same revision's lock. Adopt it as
   * the authoritative version everywhere the accounting autosave reads it,
   * without touching the local draft.
   */
  const applyLockVersion = useCallback(
    (next: number) => {
      lockVersionRef.current = next;
      setLockVersion(next);
      setLoaded((current) => (current ? { ...current, lockVersion: next } : current));
      queryClient.setQueryData(
        queryKey,
        (previous: LoadedRevisionDto | GuestWorkspaceDto | undefined) =>
          previous ? { ...previous, lockVersion: next } : previous,
      );
      const state = queryClient.getQueryState(queryKey);
      if (state) consumedAtRef.current = state.dataUpdatedAt;
    },
    [queryClient, queryKey],
  );

  const retrySave = useCallback(() => {
    if (!loaded || loaded.readOnly || blockedRef.current) return;
    void runSave(loaded);
  }, [loaded, runSave]);

  /** True from confirmation until the finalization request resolves. */
  const [finalizing, setFinalizing] = useState(false);

  // A saved analysis is only editable once a fresh server copy is in hand.
  // Until then the placeholder must not be editable, and a failed load must
  // never leave an editable blank workspace that looks like the contract.
  // While a finalization is pending the workspace is non-editable everywhere,
  // so no navigation path can change the draft the server is finalizing.
  const canEdit = !finalizing && (persistenceEnabled ? Boolean(loaded) && !loaded!.readOnly : true);

  /**
   * A finalized or superseded revision is presented from its recorded engine
   * outputs. The current engines are never invoked against a historical draft:
   * if the recording is missing or unusable the workspace fails closed and
   * still does not recalculate.
   */
  const revision = loaded?.kind === "contract" ? loaded.revision : null;
  const recorded =
    revision && revision.readOnly ? (revision.snapshot?.engineOutputs ?? null) : null;
  const historicalActive = Boolean(revision && revision.readOnly);
  const historicalError =
    historicalActive && !recorded
      ? "The recorded snapshot for this revision is missing or unreadable, so its results cannot be shown. It is never recalculated with the current engine."
      : null;

  const workpaper = useMemo<ArcWorkpaper>(() => {
    if (historicalActive) {
      return recorded
        ? {
            workflow: recorded.workflow,
            balances: recorded.balances,
            journals: recorded.journals,
          }
        : placeholderWorkpaper();
    }
    return buildWorkpaper(draft);
  }, [historicalActive, recorded, draft]);
  const result = workpaper.workflow;

  const historical = useMemo<HistoricalPresentation>(
    () => ({
      active: historicalActive,
      status:
        revision && revision.status !== "draft"
          ? (revision.status as "finalized" | "superseded")
          : null,
      engineVersion: revision?.snapshot?.engineVersion ?? null,
      engineVersionMatchesCurrent: revision?.snapshot?.engineVersionMatchesCurrent ?? true,
      error: historicalError,
    }),
    [historicalActive, historicalError, revision],
  );

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
      mode,
      status,
      revision,
      guestExpiresAt: loaded?.guestExpiresAt ?? null,
      lockVersion: loaded ? (lockVersion ?? loaded.lockVersion) : null,
      readOnly: Boolean(loaded?.readOnly),
      reload,
      retrySave,
      finalizing,
      setFinalizing,
    }),
    [
      persistenceEnabled,
      mode,
      status,
      loaded,
      revision,
      lockVersion,
      reload,
      retrySave,
      finalizing,
    ],
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
      workpaper,
      historical,
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
      workpaper,
      historical,
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
