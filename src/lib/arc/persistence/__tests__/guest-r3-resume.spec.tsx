// @vitest-environment jsdom
/**
 * Phase 9G-R3, Section K8. An R3 contract survives the real guest workspace
 * save/resume path.
 *
 * The guest server functions are the same deterministic doubles the Phase 7E
 * guest integration test uses, but the storage boundary inside them is the
 * REAL one: `validateDraftForPersistence` + `toCanonicalInputs` on the way in,
 * `parseCanonicalInputs` on the way out, exactly as `saveGuestDraftHandler`
 * and `resumeOrCreateGuestHandler` do. Nothing touches Cloud, and the
 * optimistic-lock behaviour is untouched.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider, useAnalysis } from "@/components/arc/analysis-context";
import { SaveStatusIndicator } from "@/components/arc/SaveStatusIndicator";
import { analyzeWorkflow, type WorkflowDraft } from "@/lib/asc606-workflow";
import {
  genomixBenchmarkDraft,
  r3OperationalFacts,
  withRealizedCredit,
  withSupportHours,
  withUsageActual,
  withValidationTransfer,
} from "@/lib/asc606-workflow/__tests__/genomix-k-fixture";

import {
  parseCanonicalInputs,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "../schema";
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => ({ status: "signed-out", email: null, userId: null }),
}));

/** The single stored guest row, written and read the way the server does. */
const store: { row: unknown; lockVersion: number } = { row: null, lockVersion: 1 };

function writeRow(draft: WorkflowDraft): void {
  const validated = validateDraftForPersistence(draft);
  if (!validated.ok) throw new Error(`guest save rejected: ${validated.issues.join(", ")}`);
  store.row = JSON.parse(JSON.stringify(toCanonicalInputs(validated.draft)));
}

function readRow(): WorkflowDraft {
  const parsed = parseCanonicalInputs(store.row);
  if (!parsed.ok) throw new Error("guest resume could not read the stored analysis");
  return parsed.draft;
}

function workspace(): GuestWorkspaceDto {
  return {
    kind: "guest",
    draft: readRow(),
    lockVersion: store.lockVersion,
    expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    schemaVersion: "arc.workflow.v1",
    resumed: true,
  };
}

/** The operational facts the accountant records after resuming. */
function recordActuals(draft: WorkflowDraft): WorkflowDraft {
  return withRealizedCredit(
    withUsageActual(
      withSupportHours(withValidationTransfer(draft, "2027-03-15"), [
        { id: "po-support-pe-1", seq: 1, date: "2027-01-31", unitsInput: "150" },
      ]),
      "2027-02",
      "500",
    ),
    "1,500.00",
    "y1",
    "2027-04-30",
  );
}

function Probe() {
  const { draft, setDraft, persistence } = useAnalysis();
  return (
    <div>
      <p data-testid="mode">{persistence.mode}</p>
      <p data-testid="customer">{draft.contract.customerName}</p>
      <p data-testid="hours">
        {draft.performanceObligations.find((po) => po.id === "po-support")?.progressEvents?.length ??
          0}
      </p>
      <button type="button" onClick={() => setDraft((previous) => recordActuals(previous))}>
        record actuals
      </button>
    </div>
  );
}

function renderGuest() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider guest>
        <SaveStatusIndicator />
        <Probe />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store.row = null;
  store.lockVersion = 1;
  writeRow(genomixBenchmarkDraft());
  resume.mockImplementation(async () => workspace());
  saveGuest.mockImplementation(async (args: { data: { draft: WorkflowDraft } }) => {
    writeRow(args.data.draft);
    store.lockVersion += 1;
    return { ok: true, lockVersion: store.lockVersion, savedAt: new Date().toISOString() };
  });
});

describe("K8 — an R3 analysis is saved and resumed as a guest", () => {
  it("resumes the R3 contract, autosaves real actuals and returns them intact", async () => {
    const { unmount } = renderGuest();
    await screen.findByText("Helix Analytics");
    expect(screen.getByTestId("mode")).toHaveTextContent("guest");
    expect(screen.getByTestId("hours")).toHaveTextContent("0");

    fireEvent.click(screen.getByRole("button", { name: "record actuals" }));
    await waitFor(() => expect(saveGuest).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(saveGuest.mock.calls[0]![0].data.expectedLockVersion).toBe(1);
    unmount();

    // A fresh visit to the same temporary workspace.
    renderGuest();
    await screen.findByText("Helix Analytics");
    await waitFor(() => expect(screen.getByTestId("hours")).toHaveTextContent("1"));

    const expected = recordActuals(genomixBenchmarkDraft());
    const resumed = readRow();
    expect(r3OperationalFacts(resumed)).toEqual(r3OperationalFacts(expected));
  });

  it("produces identical accounting after the resume", async () => {
    const expected = recordActuals(genomixBenchmarkDraft());
    writeRow(expected);
    const resumed = readRow();
    const before = analyzeWorkflow(expected);
    const after = analyzeWorkflow(resumed);
    expect(after.adapterErrors).toEqual([]);
    expect(after.blockedReason).toBeNull();
    expect(after.progressive).toEqual(before.progressive);
  });

  it("keeps the facts stable across repeated save/resume cycles", () => {
    const expected = recordActuals(genomixBenchmarkDraft());
    writeRow(expected);
    writeRow(readRow());
    writeRow(readRow());
    expect(r3OperationalFacts(readRow())).toEqual(r3OperationalFacts(expected));
  });
});
