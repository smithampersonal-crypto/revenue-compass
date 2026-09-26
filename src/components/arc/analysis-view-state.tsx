import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Package 3D-R — presentation-only accordion view state for the ASC 606
 * Analysis workpaper. Memory only: no storage, URL, cookies or database. It
 * holds no accounting state and never touches the WorkflowDraft.
 */
export type AccordionViewState = Record<string, boolean>;

/** The existing default for a newly entered analysis: Step 1 open. Always a
 *  fresh object. */
export function createDefaultAccordionState(): AccordionViewState {
  return { "step-1": true };
}

/** In-memory map of view state per analysis identity (owned by the layout). */
export type AccordionViewStateMap = Map<string, AccordionViewState>;

interface AnalysisViewStateValue {
  open: AccordionViewState;
  setSectionOpen: (id: string, next: boolean) => void;
  openSection: (id: string) => void;
}

const Ctx = createContext<AnalysisViewStateValue | null>(null);

function useAccordionState(identity: string | null, store: AccordionViewStateMap | null) {
  const [open, setOpen] = useState<AccordionViewState>(() => ({
    ...((identity !== null && store?.get(identity)) || createDefaultAccordionState()),
  }));
  const setSectionOpen = useCallback(
    (id: string, next: boolean) => {
      setOpen((prev) => {
        const updated = { ...prev, [id]: next };
        if (identity !== null && store) store.set(identity, updated);
        return updated;
      });
    },
    [identity, store],
  );
  const openSection = useCallback((id: string) => setSectionOpen(id, true), [setSectionOpen]);
  return { open, setSectionOpen, openSection };
}

export function AnalysisViewStateProvider({
  identity,
  store,
  children,
}: {
  identity: string;
  store: AccordionViewStateMap;
  children: ReactNode;
}) {
  // Rendered inside the identity-keyed AnalysisProvider, so a new identity
  // mounts afresh and reads its own remembered entry or a fresh default.
  const value = useAccordionState(identity, store);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The single authoritative accordion open-state. Outside a provider (isolated
 * component renders) it falls back to local, unremembered state with the same
 * default.
 */
export function useAnalysisViewState(): AnalysisViewStateValue {
  const shared = useContext(Ctx);
  const local = useAccordionState(null, null);
  return shared ?? local;
}
