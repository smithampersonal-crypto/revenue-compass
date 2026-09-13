// @vitest-environment jsdom
/**
 * Phase 8D — the Source Documents workspace must follow the revision
 * lifecycle. Create Revision, Reset, Discard and Finalize are authoritative
 * server transactions; the browser never synthesizes the inherited or restored
 * selection, it re-reads the server's answer.
 *
 * No accounting engine behaviour is exercised or changed here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";

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
    createFileRoute: () => (options: unknown) => options,
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

const load = vi.fn();
const save = vi.fn();
const history = vi.fn();
const finalize = vi.fn();
const startNew = vi.fn();
const resetDraft = vi.fn();
const discardDraft = vi.fn();

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: (args: unknown) => save(args),
  finalizeRevision: (args: unknown) => finalize(args),
  listRevisionHistory: (args: unknown) => history(args),
  startNewRevision: (args: unknown) => startNew(args),
  resetAmendmentDraft: (args: unknown) => resetDraft(args),
  discardAmendmentDraft: (args: unknown) => discardDraft(args),
}));

const { AnalysisProvider, useAnalysis } = await import("@/components/arc/analysis-context");
const { AnalysisSummary } = await import("@/components/arc/AnalysisSummary");
const { RevisionLifecyclePanel } = await import("@/components/arc/RevisionLifecyclePanel");

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const FINALIZED_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT = createDemoDraftIfKnown("horizon")!;

function revision(overrides: Record<string, unknown> = {}) {
  return {
    contractId: CONTRACT_ID,
    contractTitle: "Saved contract",
    contractNumber: null,
    customerName: "Northwind",
    analysisId: "44444444-4444-4444-8444-444444444444",
    revisionId: DRAFT_ID,
    revisionNumber: 2,
    status: "draft",
    lockVersion: 4,
    schemaVersion: "arc.workflow.v1",
    readOnly: false,
    draft: DRAFT,
    snapshot: null,
    supersedesRevisionId: FINALIZED_ID,
    ...overrides,
  };
}

function amendmentHistory() {
  return {
    revisions: [
      {
        revisionId: DRAFT_ID,
        revisionNumber: 2,
        status: "draft",
        supersedesRevisionId: FINALIZED_ID,
        isCurrentFinalized: false,
      },
      {
        revisionId: FINALIZED_ID,
        revisionNumber: 1,
        status: "finalized",
        supersedesRevisionId: null,
        isCurrentFinalized: true,
      },
    ],
  };
}

/** Reports the authoritative workspace state the accounting form edits with. */
function Probe() {
  const { persistence, canEdit } = useAnalysis();
  return (
    <p>
      probe editable={String(canEdit)} lock={String(persistence.lockVersion ?? "none")} revision=
      {String(persistence.revision?.revisionId ?? "none")} readonly=
      {String(persistence.readOnly)}
    </p>
  );
}

/** Renders with a client whose invalidations can be observed. */
function renderWorkspace(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={DRAFT_ID}>
        {children}
        <Probe />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
  return invalidate;
}

function invalidatedSourceDocuments(invalidate: { mock: { calls: unknown[][] } }) {
  return invalidate.mock.calls.some((call: unknown[]) => {
    const key = (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
    return Array.isArray(key) && key[0] === "arc-source-documents";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(revision());
  save.mockResolvedValue({ ok: true, lockVersion: 5 });
  history.mockResolvedValue(amendmentHistory());
});


describe("Source documents follow the revision lifecycle", () => {
  it("reloads the authoritative source set after a new revision is created", async () => {
    load.mockResolvedValue(
      revision({
        revisionId: FINALIZED_ID,
        revisionNumber: 1,
        status: "finalized",
        readOnly: true,
        supersedesRevisionId: null,
      }),
    );
    history.mockResolvedValue({
      revisions: [
        {
          revisionId: FINALIZED_ID,
          revisionNumber: 1,
          status: "finalized",
          supersedesRevisionId: null,
          isCurrentFinalized: true,
        },
      ],
    });
    startNew.mockResolvedValue({ revisionId: DRAFT_ID, created: true });

    const invalidate = renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create new revision" }));
    await user.click(await screen.findByRole("button", { name: "Create revision" }));

    await waitFor(() => expect(startNew).toHaveBeenCalled());
    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
  });

  it("reloads the authoritative source set after a reset to the finalized revision", async () => {
    resetDraft.mockResolvedValue({ ok: true, lockVersion: 5, draft: DRAFT });

    const invalidate = renderWorkspace(<AnalysisSummary />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Reset to Revision 1" }));
    await user.click(screen.getByRole("button", { name: "Reset revision" }));

    await waitFor(() => expect(resetDraft).toHaveBeenCalled());
    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
  });

  it("reloads the source set of the current finalized revision after a discard", async () => {
    discardDraft.mockResolvedValue({ ok: true, finalizedRevisionId: FINALIZED_ID });

    const invalidate = renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Discard draft revision" }));
    await user.click(screen.getByRole("button", { name: "Discard draft" }));

    await waitFor(() => expect(discardDraft).toHaveBeenCalled());
    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
  });

  it("reloads the frozen source set after finalization", async () => {
    finalize.mockResolvedValue({ ok: true, revisionId: DRAFT_ID });

    const invalidate = renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /finalize analysis/i }));
    await user.click(await screen.findByRole("button", { name: /finalize analysis/i }));

    await waitFor(() => expect(finalize).toHaveBeenCalled());
    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
  });
});

