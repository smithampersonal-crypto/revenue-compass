// @vitest-environment jsdom
/**
 * Phase 7D — the saved workspace presents a finalized or superseded revision
 * from its recorded engine outputs, and a pending finalization locks the
 * draft. The server functions are replaced with deterministic doubles; no
 * accounting engine behaviour is exercised or changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider, useAnalysis } from "@/components/arc/analysis-context";
import { ContractBalancesView } from "@/components/arc/ContractBalancesView";
import { JournalEntriesView } from "@/components/arc/JournalEntriesView";
import { RevenueScheduleView } from "@/components/arc/RevenueScheduleView";
import { ReviewFinalizeView } from "@/components/arc/ReviewFinalizeView";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import { formatCents } from "@/lib/asc606";

import { buildFinalizationSnapshot, type ArcEngineOutputsSnapshot } from "../snapshot";
import type { LoadedRevisionDto } from "../revisions.functions";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const load = vi.fn();
const save = vi.fn();

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: (args: unknown) => save(args),
}));

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";

const DRAFT = createDemoDraftIfKnown("horizon")!;

/**
 * A recording whose revenue total is deliberately different from anything the
 * current engine would produce from the same inputs. Whatever is shown must be
 * this recorded number.
 */
const DISTINGUISHABLE_CENTS = 123_456_789;

function recordedOutputs(): ArcEngineOutputsSnapshot {
  const outcome = buildFinalizationSnapshot(DRAFT);
  if (!outcome.ok) throw new Error("the horizon fixture must be finalizable");
  const outputs = JSON.parse(JSON.stringify(outcome.engineOutputs)) as ArcEngineOutputsSnapshot;
  if (outputs.workflow.revenueSchedule) {
    outputs.workflow.revenueSchedule.totalCents = DISTINGUISHABLE_CENTS;
  }
  return outputs;
}

function historicalRevision(
  engineOutputs: ArcEngineOutputsSnapshot | null,
  status: "finalized" | "superseded" = "finalized",
): LoadedRevisionDto {
  return {
    contractId: CONTRACT_ID,
    contractTitle: "Saved contract",
    contractNumber: null,
    customerName: "A",
    analysisId: "33333333-3333-4333-8333-333333333333",
    revisionId: REVISION_ID,
    revisionNumber: 2,
    status,
    snapshot: {
      engineVersion: "arc.engine.v0",
      engineVersionMatchesCurrent: false,
      finalizedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      reconciliation: null,
      engineOutputs,
    },
    lockVersion: 4,
    schemaVersion: "arc.workflow.v1",
    readOnly: true,
    draft: DRAFT,
  } as unknown as LoadedRevisionDto;
}

/** Mirrors how the analysis routes read the authoritative workpaper. */
function Workspace() {
  const { draft, result, workpaper, historical, canEdit, setDraft } = useAnalysis();
  if (historical.error) return <p data-testid="historical-error">{historical.error}</p>;
  return (
    <div>
      <p data-testid="can-edit">{String(canEdit)}</p>
      <p data-testid="engine-version">{historical.engineVersion ?? ""}</p>
      <button
        type="button"
        onClick={() =>
          setDraft((previous) => ({
            ...previous,
            contract: { ...previous.contract, customerName: "EDITED" },
          }))
        }
      >
        edit
      </button>
      <p data-testid="customer">{draft.contract.customerName}</p>
      <RevenueScheduleView draft={draft} result={result} />
      <ContractBalancesView
        draft={draft}
        result={result}
        balances={workpaper.balances}
        onChange={setDraft}
      />
      <JournalEntriesView draft={draft} result={result} journals={workpaper.journals} />
      <ReviewFinalizeView
        result={result}
        balances={workpaper.balances}
        journals={workpaper.journals}
      />
    </div>
  );
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider contractId={CONTRACT_ID} revisionId={REVISION_ID}>
        <Workspace />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  load.mockReset();
  save.mockReset();
  save.mockResolvedValue({ ok: true, lockVersion: 5, savedAt: new Date().toISOString() });
});

describe("finalized and superseded revisions render recorded engine outputs", () => {
  it("shows the recorded revenue total, not what the current engine would produce", async () => {
    load.mockResolvedValue(historicalRevision(recordedOutputs()));
    renderWorkspace();

    await waitFor(() => expect(screen.getByTestId("can-edit").textContent).toBe("false"));
    const recorded = formatCents(DISTINGUISHABLE_CENTS);
    await waitFor(() => expect(screen.getAllByText(recorded).length).toBeGreaterThan(0));

    const live = buildFinalizationSnapshot(DRAFT);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    const liveTotal = live.engineOutputs.workflow.revenueSchedule?.totalCents ?? 0;
    expect(liveTotal).not.toBe(DISTINGUISHABLE_CENTS);
    expect(screen.queryAllByText(formatCents(liveTotal))).toHaveLength(0);
  });

  it("surfaces the earlier-engine notice for a superseded revision", async () => {
    load.mockResolvedValue(historicalRevision(recordedOutputs(), "superseded"));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId("engine-version").textContent).toBe("arc.engine.v0"),
    );
  });

  it("fails closed when the recording is missing instead of recalculating", async () => {
    load.mockResolvedValue(historicalRevision(null));
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("historical-error")).toBeInTheDocument());
    expect(screen.queryByTestId("customer")).not.toBeInTheDocument();
  });
});

describe("pending finalization locks the draft", () => {
  function Locking() {
    const { persistence, canEdit, draft, setDraft } = useAnalysis();
    return (
      <div>
        <p data-testid="can-edit">{String(canEdit)}</p>
        <p data-testid="customer">{draft.contract.customerName}</p>
        <button type="button" onClick={() => persistence.setFinalizing(true)}>
          confirm finalize
        </button>
        <button
          type="button"
          onClick={() =>
            setDraft((previous) => ({
              ...previous,
              contract: { ...previous.contract, customerName: "EDITED" },
            }))
          }
        >
          edit
        </button>
      </div>
    );
  }

  it("cannot mutate the draft while finalization is pending", async () => {
    load.mockResolvedValue({
      ...historicalRevision(null),
      status: "draft",
      readOnly: false,
      snapshot: null,
      draft: { ...DRAFT, contract: { ...DRAFT.contract, customerName: "A" } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AnalysisProvider contractId={CONTRACT_ID} revisionId={REVISION_ID}>
          <Locking />
        </AnalysisProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("can-edit").textContent).toBe("true"));
    act(() => {
      screen.getByText("confirm finalize").click();
    });
    expect(screen.getByTestId("can-edit").textContent).toBe("false");
    act(() => {
      screen.getByText("edit").click();
    });
    expect(screen.getByTestId("customer").textContent).toBe("A");
  });
});
