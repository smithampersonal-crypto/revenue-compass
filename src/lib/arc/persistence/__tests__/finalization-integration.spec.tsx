// @vitest-environment jsdom
/**
 * Phase 7D — the saved workspace presents a finalized or superseded revision
 * from its recorded engine outputs, and a pending finalization locks the
 * draft. The server functions are replaced with deterministic doubles; no
 * accounting engine behaviour is exercised or changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider, useAnalysis } from "@/components/arc/analysis-context";
import { ContractBalancesView } from "@/components/arc/ContractBalancesView";
import { JournalEntriesView } from "@/components/arc/JournalEntriesView";
import { RevenueScheduleView } from "@/components/arc/RevenueScheduleView";
import { ReviewFinalizeView } from "@/components/arc/ReviewFinalizeView";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import { formatCents } from "@/lib/asc606";

import {
  ARC_ENGINE_VERSION,
  buildFinalizationSnapshot,
  readEngineOutputsSnapshot,
  type ArcEngineOutputsSnapshot,
} from "../snapshot";
import { ARC_WORKFLOW_SCHEMA_VERSION } from "../schema";
import type { LoadedRevisionDto } from "../revisions.functions";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const load = vi.fn();
const save = vi.fn();

const workpaperSpy = vi.fn();
vi.mock("@/lib/arc/persistence/snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../snapshot")>();
  return {
    ...actual,
    buildWorkpaper: (draft: unknown) => {
      workpaperSpy(draft);
      return actual.buildWorkpaper(draft as never);
    },
  };
});

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
/** Separately distinguishable recorded values per canonical output area. */
const BALANCE_CENTS = 987_654_321;
const REVIEW_CENTS = 456_789_123;
const JOURNAL_CENTS = 321_987_654;

function recordedOutputs(): ArcEngineOutputsSnapshot {
  const outcome = buildFinalizationSnapshot(DRAFT);
  if (!outcome.ok) throw new Error("the horizon fixture must be finalizable");
  const outputs = JSON.parse(JSON.stringify(outcome.engineOutputs)) as ArcEngineOutputsSnapshot;
  if (outputs.workflow.revenueSchedule) {
    outputs.workflow.revenueSchedule.totalCents = DISTINGUISHABLE_CENTS;
  }
  const balanceAnalysis = outputs.balances.analysis;
  if (balanceAnalysis?.monthly?.[0]) balanceAnalysis.monthly[0].revenueCents = BALANCE_CENTS;
  if (balanceAnalysis) balanceAnalysis.reconciliation.totalRevenueCents = REVIEW_CENTS;
  if (outputs.journals.kind === "ordinary") {
    const line = outputs.journals.analysis.entries?.[0]?.lines?.[0];
    if (line) {
      if (line.debitCents > 0) line.debitCents = JOURNAL_CENTS;
      else line.creditCents = JOURNAL_CENTS;
    }
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
      <section data-testid="area-schedule">
        <RevenueScheduleView draft={draft} result={result} />
      </section>
      <section data-testid="area-balances">
        <ContractBalancesView
          draft={draft}
          result={result}
          balances={workpaper.balances}
          onChange={setDraft}
        />
      </section>
      <section data-testid="area-journals">
        <JournalEntriesView draft={draft} result={result} journals={workpaper.journals} />
      </section>
      <section data-testid="area-review">
        <ReviewFinalizeView
          result={result}
          balances={workpaper.balances}
          journals={workpaper.journals}
        />
      </section>
    </div>
  );
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={REVISION_ID}>
        <Workspace />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  workpaperSpy.mockReset();
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
    // The recorded number is not one the current engine could have produced
    // from these same inputs, so its presence proves the recording was used.
    const liveTotal = live.engineOutputs.workflow.revenueSchedule?.totalCents ?? 0;
    expect(liveTotal).not.toBe(DISTINGUISHABLE_CENTS);
  });

  it("shows separately distinguishable recorded values in every canonical area", async () => {
    load.mockResolvedValue(historicalRevision(recordedOutputs()));
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("can-edit").textContent).toBe("false"));

    await waitFor(() =>
      expect(
        within(screen.getByTestId("area-schedule")).getAllByText(formatCents(DISTINGUISHABLE_CENTS))
          .length,
      ).toBeGreaterThan(0),
    );
    expect(
      within(screen.getByTestId("area-balances")).getAllByText(formatCents(BALANCE_CENTS)).length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId("area-journals")).getAllByText(formatCents(JOURNAL_CENTS)).length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId("area-review")).getAllByText(formatCents(REVIEW_CENTS)).length,
    ).toBeGreaterThan(0);
  });

  it("never runs the current engines against the historical draft", async () => {
    load.mockResolvedValue(historicalRevision(recordedOutputs()));
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("can-edit").textContent).toBe("false"));
    for (const [called] of workpaperSpy.mock.calls) {
      expect((called as typeof DRAFT).contract.customerName).not.toBe(DRAFT.contract.customerName);
    }
  });

  it("does not fall back to the current engines when the recording is unusable", async () => {
    load.mockResolvedValue(historicalRevision(null));
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("historical-error")).toBeInTheDocument());
    for (const [called] of workpaperSpy.mock.calls) {
      expect((called as typeof DRAFT).contract.customerName).not.toBe(DRAFT.contract.customerName);
    }
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

