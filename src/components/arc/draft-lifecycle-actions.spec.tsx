// @vitest-environment jsdom
/**
 * Phase 8E — My Contracts destructive draft actions.
 *
 * The list only offers what the server says is available; the trusted
 * transaction remains the authority. No accounting behaviour is exercised.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    createFileRoute: () => (options: unknown) => options,
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

const listWorkspace = vi.fn();
const deleteInitialDraftContract = vi.fn();

vi.mock("@/lib/arc/persistence/workspace.functions", () => ({
  listWorkspace: (args: unknown) => listWorkspace(args),
  listCustomerChoices: vi.fn(),
  createCustomer: vi.fn(),
  createContract: vi.fn(),
  deleteInitialDraftContract: (args: unknown) => deleteInitialDraftContract(args),
}));

const discardAmendmentDraft = vi.fn();
vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
  finalizeRevision: vi.fn(),
  listRevisionHistory: vi.fn(),
  startNewRevision: vi.fn(),
  resetAmendmentDraft: vi.fn(),
  discardAmendmentDraft: (args: unknown) => discardAmendmentDraft(args),
}));

vi.mock("@/lib/auth/session.functions", () => ({
  getVerifiedIdentity: async () => ({ userId: "u", email: "a@example.test" }),
}));

const { WorkspacePage } = await import("@/routes/_authenticated/workspace");

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";

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

const initialDraftState = {
  kind: "draft",
  revisionId: REVISION_ID,
  revisionNumber: 1,
  nextRevisionNumber: 2,
  draftAction: "delete-initial-draft",
  draftLockVersion: 3,
  sourceRevisionNumber: null,
};

const amendmentDraftState = {
  kind: "draft",
  revisionId: REVISION_ID,
  revisionNumber: 2,
  nextRevisionNumber: 3,
  draftAction: "discard-amendment",
  draftLockVersion: 5,
  sourceRevisionNumber: 1,
};

const finalizedState = {
  kind: "finalized",
  revisionId: REVISION_ID,
  revisionNumber: 1,
  nextRevisionNumber: 2,
  draftAction: null,
  draftLockVersion: null,
  sourceRevisionNumber: null,
};

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkspacePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("My Contracts draft actions", () => {
  it("offers Delete draft for a first draft that has never been finalized", async () => {
    listWorkspace.mockResolvedValue(workspaceWith(initialDraftState));
    renderWorkspace();
    expect(await screen.findByRole("button", { name: "Delete draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discard draft/i })).not.toBeInTheDocument();
  });

  it("offers no destructive action for a finalized contract", async () => {
    listWorkspace.mockResolvedValue(workspaceWith(finalizedState));
    renderWorkspace();
    await screen.findByText("Platform subscription");
    expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discard draft/i })).not.toBeInTheDocument();
  });

  it("offers Discard draft for an amendment draft over finalized history", async () => {
    listWorkspace.mockResolvedValue(workspaceWith(amendmentDraftState));
    renderWorkspace();
    expect(await screen.findByRole("button", { name: /Discard draft/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
  });

  it("cancelling the confirmation deletes nothing", async () => {
    listWorkspace.mockResolvedValue(workspaceWith(initialDraftState));
    renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
    expect(await screen.findByText(/This draft has never been finalized\./i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteInitialDraftContract).not.toHaveBeenCalled();
  });

  it("confirming deletes the contract and refreshes the list", async () => {
    listWorkspace.mockResolvedValue(workspaceWith(initialDraftState));
    deleteInitialDraftContract.mockImplementation(async () => {
      listWorkspace.mockResolvedValue({
        customers: [{ id: "c1", name: "Northwind", contracts: [] }],
      });
      return { deletedContractId: CONTRACT_ID };
    });
    renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Platform subscription" }));
    await waitFor(() => {
      expect(deleteInitialDraftContract).toHaveBeenCalledWith({
        data: { contractId: CONTRACT_ID },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("Platform subscription")).not.toBeInTheDocument();
    });
  });

  it("reports a refused deletion instead of removing the row", async () => {
    listWorkspace.mockResolvedValue(workspaceWith(initialDraftState));
    deleteInitialDraftContract.mockRejectedValue(
      new Error("That draft analysis could not be deleted."),
    );
    renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Platform subscription" }));
    expect(
      await screen.findByText("That draft analysis could not be deleted."),
    ).toBeInTheDocument();
    expect(screen.getByText("Platform subscription")).toBeInTheDocument();
  });
});
