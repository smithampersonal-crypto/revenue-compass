// @vitest-environment jsdom
/**
 * Phase 7C — persistence integration behaviour of the analysis workspace.
 *
 * The server functions are replaced with deterministic doubles so load,
 * autosave sequencing, conflict, failure and read-only behaviour can be
 * asserted exactly. No accounting engine behaviour is exercised or changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider, useAnalysis } from "@/components/arc/analysis-context";
import { SaveStatusIndicator } from "@/components/arc/SaveStatusIndicator";
import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import type { LoadedRevisionDto, SaveDraftResult } from "../revisions.functions";

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

function draftNamed(name: string): WorkflowDraft {
  const draft = createEmptyDraft();
  draft.contract.customerName = name;
  return draft;
}

function loadedRevision(overrides: Partial<LoadedRevisionDto> = {}): LoadedRevisionDto {
  return {
    contractId: CONTRACT_ID,
    contractTitle: "Saved contract",
    contractNumber: null,
    customerName: "A",
    analysisId: "33333333-3333-4333-8333-333333333333",
    revisionId: REVISION_ID,
    revisionNumber: 1,
    status: "draft",
    lockVersion: 1,
    schemaVersion: "arc.workflow.v1",
    readOnly: false,
    draft: draftNamed("A"),
    ...overrides,
  };
}

function Probe() {
  const { draft, setDraft, canEdit, resetAnalysis } = useAnalysis();
  return (
    <div>
      <p data-testid="name">{draft.contract.customerName}</p>
      <p data-testid="can-edit">{String(canEdit)}</p>
      <button
        type="button"
        onClick={() =>
          setDraft((previous) => ({
            ...previous,
            contract: { ...previous.contract, customerName: "B" },
          }))
        }
      >
        edit B
      </button>
      <button
        type="button"
        onClick={() =>
          setDraft((previous) => ({
            ...previous,
            contract: { ...previous.contract, customerName: "C" },
          }))
        }
      >
        edit C
      </button>
      <button type="button" onClick={resetAnalysis}>
        reset
      </button>
    </div>
  );
}

function renderWorkspace(options: { sample?: string; contractId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider
        sample={options.sample}
        contractId={options.contractId ?? CONTRACT_ID}
        revisionId={undefined}
      >
        <SaveStatusIndicator />
        <Probe />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

function savedName(): string {
  const calls = save.mock.calls;
  const last = calls[calls.length - 1]?.[0] as
    { data: { draft: WorkflowDraft; expectedLockVersion: number } } | undefined;
  return last?.data.draft.contract.customerName ?? "";
}

beforeEach(() => {
  load.mockReset();
  save.mockReset();
});

describe("saved analysis loading", () => {
  it("adopts the saved draft and reports Saved", async () => {
    load.mockResolvedValue(loadedRevision());
    renderWorkspace();

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByTestId("name")).toHaveTextContent("A");
    expect(screen.getByTestId("can-edit")).toHaveTextContent("true");
  });

  it("cannot be edited while the saved copy has not arrived", async () => {
    let release: ((value: LoadedRevisionDto) => void) | undefined;
    load.mockReturnValue(
      new Promise<LoadedRevisionDto>((resolve) => {
        release = resolve;
      }),
    );
    renderWorkspace();

    expect(await screen.findByText("Loading")).toBeInTheDocument();
    expect(screen.getByTestId("can-edit")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "edit B" }));
    expect(screen.getByTestId("name")).toHaveTextContent("");
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      release?.(loadedRevision());
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("does not leave an editable blank workspace when the load fails", async () => {
    load.mockRejectedValue(new Error("That contract was not found in your workspace."));
    renderWorkspace();

    expect(await screen.findByText("Could not open")).toBeInTheDocument();
    expect(screen.getByTestId("can-edit")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "edit B" }));
    expect(screen.getByTestId("name")).toHaveTextContent("");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("autosave", () => {
  it("saves an edit and reports Saved once the server has accepted it", async () => {
    load.mockResolvedValue(loadedRevision());
    save.mockResolvedValue({
      ok: true,
      lockVersion: 2,
      savedAt: new Date().toISOString(),
    } satisfies SaveDraftResult);
    renderWorkspace();
    await screen.findByText("Saved");

    fireEvent.click(screen.getByRole("button", { name: "edit B" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(savedName()).toBe("B");
  });

  it("saves a draft that changed while an earlier save was in flight", async () => {
    load.mockResolvedValue(loadedRevision());

    let resolveFirst: ((value: SaveDraftResult) => void) | undefined;
    let resolveSecond: ((value: SaveDraftResult) => void) | undefined;
    save
      .mockImplementationOnce(
        () =>
          new Promise<SaveDraftResult>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<SaveDraftResult>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    renderWorkspace();
    await screen.findByText("Saved");

    // server has A; edit B; save B begins
    fireEvent.click(screen.getByRole("button", { name: "edit B" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(
      (save.mock.calls[0]?.[0] as { data: { expectedLockVersion: number } }).data
        .expectedLockVersion,
    ).toBe(1);
    expect(savedName()).toBe("B");

    // edit C while B is pending
    fireEvent.click(screen.getByRole("button", { name: "edit C" }));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    // save B succeeds at lock 2 -> ARC automatically saves C using lock 2
    await act(async () => {
      resolveFirst?.({ ok: true, lockVersion: 2, savedAt: new Date().toISOString() });
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(
      (save.mock.calls[1]?.[0] as { data: { expectedLockVersion: number } }).data
        .expectedLockVersion,
    ).toBe(2);
    expect(savedName()).toBe("C");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    // save C succeeds at lock 3
    await act(async () => {
      resolveSecond?.({ ok: true, lockVersion: 3, savedAt: new Date().toISOString() });
    });

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByTestId("name")).toHaveTextContent("C");
    expect(savedName()).toBe("C");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("never autosaves a sample, even when a contract is also named", async () => {
    renderWorkspace({ sample: "meridian" });
    await screen.findByTestId("name");

    fireEvent.click(screen.getByRole("button", { name: "edit B" }));
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("save failure and conflict are distinct", () => {
  it("offers Retry save after an ordinary save failure and keeps local edits", async () => {
    load.mockResolvedValue(loadedRevision());
    save
      .mockRejectedValueOnce(new Error("Your latest edits could not be saved."))
      .mockResolvedValueOnce({ ok: true, lockVersion: 2, savedAt: new Date().toISOString() });
    renderWorkspace();
    await screen.findByText("Saved");

    fireEvent.click(screen.getByRole("button", { name: "edit B" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByTestId("name")).toHaveTextContent("B");
    expect(screen.getByRole("button", { name: "Retry save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload saved version" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(savedName()).toBe("B");
  });

  it("stops autosaving and offers Reload saved version on a stale-lock conflict", async () => {
    load.mockResolvedValue(loadedRevision());
    save.mockResolvedValue({ ok: false, conflict: true } satisfies SaveDraftResult);
    renderWorkspace();
    await screen.findByText("Saved");

    fireEvent.click(screen.getByRole("button", { name: "edit B" }));
    expect(await screen.findByText("A newer saved version exists")).toBeInTheDocument();
    expect(screen.getByTestId("name")).toHaveTextContent("B");
    expect(screen.getByRole("button", { name: "Reload saved version" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry save" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "edit C" }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("finalized and superseded revisions", () => {
  for (const status of ["finalized", "superseded"] as const) {
    it(`opens a ${status} revision read-only and rejects every mutation`, async () => {
      load.mockResolvedValue(loadedRevision({ status, readOnly: true, draft: draftNamed("A") }));
      renderWorkspace();

      expect(await screen.findByText("Read-only")).toBeInTheDocument();
      expect(screen.getByTestId("can-edit")).toHaveTextContent("false");

      fireEvent.click(screen.getByRole("button", { name: "edit B" }));
      fireEvent.click(screen.getByRole("button", { name: "reset" }));
      expect(screen.getByTestId("name")).toHaveTextContent("A");

      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(save).not.toHaveBeenCalled();
    });
  }
});