/**
 * Each mutation is a recording the shallow structural checks would once have
 * accepted, and every one of them is dereferenced by a canonical renderer. The
 * server decoder must reject them, and the workspace must show the explicit
 * unusable-snapshot state without recalculating and without crashing.
 */
const META = {
  engineVersion: ARC_ENGINE_VERSION,
  schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
};

type Mutation = (outputs: ArcEngineOutputsSnapshot) => void;

const MALFORMED: [string, Mutation][] = [
  [
    "a revenue schedule with a total but no monthly rows",
    (o) => {
      delete (o.workflow.revenueSchedule as unknown as Record<string, unknown>)["byMonth"];
    },
  ],
  [
    "a monthly revenue row without its per-obligation split",
    (o) => {
      const row = o.workflow.revenueSchedule!.byMonth[0] as unknown as Record<string, unknown>;
      delete row["perPo"];
    },
  ],
  [
    "variable consideration without its components",
    (o) => {
      o.workflow.variableConsideration = { reconciliation: {}, totals: {} } as never;
    },
  ],
  [
    "a material-right lifecycle without its rights",
    (o) => {
      o.workflow.lifecycle = { validation: {}, reconciliation: {}, totals: {} } as never;
    },
  ],
  [
    "grouped balances whose combined monthly rows are the wrong type",
    (o) => {
      o.balances.grouped = {
        groups: [],
        combinedMonthly: "not-an-array",
        combinedTransactionPriceCents: 0,
        combinedRevenueCents: null,
        reconciled: true,
      } as never;
    },
  ],
  [
    "a journal entry without its lines",
    (o) => {
      if (o.journals.kind !== "ordinary") throw new Error("fixture must be ordinary");
      const entry = o.journals.analysis.entries![0] as unknown as Record<string, unknown>;
      delete entry["lines"];
    },
  ],
  [
    "a journal line whose debit is not a number",
    (o) => {
      if (o.journals.kind !== "ordinary") throw new Error("fixture must be ordinary");
      const line = o.journals.analysis.entries![0]!.lines[0] as unknown as Record<string, unknown>;
      line["debitCents"] = "1200";
    },
  ],
  [
    "a malformed nested reconciliation",
    (o) => {
      o.balances.analysis!.reconciliation = { reconciled: "yes" } as never;
    },
  ],
  [
    "workflow validation missing the Step 2A blocking key",
    (o) => {
      delete (o.workflow.workflowValidation.blockingByStep as unknown as Record<string, unknown>)[
        "2a"
      ];
    },
  ],
  [
    "workflow validation missing the Step 2B warning key",
    (o) => {
      delete (o.workflow.workflowValidation.warningsByStep as unknown as Record<string, unknown>)[
        "2b"
      ];
    },
  ],
  [
    "a journal entry whose event type is not a known event",
    (o) => {
      if (o.journals.kind !== "ordinary") throw new Error("fixture must be ordinary");
      const entry = o.journals.analysis.entries![0] as unknown as Record<string, unknown>;
      entry["eventType"] = "made_up_event";
    },
  ],
];

