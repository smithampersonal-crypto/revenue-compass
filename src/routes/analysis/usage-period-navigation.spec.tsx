// @vitest-environment jsdom
/**
 * Phase 9G-R3 — Phase L. "Go to field" for a measured usage month.
 *
 * Usage actuals are filed against Step 3 guidance but are only ever entered in
 * Step 5, so navigation has to open Step 5 and reach the row's own control.
 * Nothing here inserts an anchor: every element is produced by the real
 * production workspace.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import { describeReviewTarget, reviewTargetAnchorId } from "@/lib/arc/ai/review-presentation";

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
const saveGuestDraft = vi.fn();
const resolveAiReviewIssue = vi.fn(async () => aiState);
const affirmAiReviewItem = vi.fn(async () => aiState);

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => aiState,
  requestAiAnalysis: async () => aiState,
  affirmAiReviewItem: (...args: unknown[]) => affirmAiReviewItem(...(args as [])),
  resolveAiReviewIssue: (...args: unknown[]) => resolveAiReviewIssue(...(args as [])),
  acknowledgeAiStaleSources: async () => aiState,
}));

vi.mock("@/lib/arc/persistence/guest.functions", () => ({
  resumeGuestWorkspace: async () => ({
    kind: "guest",
    draft: fixtureDraft(),
    lockVersion: 1,
    expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    schemaVersion: "arc.workflow.v1",
    resumed: false,
  }),
  saveGuestDraft: (...args: unknown[]) => saveGuestDraft(...(args as [])),
  migrateGuestWorkspace: vi.fn(),
}));

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
}));

vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => ({ status: "signed-out", email: null, userId: null }),
}));

const { createEmptyDraft, createVcComponentDraft, createVcMeterDraft } =
  await import("@/lib/asc606-workflow");
const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { Asc606AnalysisArea } = await import("./index");

const VC_A = "vc-usage-a";
const VC_B = "vc-usage-b";
const ROW_1 = "vc-usage-a-p1";
const ROW_2 = "vc-usage-a-p2";

function usageComponent(seq: number, id: string, rows: ReadonlyArray<string>) {
  return {
    ...createVcComponentDraft(seq, id, "usage_as_incurred"),
    meters: [{ ...createVcMeterDraft(1, `${id}-m1`), rateAmountInput: "0.10", unit: "sample" }],
    usagePeriods: rows.map((rowId, index) => ({
      id: rowId,
      month: `2027-0${index + 2}`,
      quantities: {},
    })),
  };
}

function fixtureDraft() {
  return {
    ...createEmptyDraft(),
    hasVariableConsideration: true,
    variableConsiderationComponents: [
      usageComponent(1, VC_A, [ROW_1, ROW_2]),
      usageComponent(2, VC_B, [`${VC_B}-p1`]),
    ],
  };
}

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

function usageItem(targetKey: string): AiReviewItemDto {
  return {
    id: "item-usage",
    targetKey,
    // Filed under the Step 3 guidance section, exactly as the merge raises it.
    section: "step_3",
    state: "red",
    severity: "red",
    reasonCode: "missing_required_input",
    reason: "Enter actual usage quantities — ARC never forecasts volume.",
    reviewFingerprint: "fp-usage",
    guidanceReferenceCount: 0,
    citations: [],
    resolution: null,
  } as AiReviewItemDto;
}

beforeEach(() => {
  navigate.mockReset();
  saveGuestDraft.mockReset();
  resolveAiReviewIssue.mockReset();
  affirmAiReviewItem.mockReset();
  search = {};
  aiState = workspace();
});

function renderArea() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} guest>
        <Asc606AnalysisArea />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

describe("usage-period review navigation", () => {
  it("presents the usage-period target in Step 5 even though it is filed under Step 3", () => {
    const component = describeReviewTarget(`vc:${VC_A}.usagePeriods`, "step_3");
    expect(component.kind).toBe("exact");
    expect(component.sectionElementId).toBe("step-5");

    const row = describeReviewTarget(`vc:${VC_A}.usagePeriods.${ROW_1}`, "step_3");
    expect(row.kind).toBe("exact");
    expect(row.sectionElementId).toBe("step-5");
  });

  it("scrolls to the specific usage row, not merely the parent component", async () => {
    const targetKey = `vc:${VC_A}.usagePeriods.${ROW_2}`;
    aiState = workspace({ reviewItems: [usageItem(targetKey)], reviewIssueCount: 1 });
    search = { review: "item-usage" };
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    } as never;

    const { container } = renderArea();

    const anchor = await waitFor(() => {
      const found = container.querySelector(`#${CSS.escape(reviewTargetAnchorId(targetKey))}`);
      expect(found).not.toBeNull();
      return found!;
    });

    await waitFor(() => expect(scrolled).toContain(anchor));

    // Not the parent component block, and not the other row or component.
    const wrong = [
      `vc:${VC_A}.usagePeriods`,
      `vc:${VC_A}.usagePeriods.${ROW_1}`,
      `vc:${VC_B}.usagePeriods.${VC_B}-p1`,
    ].map((key) => container.querySelector(`#${CSS.escape(reviewTargetAnchorId(key))}`));
    for (const element of wrong) {
      expect(element).not.toBeNull();
      expect(scrolled).not.toContain(element);
    }
  });

  it("gives every usage row of every component its own distinct anchor", async () => {
    const { container } = renderArea();
    const keys = [
      `vc:${VC_A}.usagePeriods.${ROW_1}`,
      `vc:${VC_A}.usagePeriods.${ROW_2}`,
      `vc:${VC_B}.usagePeriods.${VC_B}-p1`,
    ];
    await waitFor(() => {
      const found = keys.map((key) =>
        container.querySelector(`#${CSS.escape(reviewTargetAnchorId(key))}`),
      );
      expect(found.filter(Boolean)).toHaveLength(keys.length);
      expect(new Set(found).size).toBe(keys.length);
    });
  });

  it("does not change the draft or the review state merely by navigating", async () => {
    const targetKey = `vc:${VC_A}.usagePeriods.${ROW_1}`;
    aiState = workspace({ reviewItems: [usageItem(targetKey)], reviewIssueCount: 1 });
    search = { review: "item-usage" };
    Element.prototype.scrollIntoView = function scrollIntoView() {} as never;

    renderArea();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          replace: true,
          search: expect.not.objectContaining({ review: expect.anything() }),
        }),
      ),
    );
    expect(saveGuestDraft).not.toHaveBeenCalled();
    expect(resolveAiReviewIssue).not.toHaveBeenCalled();
    expect(affirmAiReviewItem).not.toHaveBeenCalled();
  });
});
