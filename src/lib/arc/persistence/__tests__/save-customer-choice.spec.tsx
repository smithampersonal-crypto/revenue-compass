// @vitest-environment jsdom
/**
 * Phase 8E — saving an unsaved analysis under an existing customer.
 *
 * The panel only preselects; the trusted migration transaction re-checks that
 * the chosen customer belongs to the caller. No accounting behaviour here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider } from "@/components/arc/analysis-context";
import { GuestSavePanel } from "@/components/arc/GuestSavePanel";
import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import type { GuestWorkspaceDto } from "../guest.functions";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const resume = vi.fn();
const saveGuest = vi.fn();
const migrate = vi.fn();

vi.mock("@/lib/arc/persistence/guest.functions", () => ({
  resumeGuestWorkspace: (args: unknown) => resume(args),
  saveGuestDraft: (args: unknown) => saveGuest(args),
  migrateGuestWorkspace: (args: unknown) => migrate(args),
}));

const listCustomerChoices = vi.fn();
vi.mock("@/lib/arc/persistence/workspace.functions", () => ({
  listWorkspace: vi.fn(),
  listCustomerChoices: (args: unknown) => listCustomerChoices(args),
  createCustomer: vi.fn(),
  createContract: vi.fn(),
  deleteInitialDraftContract: vi.fn(),
}));

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => ({ status: "signed-in", email: "cpa@example.com", userId: "user-7" }),
}));

const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function draftNamed(name: string): WorkflowDraft {
  const draft = createEmptyDraft();
  draft.contract.customerName = name;
  return draft;
}

function guestWorkspace(name = "Northwind"): GuestWorkspaceDto {
  return {
    kind: "guest",
    draft: draftNamed(name),
    lockVersion: 1,
    expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    schemaVersion: "arc.workflow.v1",
    resumed: false,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider guest>
        <GuestSavePanel autoOpen />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/analysis");
  resume.mockResolvedValue(guestWorkspace());
  saveGuest.mockResolvedValue({ ok: true, lockVersion: 2, savedAt: new Date().toISOString() });
  migrate.mockResolvedValue({
    ok: true,
    customerId: CUSTOMER_A,
    contractId: "contract-1",
    analysisId: "a1",
    revisionId: "rev-1",
  });
  listCustomerChoices.mockResolvedValue({
    customers: [
      { id: CUSTOMER_A, name: "Acme Industries" },
      { id: CUSTOMER_B, name: "Beta Systems" },
    ],
  });
});

describe("saving under an existing customer", () => {
  it("files the analysis under the selected existing customer", async () => {
    renderPanel();
    await screen.findByDisplayValue("Northwind");
    await screen.findByDisplayValue("Acme Industries");

    fireEvent.click(screen.getByRole("button", { name: "Save to My Contracts" }));
    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    expect(migrate.mock.calls[0]![0].data.existingCustomerId).toBe(CUSTOMER_A);
  });

  it("creates a new customer only when that mode is chosen", async () => {
    renderPanel();
    await screen.findByDisplayValue("Northwind");
    await screen.findByDisplayValue("Acme Industries");

    fireEvent.click(screen.getByRole("radio", { name: /Create new customer/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save to My Contracts" }));
    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    expect(migrate.mock.calls[0]![0].data.existingCustomerId ?? null).toBeNull();
  });

  it("defaults to creating a customer when the account has none", async () => {
    listCustomerChoices.mockResolvedValue({ customers: [] });
    renderPanel();
    await screen.findByDisplayValue("Northwind");
    await waitFor(() => expect(listCustomerChoices).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Save to My Contracts" }));
    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    expect(migrate.mock.calls[0]![0].data.existingCustomerId ?? null).toBeNull();
  });

  it("preselects the customer named in the page address", async () => {
    window.history.replaceState({}, "", `/analysis?customer=${CUSTOMER_B}`);
    renderPanel();
    await screen.findByDisplayValue("Northwind");
    await screen.findByDisplayValue("Beta Systems");

    fireEvent.click(screen.getByRole("button", { name: "Save to My Contracts" }));
    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    expect(migrate.mock.calls[0]![0].data.existingCustomerId).toBe(CUSTOMER_B);
  });
});
