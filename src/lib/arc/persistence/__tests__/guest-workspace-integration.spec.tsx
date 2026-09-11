// @vitest-environment jsdom
/**
 * Phase 7E — guest workspace behaviour of the analysis workspace.
 *
 * The guest server functions are replaced with deterministic doubles. No
 * accounting engine behaviour is exercised or changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider, useAnalysis } from "@/components/arc/analysis-context";
import { GuestSavePanel } from "@/components/arc/GuestSavePanel";
import { SaveStatusIndicator } from "@/components/arc/SaveStatusIndicator";
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

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigate };
});

let session: { status: string; email: string | null; userId: string | null } = {
  status: "signed-in",
  email: "cpa@example.com",
  userId: "user-7",
};
vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => session,
}));

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

function Probe() {
  const { draft, setDraft, persistence } = useAnalysis();
  return (
    <div>
      <p data-testid="mode">{persistence.mode}</p>
      <p data-testid="name">{draft.contract.customerName}</p>
      <button
        type="button"
        onClick={() =>
          setDraft((previous) => ({
            ...previous,
            contract: { ...previous.contract, customerName: "Edited" },
          }))
        }
      >
        edit
      </button>
    </div>
  );
}

function renderGuest(options: { autoOpen?: boolean; sample?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={options.sample} guest={!options.sample}>
        <SaveStatusIndicator />
        <GuestSavePanel autoOpen={options.autoOpen ?? false} />
        <Probe />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  session = { status: "signed-in", email: "cpa@example.com", userId: "user-7" };
  resume.mockResolvedValue(guestWorkspace());
  saveGuest.mockResolvedValue({ ok: true, lockVersion: 2, savedAt: new Date().toISOString() });
});

describe("bare /analysis guest workspace", () => {
  it("resumes or creates a temporary workspace and autosaves edits", async () => {
    renderGuest();
    await screen.findByText("Northwind");
    expect(screen.getByTestId("mode")).toHaveTextContent("guest");
    expect(resume).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    await waitFor(() => expect(saveGuest).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Same optimistic-lock contract as a saved revision.
    expect(saveGuest.mock.calls[0]![0].data.expectedLockVersion).toBe(1);
  });

  it("never autosaves a sample", async () => {
    renderGuest({ sample: "horizon" });
    await screen.findByTestId("mode");
    expect(screen.getByTestId("mode")).toHaveTextContent("sample");
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(resume).not.toHaveBeenCalled();
    expect(saveGuest).not.toHaveBeenCalled();
  });

  it("stops saving and explains when the temporary workspace expires", async () => {
    saveGuest.mockResolvedValue({ ok: false, reason: "expired" });
    renderGuest();
    await screen.findByText("Northwind");
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(await screen.findByText("Temporary workspace expired")).toBeInTheDocument();
  });
});

describe("explicit save of a guest analysis", () => {
  it("does not save merely because the visitor is signed in", async () => {
    renderGuest();
    await screen.findByText("Northwind");
    expect(migrate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save this analysis" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in, preserving the intent without the credential", async () => {
    session = { status: "signed-out", email: null, userId: null };
    renderGuest();
    await screen.findByText("Northwind");
    fireEvent.click(screen.getByRole("button", { name: "Save this analysis" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/auth", search: { next: "/analysis?save=1" } });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("migrates on confirmation and navigates to the new saved revision", async () => {
    migrate.mockResolvedValue({
      ok: true,
      customerId: "c1",
      contractId: "contract-1",
      analysisId: "a1",
      revisionId: "rev-1",
    });
    renderGuest({ autoOpen: true });
    // The contract name is suggested from Step 1 before the form can be used.
    await screen.findByDisplayValue("Northwind");

    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    expect(migrate.mock.calls[0]![0].data.contractTitle).toBe("Northwind");
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: "contract-1", revision: "rev-1" },
      }),
    );
  });

  it("blocks migration with a Step 1 message when the customer name is blank", async () => {
    resume.mockResolvedValue(guestWorkspace(""));
    renderGuest({ autoOpen: true });
    await screen.findByTestId("mode");
    expect(await screen.findByText(/Add the customer name in Step 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save to my account" })).toBeDisabled();
  });

  it("keeps the temporary workspace when the migration fails", async () => {
    migrate.mockResolvedValue({ ok: false, reason: "Nothing was created. Please try again." });
    renderGuest({ autoOpen: true });
    await screen.findByDisplayValue("Northwind");
    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    expect(await screen.findByText(/Nothing was created/)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("mode")).toHaveTextContent("guest");
  });

  it("sends the authoritative expected lock version with the migration", async () => {
    migrate.mockResolvedValue({
      ok: true,
      customerId: "c1",
      contractId: "contract-1",
      analysisId: "a1",
      revisionId: "rev-1",
      recovered: false,
    });
    renderGuest({ autoOpen: true });
    await screen.findByDisplayValue("Northwind");
    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    expect(migrate.mock.calls[0]![0].data.expectedLockVersion).toBe(1);
  });

  it("never migrates or leaves for sign-in while an edit is still unsaved", async () => {
    session = { status: "signed-out", email: null, userId: null };
    renderGuest();
    await screen.findByText("Northwind");

    // Edit B, then click before the 750 ms debounce has elapsed.
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: /Save this analysis|Saving your latest/ }));
    expect(navigate).not.toHaveBeenCalled();

    // Only once B is server-accepted may the sign-in round trip start.
    await waitFor(() => expect(saveGuest).toHaveBeenCalledTimes(1));
    expect(saveGuest.mock.calls[0]![0].data.draft.contract.customerName).toBe("Edited");
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/auth", search: { next: "/analysis?save=1" } }),
    );
    expect(migrate).not.toHaveBeenCalled();
  });

  it("saves the pending edit first, then migrates that exact version", async () => {
    saveGuest.mockResolvedValue({ ok: true, lockVersion: 2, savedAt: new Date().toISOString() });
    migrate.mockResolvedValue({
      ok: true,
      customerId: "c1",
      contractId: "contract-1",
      analysisId: "a1",
      revisionId: "rev-1",
      recovered: false,
    });
    renderGuest({ autoOpen: true });
    await screen.findByDisplayValue("Northwind");

    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    expect(migrate).not.toHaveBeenCalled();

    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // The migration describes the draft the accepted lock version protects.
    expect(migrate.mock.calls[0]![0].data.expectedLockVersion).toBe(2);
  });

  it("locks the workspace while the migration is pending", async () => {
    let release: null | (() => void) = null;
    migrate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              customerId: "c1",
              contractId: "contract-1",
              analysisId: "a1",
              revisionId: "rev-1",
              recovered: false,
            });
        }),
    );
    renderGuest({ autoOpen: true });
    await screen.findByDisplayValue("Northwind");
    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));

    // An attempted edit cannot change the analysis being saved.
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByTestId("name")).toHaveTextContent("Northwind");
    release?.();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it("recovers a committed migration whose response was lost", async () => {
    migrate.mockResolvedValue({
      ok: true,
      customerId: "c1",
      contractId: "contract-1",
      analysisId: "a1",
      revisionId: "rev-1",
      recovered: true,
    });
    renderGuest({ autoOpen: true });
    await screen.findByDisplayValue("Northwind");
    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: "contract-1", revision: "rev-1" },
      }),
    );
  });
});
