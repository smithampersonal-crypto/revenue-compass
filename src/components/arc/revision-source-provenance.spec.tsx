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

const { AnalysisProvider } = await import("@/components/arc/analysis-context");
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

/** Renders with a client whose invalidations can be observed. */
function renderWorkspace(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={DRAFT_ID}>
        {children}
      </AnalysisProvider>
    </QueryClientProvider>,
  );
  return invalidate;
}

function invalidatedSourceDocuments(invalidate: ReturnType<typeof vi.spyOn>) {
  return invalidate.mock.calls.some((call) => {
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
