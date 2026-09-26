import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Package 3D-R — presentation-only accordion view state for the ASC 606
 * Analysis workpaper. Memory only: no storage, URL, cookies or database. It
 * holds no accounting state and never touches the WorkflowDraft.
 */
export type AccordionViewState = Record<string, boolean>;

/** The existing default for a newly entered analysis: Step 1 open. */
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

export function AnalysisViewStateProvider({
  identity,
  store,
  children,
}: {
  identity: string;
  store: AccordionViewStateMap;
  children: ReactNode;
}) {
  // Rendered inside the identity-keyed provider, so a new identity mounts
  // afresh and reads its own entry (or a fresh default object).
  const [open, setOpen] = useState<AccordionViewState>(() => ({
    ...(store.get(identity) ?? createDefaultAccordionState()),
  }));

  const setSectionOpen = useCallback(
    (id: string, next: boolean) => {
      setOpen((prev) => {
        const updated = { ...prev, [id]: next };
        store.set(identity, updated);
        return updated;
      });
    },
    [identity, store],
  );
  const openSection = useCallback((id: string) => setSectionOpen(id, true), [setSectionOpen]);

  return <Ctx.Provider value={{ open, setSectionOpen, openSection }}>{children}</Ctx.Provider>;
}

export function useAnalysisViewState(): AnalysisViewStateValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAnalysisViewState must be used inside AnalysisViewStateProvider");
  return value;
}
