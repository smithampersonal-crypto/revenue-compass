// @vitest-environment jsdom
/**
 * Phase 7D — finalization conflict and transport ambiguity must re-establish
 * authoritative server state rather than handing back a stale local draft.
 * Only the persistence boundary is exercised; no accounting engine behaviour
 * is changed or asserted here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider } from "@/components/arc/analysis-context";
import { RevisionLifecyclePanel } from "@/components/arc/RevisionLifecyclePanel";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";

import { ARC_ENGINE_VERSION, buildFinalizationSnapshot } from "../snapshot";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigate,
    Link: ({
      children,
      search,
      to,
    }: {
      children?: unknown;
      search?: { contract?: string; revision?: string };
      to?: string;
    }) => (
      <a
        href={to ?? "#"}
        data-contract={search?.contract ?? ""}
        data-revision={search?.revision ?? ""}
      >
        {children as never}
      </a>
    ),
  };
});

const load = vi.fn();
const save = vi.fn();
const finalize = vi.fn();
const history = vi.fn();
const startNew = vi.fn();

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: (args: unknown) => save(args),
  finalizeRevision: (args: unknown) => finalize(args),
  listRevisionHistory: (args: unknown) => history(args),
  startNewRevision: (args: unknown) => startNew(args),
}));

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT = createDemoDraftIfKnown("horizon")!;

function savedDraft() {
  return {
    contractId: CONTRACT_ID,
    contractTitle: "Saved contract",
    contractNumber: null,
    customerName: "A",
    analysisId: "33333333-3333-4333-8333-333333333333",
    revisionId: REVISION_ID,
    revisionNumber: 1,
    status: "draft",
    snapshot: null,
    lockVersion: 3,
    schemaVersion: "arc.workflow.v1",
    readOnly: false,
    draft: DRAFT,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={REVISION_ID}>
        <RevisionLifecyclePanel />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

async function confirmFinalize() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /finalize analysis/i }));
  const confirm = await screen.findByRole("button", { name: /finalize analysis/i });
  await user.click(confirm);
}

function finalizedRevision(status: "finalized" | "superseded" = "finalized") {
  const outcome = buildFinalizationSnapshot(DRAFT);
  if (!outcome.ok) throw new Error("the horizon fixture must be finalizable");
  return {
    ...savedDraft(),
    revisionNumber: 2,
    status,
    readOnly: true,
    lockVersion: 4,
    snapshot: {
      engineVersion: ARC_ENGINE_VERSION,
      schemaVersion: "arc.workflow.v1",
      finalizedAt: "2026-01-01T00:00:00.000Z",
      engineVersionMatchesCurrent: true,
      reconciliation: outcome.reconciliation,
      engineOutputs: outcome.engineOutputs,
    },
  };
}

beforeEach(() => {
  navigate.mockReset();
  load.mockReset().mockResolvedValue(savedDraft());
  save.mockReset().mockResolvedValue({ ok: true, lockVersion: 4, savedAt: "2026-01-01" });
  finalize.mockReset();
  startNew.mockReset();
  history
    .mockReset()
    .mockResolvedValue({ revisions: [{ revisionId: REVISION_ID, status: "draft" }] });
});

describe("finalization conflict and ambiguity reload authoritative state", () => {
  it("reloads the authoritative revision on a stale-lock conflict", async () => {
    finalize.mockResolvedValue({ ok: false, reason: "conflict" });
    renderPanel();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await confirmFinalize();

    await waitFor(() => expect(screen.getByText(/being reloaded/i)).toBeInTheDocument());
    // The stale local copy is not handed back as an editable saved draft: the
    // server state is fetched again.
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1));
  });

  it("reloads when the server may have committed but the response was lost", async () => {
    finalize.mockRejectedValue(new Error("Network request failed."));
    renderPanel();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await confirmFinalize();

    await waitFor(() => expect(screen.getByText(/being reloaded/i)).toBeInTheDocument());
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1));
  });

  it("keeps the same saved draft open when the server deterministically blocks", async () => {
    finalize.mockResolvedValue({ ok: false, reason: "blocked", issues: ["Billing incomplete"] });
    renderPanel();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await confirmFinalize();

    await waitFor(() => expect(screen.getByText(/Billing incomplete/)).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("successful lifecycle paths", () => {
  it("reloads the immutable finalized revision after a successful finalize", async () => {
    finalize.mockResolvedValue({ ok: true, revisionId: REVISION_ID });
    load.mockResolvedValueOnce(savedDraft()).mockResolvedValue(finalizedRevision());
    history.mockResolvedValue({
      revisions: [{ revisionId: REVISION_ID, status: "finalized", isCurrentFinalized: true }],
    });
    renderPanel();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await confirmFinalize();

    await waitFor(() => expect(screen.getByText(/now read-only/i)).toBeInTheDocument());
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1));
    // The reloaded authoritative revision is immutable: no Finalize action.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /finalize analysis/i })).toBeNull(),
    );
  });

  it("opens the returned draft after continuing from the current finalized revision", async () => {
    const NEXT = "66666666-6666-4666-8666-666666666666";
    load.mockResolvedValue(finalizedRevision());
    history.mockResolvedValue({
      revisions: [
        {
          revisionId: REVISION_ID,
          revisionNumber: 2,
          status: "finalized",
          isCurrentFinalized: true,
        },
      ],
    });
    startNew.mockResolvedValue({ revisionId: NEXT, created: true });
    renderPanel();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create new revision" }));
    await user.click(await screen.findByRole("button", { name: "Create revision" }));

    await waitFor(() =>
      expect(startNew).toHaveBeenCalledWith({
        data: { contractId: CONTRACT_ID, sourceRevisionId: REVISION_ID },
      }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: CONTRACT_ID, revision: NEXT },
      }),
    );
  });

  it("offers no new-revision action on a superseded revision", async () => {
    load.mockResolvedValue(finalizedRevision("superseded"));
    history.mockResolvedValue({
      revisions: [
        {
          revisionId: "77777777-7777-4777-8777-777777777777",
          revisionNumber: 3,
          status: "finalized",
          isCurrentFinalized: true,
        },
        { revisionId: REVISION_ID, revisionNumber: 2, status: "superseded" },
      ],
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText(/view-only/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Create new revision" })).toBeNull();
    expect(screen.queryByRole("button", { name: /finalize analysis/i })).toBeNull();
  });

  it("keeps the exact contract and revision identity on a history View link", async () => {
    const OTHER = "88888888-8888-4888-8888-888888888888";
    history.mockResolvedValue({
      revisions: [
        { revisionId: REVISION_ID, revisionNumber: 2, status: "draft" },
        { revisionId: OTHER, revisionNumber: 1, status: "superseded" },
      ],
    });
    renderPanel();

    const link = await screen.findByRole("link", { name: "View" });
    expect(link.getAttribute("data-contract")).toBe(CONTRACT_ID);
    expect(link.getAttribute("data-revision")).toBe(OTHER);
  });
});
