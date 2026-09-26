// @vitest-environment jsdom
/**
 * Package 3D-R — accordion view state with review navigation (E) and on a
 * finalized / read-only revision (H). Leaving and returning to the ASC 606
 * Analysis workpaper is modelled exactly as the router does it: the area
 * unmounts and remounts while the layout-owned store survives.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import { reviewTargetAnchorId } from "@/lib/arc/ai/review-presentation";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";

const navigate = vi.fn();
let search: Record<string, string> = {};

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearch: () => search,
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

let aiState: AiWorkspaceStateDto;

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => aiState,
  requestAiAnalysis: async () => ({ ...aiState, executionDisposition: "reused_active_run" }),
  affirmAiReviewItem: async () => aiState,
  resolveAiReviewIssue: async () => aiState,
  acknowledgeAiStaleSources: async () => aiState,
}));

const saveGuest = vi.fn();
vi.mock("@/lib/arc/persistence/guest.functions", () => ({
  resumeGuestWorkspace: async () => ({
    kind: "guest",
    draft: createEmptyDraft(),
    lockVersion: 1,
    expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    schemaVersion: "arc.workflow.v1",
    resumed: false,
  }),
  saveGuestDraft: (args: unknown) => saveGuest(args),
  migrateGuestWorkspace: vi.fn(),
}));

const load = vi.fn();
const saveRevision = vi.fn();
vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: (args: unknown) => saveRevision(args),
}));

vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => ({ status: "signed-in", email: "a@example.test", userId: "u" }),
}));

const { createEmptyDraft } = await import("@/lib/asc606-workflow");
const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { AnalysisViewStateProvider } = await import("@/components/arc/analysis-view-state");
const { Asc606AnalysisArea } = await import("./index");

type Store = Map<string, Record<string, boolean>>;

function workspace(overrides: Partial<AiWorkspaceStateDto> = {}): AiWorkspaceStateDto {
  return {
    hasAnalysis: true,
    activeRun: null,
    latestRun: null,
    lastSuccessfulRunId: "run-1",
    sourceState: "current",
    hasIncludedSources: true,
    sourceSetFingerprint: "fp",
    reviewIssueCount: 0,
    reviewItems: [],
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "guest", limit: 3, used: 1, remaining: 2, resetAt: null },
    failure: null,
    ...overrides,
  } as AiWorkspaceStateDto;
}

const PRICE_ITEM: AiReviewItemDto = {
  id: "item-price",
  targetKey: "transactionPrice.input",
  section: "step_3",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the fixed consideration.",
  reviewFingerprint: "fp-price",
  guidanceReferenceCount: 0,
  citations: [],
  resolution: null,
};

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";

function renderArea(
  store: Store,
  identity: string,
  props: { contractId?: string; revisionId?: string } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider
        sample={undefined}
        contractId={props.contractId}
        revisionId={props.revisionId}
        guest={!props.contractId}
      >
        <AnalysisViewStateProvider identity={identity} store={store}>
          <Asc606AnalysisArea />
        </AnalysisViewStateProvider>
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

function header(name: RegExp) {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  navigate.mockReset();
  saveGuest.mockReset();
  saveRevision.mockReset();
  load.mockReset();
  search = {};
  aiState = workspace();
  Element.prototype.scrollIntoView = function scrollIntoView() {} as never;
});

describe("Package 3D-R — review navigation overrides a remembered closed section", () => {
  it("E: opens remembered-closed Step 3 for a review target, then keeps it open", async () => {
    const identity = "sample:|contract:|revision:";
    const store: Store = new Map([[identity, { "step-1": true, "step-3": false }]]);

    // The accountant had Step 3 closed; a review item inside Step 3 is invoked.
    aiState = workspace({ reviewItems: [PRICE_ITEM], reviewIssueCount: 1 });
    search = { review: PRICE_ITEM.id };
    const first = renderArea(store, identity);

    const step3 = await screen.findByRole("button", {
      name: /Step 3 — Determine the Transaction Price/,
    });
    await waitFor(() => expect(step3).toHaveAttribute("aria-expanded", "true"));
    const anchorId = reviewTargetAnchorId(PRICE_ITEM.targetKey);
    await waitFor(() => expect(document.getElementById(anchorId)).not.toBeNull());
    expect(document.getElementById("step-3")!.contains(document.getElementById(anchorId))).toBe(
      true,
    );
    // The one-shot intent was consumed with resetScroll: false (unchanged).
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/analysis", replace: true, resetScroll: false }),
      ),
    );
    expect(store.get(identity)?.["step-3"]).toBe(true);

    // Leave for another workpaper and return (unmount / remount).
    first.unmount();
    search = {};
    renderArea(store, identity);
    await waitFor(() =>
      expect(header(/Step 3 — Determine the Transaction Price/)).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
  });
});

describe("Package 3D-R — finalized / read-only revision", () => {
  it("H: toggles and navigation persistence work on a read-only revision without saving", async () => {
    load.mockResolvedValue({
      contractId: CONTRACT_ID,
      contractTitle: "Saved contract",
      contractNumber: null,
      customerName: "Northwind",
      analysisId: "33333333-3333-4333-8333-333333333333",
      revisionId: REVISION_ID,
      revisionNumber: 1,
      status: "finalized",
      lockVersion: 4,
      schemaVersion: "arc.workflow.v1",
      readOnly: true,
      draft: createDemoDraftIfKnown("horizon")!,
      snapshot: null,
    });
    const identity = `sample:|contract:${CONTRACT_ID}|revision:${REVISION_ID}`;
    const store: Store = new Map();
    const user = userEvent.setup();

    const first = renderArea(store, identity, { contractId: CONTRACT_ID, revisionId: REVISION_ID });
    const step2 = await screen.findByRole("button", {
      name: /Step 2 — Identify Performance Obligations/,
    });
    await user.click(step2);
    await user.click(header(/Step 1 — Identify the Contract/));
    expect(step2).toHaveAttribute("aria-expanded", "true");

    first.unmount();
    renderArea(store, identity, { contractId: CONTRACT_ID, revisionId: REVISION_ID });
    await waitFor(() =>
      expect(header(/Step 2 — Identify Performance Obligations/)).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(header(/Step 1 — Identify the Contract/)).toHaveAttribute("aria-expanded", "false");
    expect(saveRevision).not.toHaveBeenCalled();
  });
});
