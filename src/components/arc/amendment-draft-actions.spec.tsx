// @vitest-environment jsdom
/**
 * Amendment-draft reset and discard — behavioural coverage.
 *
 * No accounting engine behaviour is exercised or changed here: the reset and
 * discard operations are server-authoritative revision lifecycle actions.
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
const resetDraft = vi.fn();
const discardDraft = vi.fn();

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: (args: unknown) => save(args),
  finalizeRevision: vi.fn(),
  listRevisionHistory: (args: unknown) => history(args),
  startNewRevision: vi.fn(),
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

function renderWorkspace(children: React.ReactNode, contract = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider
        sample={undefined}
        {...(contract ? { contractId: CONTRACT_ID, revisionId: DRAFT_ID } : {})}
      >
        {children}
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(revision());
  save.mockResolvedValue({ ok: true, lockVersion: 5 });
  history.mockResolvedValue(amendmentHistory());
});

describe("Amendment draft reset", () => {
  it("offers Reset to Revision 1 with the amendment confirmation copy", async () => {
    renderWorkspace(<AnalysisSummary />);
    const user = userEvent.setup();

    const button = await screen.findByRole("button", { name: "Reset to Revision 1" });
    await user.click(button);

    expect(await screen.findByText("Reset Revision 2 to Revision 1?")).toBeInTheDocument();
    expect(
      screen.getByText(/replaced with the inputs from finalized Revision 1/i),
    ).toBeInTheDocument();
    expect(resetDraft).not.toHaveBeenCalled();
  });

  it("restores the server-authoritative source inputs on confirmation", async () => {
    resetDraft.mockResolvedValue({ ok: true, lockVersion: 5, draft: DRAFT });
    renderWorkspace(<AnalysisSummary />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Reset to Revision 1" }));
    await user.click(screen.getByRole("button", { name: "Reset revision" }));

    await waitFor(() =>
      expect(resetDraft).toHaveBeenCalledWith({
        data: { revisionId: DRAFT_ID, expectedLockVersion: 4 },
      }),
    );
  });

  it("reports a stale draft instead of silently overwriting newer work", async () => {
    resetDraft.mockResolvedValue({ ok: false, reason: "conflict" });
    renderWorkspace(<AnalysisSummary />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Reset to Revision 1" }));
    await user.click(screen.getByRole("button", { name: "Reset revision" }));

    expect(await screen.findByText(/changed since this page loaded/i)).toBeInTheDocument();
  });

  it("keeps the plain Reset Analysis action for an unsourced draft", async () => {
    load.mockResolvedValue(revision({ revisionNumber: 1, supersedesRevisionId: null }));
    history.mockResolvedValue({
      revisions: [
        {
          revisionId: DRAFT_ID,
          revisionNumber: 1,
          status: "draft",
          supersedesRevisionId: null,
          isCurrentFinalized: false,
        },
      ],
    });
    renderWorkspace(<AnalysisSummary />);

    expect(await screen.findByRole("button", { name: "Reset Analysis" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset to Revision/ })).toBeNull();
  });

  it("keeps Reset Sample for a loaded sample", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AnalysisProvider sample="horizon">
          <AnalysisSummary />
        </AnalysisProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "Reset Sample" })).toBeInTheDocument();
  });
});

describe("Discard draft revision", () => {
  it("offers the discard action for an amendment draft under Review & Finalize", async () => {
    renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Discard draft revision" }));

    expect(await screen.findByText("Discard Revision 2?")).toBeInTheDocument();
    expect(screen.getByText(/permanently removed/i)).toBeInTheDocument();
    expect(discardDraft).not.toHaveBeenCalled();
  });

  it("discards with the authoritative lock version and opens the finalized revision", async () => {
    discardDraft.mockResolvedValue({ ok: true, finalizedRevisionId: FINALIZED_ID });
    renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Discard draft revision" }));
    await user.click(screen.getByRole("button", { name: "Discard draft" }));

    await waitFor(() =>
      expect(discardDraft).toHaveBeenCalledWith({
        data: { revisionId: DRAFT_ID, expectedLockVersion: 4 },
      }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: CONTRACT_ID, revision: FINALIZED_ID },
      }),
    );
  });

  it("reports a stale draft rather than discarding newer work", async () => {
    discardDraft.mockResolvedValue({ ok: false, reason: "conflict" });
    renderWorkspace(<RevisionLifecyclePanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Discard draft revision" }));
    await user.click(screen.getByRole("button", { name: "Discard draft" }));

    expect(await screen.findByText(/changed since this page loaded/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("never offers discard on a finalized revision", async () => {
    load.mockResolvedValue(
      revision({
        revisionId: FINALIZED_ID,
        revisionNumber: 1,
        status: "finalized",
        readOnly: true,
        supersedesRevisionId: null,
      }),
    );
    renderWorkspace(<RevisionLifecyclePanel />);

    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Discard draft revision" })).toBeNull(),
    );
  });

  it("never offers discard on a plain first draft", async () => {
    load.mockResolvedValue(revision({ revisionNumber: 1, supersedesRevisionId: null }));
    renderWorkspace(<RevisionLifecyclePanel />);

    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Discard draft revision" })).toBeNull(),
    );
  });
});
