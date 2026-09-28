// @vitest-environment jsdom
/**
 * Phase 8E acceptance correction A — PDF-first entry on My Contracts.
 *
 * An account with no customers yet must still be able to start from a
 * contract PDF. The customer hint is only a starting point for the save
 * panel, so with no customer chosen it is omitted entirely and the save
 * panel later defaults to creating a customer. No accounting behaviour here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigate,
    createFileRoute: () => (options: unknown) => options,
    Link: ({
      children,
      to,
      search,
      ...rest
    }: {
      children?: unknown;
      to?: string;
      search?: Record<string, string>;
    }) => {
      const query = new URLSearchParams(search ?? {}).toString();
      return (
        <a href={query ? `${to}?${query}` : (to ?? "#")} {...rest}>
          {children as never}
        </a>
      );
    },
  };
});

const listWorkspace = vi.fn();
vi.mock("@/lib/arc/persistence/workspace.functions", () => ({
  listWorkspace: (args: unknown) => listWorkspace(args),
  listCustomerChoices: vi.fn(),
  createCustomer: vi.fn(),
  createContract: vi.fn(),
  deleteInitialDraftContract: vi.fn(),
}));

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
  finalizeRevision: vi.fn(),
  listRevisionHistory: vi.fn(),
  startNewRevision: vi.fn(),
  resetAmendmentDraft: vi.fn(),
  discardAmendmentDraft: vi.fn(),
}));

vi.mock("@/lib/auth/session.functions", () => ({
  getVerifiedIdentity: async () => ({ userId: "u", email: "a@example.test" }),
}));

const { WorkspacePage } = await import("@/routes/_authenticated/workspace");

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

describe("My Contracts PDF-first entry", () => {
  it("offers Upload Contract PDF to an account with no customers", async () => {
    listWorkspace.mockResolvedValue({ customers: [] });
    renderWorkspace();

    // Package 3D-T: a button that creates exactly one analysis, then opens upload.
    fireEvent.click(await screen.findByRole("button", { name: "Upload Contract PDF" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis/documents",
        search: { a: "00000000-0000-4000-8000-000000000001", upload: "1" },
      }),
    );
  });

  it("does not offer manual contract creation without a customer", async () => {
    listWorkspace.mockResolvedValue({ customers: [] });
    renderWorkspace();

    await screen.findByRole("button", { name: "Upload Contract PDF" });
    expect(screen.queryByRole("button", { name: "Create manually" })).not.toBeInTheDocument();
    expect(screen.getByText(/Add a customer first to create a contract manually/i)).toBeVisible();
  });

  it("carries the chosen customer only when the account has one", async () => {
    listWorkspace.mockResolvedValue({
      customers: [{ id: CUSTOMER_ID, name: "Acme Industries", contracts: [] }],
    });
    renderWorkspace();

    // The hint only appears once the authoritative customer list has loaded.
    await screen.findByText("Acme Industries", { exact: false }).catch(() => null);
    await waitFor(() => expect(listWorkspace).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.click(screen.getByRole("button", { name: "Upload Contract PDF" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis/documents",
        search: { a: "00000000-0000-4000-8000-000000000001", upload: "1", customer: CUSTOMER_ID },
      }),
    );
  });
});