/**
 * Safety ordering: the accounting workspace must leave the old revision lock
 * behind the moment the reset transaction answers, before anything waits on
 * the Source Documents query.
 */
describe("Reset enters the authoritative reload boundary immediately", () => {
  /** Renders with Source Documents invalidation deliberately left pending. */
  function renderWithPendingDocuments(children: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(client, "invalidateQueries").mockImplementation((filters?: unknown) => {
      const key = (filters as { queryKey?: unknown[] } | undefined)?.queryKey;
      if (Array.isArray(key) && key[0] === "arc-source-documents") return pending;
      return Promise.resolve();
    });
    render(
      <QueryClientProvider client={client}>
        <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={DRAFT_ID}>
          {children}
          <Probe />
        </AnalysisProvider>
      </QueryClientProvider>,
    );
    return { release: () => release?.() };
  }

  it("drops the old lock and reloads before the pending source refetch settles", async () => {
    load.mockResolvedValueOnce(revision({ lockVersion: 4 }));
    load.mockResolvedValue(revision({ lockVersion: 5 }));
    resetDraft.mockResolvedValue({ ok: true, lockVersion: 5, draft: DRAFT });

    const { release } = renderWithPendingDocuments(<AnalysisSummary />);
    const user = userEvent.setup();

    await screen.findByText(/lock=4/);

    await user.click(await screen.findByRole("button", { name: "Reset to Revision 1" }));
    await user.click(screen.getByRole("button", { name: "Reset revision" }));

    await waitFor(() => expect(resetDraft).toHaveBeenCalled());
    // The reload boundary is entered while the documents query is still pending.
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1));
    // No autosave may use the superseded lock version.
    expect(save).not.toHaveBeenCalled();

    // The authoritative revision reload supplies the advanced lock.
    await screen.findByText(/lock=5/);
    await screen.findByText(/editable=true/);
    expect(save).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expectedLockVersion: 4 }) }),
    );
    release();
  });

  it("starts the reload boundary immediately after a stale reset too", async () => {
    resetDraft.mockResolvedValue({ ok: false });

    const { release } = renderWithPendingDocuments(<AnalysisSummary />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Reset to Revision 1" }));
    await user.click(screen.getByRole("button", { name: "Reset revision" }));

    await waitFor(() => expect(resetDraft).toHaveBeenCalled());
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1));
    expect(save).not.toHaveBeenCalled();
    release();
  });
});

/**
 * Lifecycle results, not just cache signals: the revision the accountant works
 * in always comes back from the server, never from the browser.
 */
describe("Lifecycle operations load authoritative revision state", () => {
  it("loads the new draft revision after Create Revision", async () => {
    const FINALIZED = revision({
      revisionId: FINALIZED_ID,
      revisionNumber: 1,
      status: "finalized",
      readOnly: true,
      supersedesRevisionId: null,
    });
    load.mockResolvedValueOnce(FINALIZED);
    load.mockResolvedValue(revision({ lockVersion: 1, revisionNumber: 2 }));
    history.mockResolvedValue({
      revisions: [
        {
          revisionId: FINALIZED_ID,
          revisionNumber: 1,
          status: "finalized",
          supersedesRevisionId: null,
          isCurrentFinalized: true,
        },
      ],
    });
    startNew.mockResolvedValue({ revisionId: DRAFT_ID, created: true });

    const invalidate = renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create new revision" }));
    await user.click(await screen.findByRole("button", { name: "Create revision" }));

    await waitFor(() => expect(startNew).toHaveBeenCalled());
    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
    // The workspace shows the server's draft, and the sources for it are re-read.
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1));
  });

  it("makes the restored revision authoritative after Reset", async () => {
    load.mockResolvedValueOnce(revision({ lockVersion: 4 }));
    load.mockResolvedValue(revision({ lockVersion: 5 }));
    resetDraft.mockResolvedValue({ ok: true, lockVersion: 5, draft: DRAFT });

    const invalidate = renderWorkspace(<AnalysisSummary />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Reset to Revision 1" }));
    await user.click(screen.getByRole("button", { name: "Reset revision" }));

    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
    await screen.findByText(/lock=5/);
  });

  it("keeps contract documents and reloads the finalized set after Discard", async () => {
    discardDraft.mockResolvedValue({ ok: true, finalizedRevisionId: FINALIZED_ID });

    const invalidate = renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Discard draft revision" }));
    await user.click(screen.getByRole("button", { name: "Discard draft" }));

    await waitFor(() => expect(discardDraft).toHaveBeenCalled());
    // Only the draft is discarded: no document deletion is requested, and the
    // finalized revision's own source set is re-read from the server.
    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          search: expect.objectContaining({ revision: FINALIZED_ID }),
        }),
      ),
    );
  });

  it("reloads the same selected set read-only after Finalize", async () => {
    load.mockResolvedValueOnce(revision({ lockVersion: 4 }));
    load.mockResolvedValue(
      revision({ status: "finalized", readOnly: true, lockVersion: 5, revisionId: DRAFT_ID }),
    );
    finalize.mockResolvedValue({ ok: true, revisionId: DRAFT_ID });

    const invalidate = renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /finalize analysis/i }));
    await user.click(await screen.findByRole("button", { name: /finalize analysis/i }));

    await waitFor(() => expect(finalize).toHaveBeenCalled());
    await waitFor(() => expect(invalidatedSourceDocuments(invalidate)).toBe(true));
    await screen.findByText(/readonly=true/);
  });
});