describe("structurally unusable recordings fail closed", () => {
  it.each(MALFORMED)("rejects %s", async (_name, mutate) => {
    const outputs = recordedOutputs();
    mutate(outputs);
    // The server decoder refuses the recording…
    const decoded = readEngineOutputsSnapshot(outputs, META);
    expect(decoded).toBeNull();

    // …and the workspace shows the explicit unusable-snapshot state.
    load.mockResolvedValue(historicalRevision(decoded));
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("historical-error")).toBeInTheDocument());
    for (const [called] of workpaperSpy.mock.calls) {
      expect((called as typeof DRAFT).contract.customerName).not.toBe(DRAFT.contract.customerName);
    }
  });

  it("accepts the genuine recording it was derived from", () => {
    expect(readEngineOutputsSnapshot(recordedOutputs(), META)).not.toBeNull();
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
        <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={REVISION_ID}>
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

/**
 * The contract-modification recording has its own renderer-dereferenced fields.
 * Meridian is the grouped modification workpaper, so its genuine recording also
 * proves the tightened decoder still accepts a supported grouped case.
 */
const MERIDIAN = createDemoDraftIfKnown("meridian")!;

function meridianOutputs(): ArcEngineOutputsSnapshot {
  const outcome = buildFinalizationSnapshot(MERIDIAN);
  if (!outcome.ok) throw new Error("the meridian fixture must be finalizable");
  return JSON.parse(JSON.stringify(outcome.engineOutputs)) as ArcEngineOutputsSnapshot;
}

const MALFORMED_MODIFICATION: [string, Mutation][] = [
  [
    "a modification classification without its separate-contract conclusion",
    (o) => {
      const c = o.workflow.modification!.classification as unknown as Record<string, unknown>;
      delete c["separateContractTestPassed"];
    },
  ],
  [
    "a modification classification with an unknown mixed-allocation policy",
    (o) => {
      const c = o.workflow.modification!.classification as unknown as Record<string, unknown>;
      c["mixedAllocationPolicy"] = "some_other_policy";
    },
  ],
  [
    "a modification event without its scope-change description",
    (o) => {
      const e = o.workflow.modification!.event as unknown as Record<string, unknown>;
      delete e["scopeChangeDescription"];
    },
  ],
];

describe("unusable modification recordings fail closed", () => {
  it.each(MALFORMED_MODIFICATION)("rejects %s", async (_name, mutate) => {
    const outputs = meridianOutputs();
    mutate(outputs);
    expect(readEngineOutputsSnapshot(outputs, META)).toBeNull();

    load.mockResolvedValue(historicalRevision(null));
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("historical-error")).toBeInTheDocument());
    expect(workpaperSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ contract: expect.objectContaining({ customerName: "Meridian" }) }),
    );
  });
});

describe("the tightened decoder still accepts genuine supported workpapers", () => {
  it.each(["horizon", "stellar", "meridian"] as const)("accepts the %s recording", (id) => {
    const outcome = buildFinalizationSnapshot(createDemoDraftIfKnown(id)!);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const recorded = JSON.parse(JSON.stringify(outcome.engineOutputs)) as ArcEngineOutputsSnapshot;
    expect(readEngineOutputsSnapshot(recorded, META)).not.toBeNull();
  });
});
