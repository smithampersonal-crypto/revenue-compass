// @vitest-environment jsdom
/**
 * Finalized revision discoverability — behavioural coverage.
 *
 * My Contracts and the analysis summary must surface the existing revision
 * transaction; no accounting engine behaviour is exercised or changed here.
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
    Link: ({
      children,
      search,
      to,
    }: {
      children?: unknown;
      search?: unknown;
      to?: string;
    }) => {
      const value = (typeof search === "object" && search !== null ? search : {}) as {
        contract?: string;
        revision?: string;
      };
      return (
        <a href={to ?? "#"} data-contract={value.contract ?? ""} data-revision={value.revision ?? ""}>
          {children as never}
        </a>
      );
    },
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

const listWorkspace = vi.fn();
vi.mock("@/lib/arc/persistence/workspace.functions", () => ({
  listWorkspace: (args: unknown) => listWorkspace(args),
  createCustomer: vi.fn(),
  createContract: vi.fn(),
}));

vi.mock("@/lib/auth/session.functions", () => ({
  getVerifiedIdentity: async () => ({ userId: "u", email: "a@example.test" }),
}));

const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { AnalysisSummary } = await import("@/components/arc/AnalysisSummary");
const { WorkspacePage } = await import("@/routes/_authenticated/workspace");

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_ID = "66666666-6666-4666-8666-666666666666";
const DRAFT = createDemoDraftIfKnown("horizon")!;

function workspaceWith(revisionState: unknown) {
  return {
    customers: [
      {
        id: "c1",
        name: "Northwind",
        contracts: [
          {
            id: CONTRACT_ID,
            title: "Platform subscription",
            contractNumber: "C-1",
            status: "active",
            updatedAt: new Date().toISOString(),
            revisionState,
          },
        ],
      },
    ],
  };
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkspacePage />
    </QueryClientProvider>,
  );
}

function finalizedRevision(status: "finalized" | "superseded" = "finalized") {
  return {
    contractId: CONTRACT_ID,
    contractTitle: "Saved contract",
    contractNumber: null,
    customerName: "Northwind",
    analysisId: "33333333-3333-4333-8333-333333333333",
    revisionId: REVISION_ID,
    revisionNumber: 1,
    status,
    lockVersion: 4,
    schemaVersion: "arc.workflow.v1",
    readOnly: true,
    draft: DRAFT,
    snapshot: null,
  };
}

function renderSummary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={REVISION_ID}>
        <AnalysisSummary />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(finalizedRevision());
  save.mockResolvedValue({ ok: true, lockVersion: 5 });
});

describe("My Contracts revision discoverability", () => {
  it("shows the finalized state and a Create new revision action", async () => {
    listWorkspace.mockResolvedValue(
      workspaceWith({
        kind: "finalized",
        revisionId: REVISION_ID,
        revisionNumber: 1,
        nextRevisionNumber: 2,
      }),
    );
    renderWorkspace();

    expect(await screen.findByText(/Finalized · Revision 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new revision" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open draft/i })).toBeNull();
  });

  it("offers Open draft and no create action while an active draft exists", async () => {
    listWorkspace.mockResolvedValue(
      workspaceWith({
        kind: "draft",
        revisionId: REVISION_ID,
        revisionNumber: 2,
        nextRevisionNumber: 3,
      }),
    );
    renderWorkspace();

    expect(await screen.findByText(/Draft · Revision 2/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create new revision" })).toBeNull();
  });

  it("confirms, reuses the existing transaction and opens the new revision", async () => {
    listWorkspace.mockResolvedValue(
      workspaceWith({
        kind: "finalized",
        revisionId: REVISION_ID,
        revisionNumber: 1,
        nextRevisionNumber: 2,
      }),
    );
    startNew.mockResolvedValue({ revisionId: NEXT_ID, created: true });
    renderWorkspace();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create new revision" }));
    expect(await screen.findByText("Create Revision 2?")).toBeInTheDocument();
    expect(screen.getByText(/Revision 1 will remain finalized and read-only/)).toBeInTheDocument();
    expect(startNew).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create revision" }));
    await waitFor(() =>
      expect(startNew).toHaveBeenCalledWith({
        data: { contractId: CONTRACT_ID, sourceRevisionId: REVISION_ID },
      }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: CONTRACT_ID, revision: NEXT_ID },
      }),
    );
  });

  it("writes nothing when the confirmation is cancelled", async () => {
    listWorkspace.mockResolvedValue(
      workspaceWith({
        kind: "finalized",
        revisionId: REVISION_ID,
        revisionNumber: 1,
        nextRevisionNumber: 2,
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create new revision" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(startNew).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the draft the server already had instead of duplicating it", async () => {
    listWorkspace.mockResolvedValue(
      workspaceWith({
        kind: "finalized",
        revisionId: REVISION_ID,
        revisionNumber: 1,
        nextRevisionNumber: 2,
      }),
    );
    startNew.mockResolvedValue({ revisionId: NEXT_ID, created: false });
    renderWorkspace();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create new revision" }));
    await user.click(await screen.findByRole("button", { name: "Create revision" }));

    await waitFor(() => expect(startNew).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: CONTRACT_ID, revision: NEXT_ID },
      }),
    );
  });
});

describe("Analysis summary revision discoverability", () => {
  it("exposes Create new revision on the current finalized revision", async () => {
    history.mockResolvedValue({
      revisions: [
        {
          revisionId: REVISION_ID,
          revisionNumber: 1,
          status: "finalized",
          isCurrentFinalized: true,
        },
      ],
    });
    startNew.mockResolvedValue({ revisionId: NEXT_ID, created: true });
    renderSummary();
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
        search: { contract: CONTRACT_ID, revision: NEXT_ID },
      }),
    );
  });

  it("never offers the action on a superseded revision", async () => {
    load.mockResolvedValue(finalizedRevision("superseded"));
    history.mockResolvedValue({
      revisions: [
        {
          revisionId: "77777777-7777-4777-8777-777777777777",
          revisionNumber: 2,
          status: "finalized",
          isCurrentFinalized: true,
        },
        { revisionId: REVISION_ID, revisionNumber: 1, status: "superseded" },
      ],
    });
    renderSummary();

    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Create new revision" })).toBeNull(),
    );
  });
});
