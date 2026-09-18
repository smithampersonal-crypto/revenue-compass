// @vitest-environment jsdom
/**
 * Phase 9G — Task 7. The registry may not over-promise exactness.
 *
 * `kind: "exact"` is a promise about the production DOM: Review & Finalize
 * says "Go to field" and the route scrolls to
 * `reviewTargetAnchorId(targetKey)`. This suite renders the REAL analysis
 * workspace over a representative canonical fixture and proves that every
 * target the registry calls exact is really owned by a production accounting
 * control. No anchor is ever inserted by the test.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import {
  describeReviewTarget,
  reviewTargetAnchorId,
} from "@/lib/arc/ai/review-presentation";
import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";

const navigate = vi.fn();

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearch: () => ({}),
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

let aiState: AiWorkspaceStateDto;

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => aiState,
  requestAiAnalysis: async () => aiState,
  affirmAiReviewItem: async () => aiState,
  resolveAiReviewIssue: async () => aiState,
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
  saveGuestDraft: vi.fn(),
  migrateGuestWorkspace: vi.fn(),
}));

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
}));

vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => ({ status: "signed-out", email: null, userId: null }),
}));

const {
  createEmptyDraft,
  createPromiseDraft,
  createPoDraft,
  createVcComponentDraft,
  createVcMeterDraft,
  createModificationDraft,
  createConsiderationEventDraft,
  createCashCollectionDraft,
} = await import("@/lib/asc606-workflow");
const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { Asc606AnalysisArea } = await import("./index");
const { ContractBalancesArea } = await import("./balances");

const PROMISE_GS = "pr-saas";
const PROMISE_OPT = "pr-renewal";
const PO_OVER_TIME = "po-saas";
const PO_POINT = "po-setup";
const VC_ESTIMATED = "vc-bonus";
const VC_USAGE = "vc-usage";
const METER = "vc-usage-m1";
const MOD = "mod-1";
const BILLING = "ce-annual";
const CASH = "cc-annual";

function fixtureDraft() {
  const empty = createEmptyDraft();
  return {
    ...empty,
    hasVariableConsideration: true,
    hasContractModifications: true,
    transactionPriceInput: "120000",
    promises: [
      {
        ...createPromiseDraft(1, PROMISE_GS),
        kind: "good_or_service" as const,
        performanceObligationId: PO_OVER_TIME,
      },
      { ...createPromiseDraft(2, PROMISE_OPT), kind: "customer_option" as const },
    ],
    performanceObligations: [
      {
        ...createPoDraft(1, PO_OVER_TIME),
        recognitionMethod: "over_time_ratable" as const,
        serviceStart: "2027-01-01",
        serviceEnd: "2027-12-31",
        sspInput: "120000",
      },
      {
        ...createPoDraft(2, PO_POINT),
        recognitionMethod: "point_in_time" as const,
        recognitionDate: "2027-01-15",
        sspInput: "10000",
      },
    ],
    variableConsiderationComponents: [
      { ...createVcComponentDraft(1, VC_ESTIMATED, "estimated") },
      {
        ...createVcComponentDraft(2, VC_USAGE, "usage_as_incurred"),
        meters: [{ ...createVcMeterDraft(1, METER), rateAmountInput: "0.10" }],
      },
    ],
    contractModifications: [{ ...createModificationDraft(1), id: MOD }],
    contractBalances: {
      considerationEvents: [createConsiderationEventDraft(1, BILLING)],
      cashCollections: [createCashCollectionDraft(1, CASH)],
    },
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
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "guest", limit: 3, used: 1, remaining: 2, resetAt: null },
    failure: null,
    ...overrides,
  } as AiWorkspaceStateDto;
}

function reviewItem(targetKey: string, section: string, severity: "yellow" | "red"): AiReviewItemDto {
  return {
    id: `item-${targetKey}`,
    targetKey,
    section: section as never,
    state: severity,
    severity,
    reasonCode: "accountant_affirmation_required",
    reason: "Confirm this conclusion.",
    reviewFingerprint: "fp-1",
    citations: [],
    resolution: null,
  } as AiReviewItemDto;
}

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

/** The real Contract Balances workpaper, where billing and cash are edited. */
function renderBalances() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} guest>
        <ContractBalancesArea />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

/** Representative canonical targets and the section each is persisted under. */
const CANDIDATES: ReadonlyArray<readonly [string, GuidanceReviewSection]> = [
  ["contract.customerName", "step_1"],
  ["contract.contractNumber", "step_1"],
  ["contract.executionDate", "step_1"],
  ["contract.criteria.collectibility_probable.answer", "step_1"],
  ["contract.criteria.collectibility_probable.rationale", "step_1"],

  [`promise:${PROMISE_GS}.kind`, "step_2"],
  [`promise:${PROMISE_GS}.description`, "step_2"],
  [`promise:${PROMISE_GS}.capableOfBeingDistinct`, "step_2"],
  [`promise:${PROMISE_GS}.distinctWithinContractContext`, "step_2"],
  [`promise:${PROMISE_GS}.distinctRationale`, "step_2"],
  [`promise:${PROMISE_GS}.performanceObligationId`, "step_2"],
  [`promise:${PROMISE_OPT}.conveysMaterialRight`, "step_2"],
  [`promise:${PROMISE_OPT}.materialRightRationale`, "step_2"],

  [`po:${PO_OVER_TIME}`, "step_2"],
  [`po:${PO_OVER_TIME}.name`, "step_2"],
  [`po:${PO_OVER_TIME}.classification`, "step_2"],
  [`po:${PO_OVER_TIME}.classificationRationale`, "step_2"],
  [`po:${PO_OVER_TIME}.recognitionMethod`, "step_5"],
  [`po:${PO_OVER_TIME}.recognitionRationale`, "step_5"],
  [`po:${PO_OVER_TIME}.servicePeriod`, "step_5"],
  [`po:${PO_OVER_TIME}.serviceStart`, "step_5"],
  [`po:${PO_OVER_TIME}.serviceEnd`, "step_5"],
  [`po:${PO_OVER_TIME}.sspInput`, "step_4"],
  [`po:${PO_OVER_TIME}.sspBasis`, "step_4"],
  [`po:${PO_POINT}.recognitionDate`, "step_5"],

  ["transactionPrice.input", "step_3"],
  ["transactionPrice.notes", "step_3"],
  ["draft.hasVariableConsideration", "step_3"],
  ["draft.hasContractModifications", "additional_topics"],

  [`vc:${VC_ESTIMATED}`, "step_3"],
  [`vc:${VC_ESTIMATED}.description`, "step_3"],
  [`vc:${VC_ESTIMATED}.treatment`, "step_3"],
  [`vc:${VC_ESTIMATED}.estimationMethod`, "step_3"],
  [`vc:${VC_ESTIMATED}.inception`, "step_3"],
  [`vc:${VC_USAGE}.meter.rateAmountInput`, "step_3"],
  [`vc:${VC_USAGE}.meter.name`, "step_3"],
  [`vc:${VC_USAGE}.meter.unit`, "step_3"],
  [`vc:${VC_USAGE}.usagePeriods`, "step_5"],

  [`modification:${MOD}`, "additional_topics"],
  [`modification:${MOD}.phase5cFacts`, "additional_topics"],
  [`modification:${MOD}.modificationDate`, "additional_topics"],
  [`modification:${MOD}.considerationMagnitudeInput`, "additional_topics"],
  [`modification:${MOD}.approvedAndEnforceable`, "additional_topics"],
  [`modification:${MOD}.scopeChangeDescription`, "additional_topics"],
  [`modification:${MOD}.priceReflectsAddedGoodsSsp`, "additional_topics"],

  // Billing and cash live on the Contract Balances workpaper, a different
  // page: the registry presents them as their section, so they are asserted
  // as fallback rather than as analysis-page anchors.

];

beforeEach(() => {
  navigate.mockReset();
  aiState = workspace();
});

describe("every exact registry target has a real production anchor", () => {
  it("renders the anchor the review navigation promises, for each exact target", async () => {
    const { container } = renderArea();
    // Wait for the resumed canonical fixture, not just the empty shell.
    await waitFor(() =>
      expect(
        container.querySelector(
          `#${CSS.escape(reviewTargetAnchorId(`promise:${PROMISE_GS}.description`))}`,
        ),
      ).not.toBeNull(),
    );

    const missing: string[] = [];
    for (const [targetKey, section] of CANDIDATES) {
      const presented = describeReviewTarget(targetKey, section);
      if (presented.kind !== "exact") continue;
      expect(presented.anchorId).toBe(reviewTargetAnchorId(targetKey));
      if (container.querySelector(`#${CSS.escape(presented.anchorId!)}`) === null) {
        missing.push(targetKey);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("inline markers and provenance on real accounting controls", () => {
  it("marks the promise distinctness judgment for review", async () => {
    aiState = workspace({
      reviewItems: [reviewItem(`promise:${PROMISE_GS}.capableOfBeingDistinct`, "step_2", "yellow")],
      reviewIssueCount: 1,
    });
    const { container } = renderArea();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`promise:${PROMISE_GS}.capableOfBeingDistinct`))}`,
      );
      expect(anchor?.textContent).toContain("Review");
    });
  });

  it("marks the performance obligation recognition method for resolution", async () => {
    aiState = workspace({
      reviewItems: [reviewItem(`po:${PO_OVER_TIME}.recognitionMethod`, "step_5", "red")],
      reviewIssueCount: 1,
    });
    const { container } = renderArea();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`po:${PO_OVER_TIME}.recognitionMethod`))}`,
      );
      expect(anchor?.textContent).toContain("Resolve");
    });
  });

  it("marks the variable-consideration inception assessment", async () => {
    aiState = workspace({
      reviewItems: [reviewItem(`vc:${VC_ESTIMATED}.inception`, "step_3", "yellow")],
      reviewIssueCount: 1,
    });
    const { container } = renderArea();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`vc:${VC_ESTIMATED}.inception`))}`,
      );
      expect(anchor?.textContent).toContain("Review");
    });
  });

  it("marks a usage meter field at the meter group that owns it", async () => {
    aiState = workspace({
      reviewItems: [reviewItem(`vc:${VC_USAGE}.meter.rateAmountInput`, "step_3", "yellow")],
      reviewIssueCount: 1,
    });
    const { container } = renderArea();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`vc:${VC_USAGE}.meter.rateAmountInput`))}`,
      );
      expect(anchor?.textContent).toContain("Review");
    });
  });

  it("marks the contract modification workpaper for phase5cFacts", async () => {
    aiState = workspace({
      reviewItems: [reviewItem(`modification:${MOD}.phase5cFacts`, "additional_topics", "red")],
      reviewIssueCount: 1,
    });
    const { container } = renderArea();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`modification:${MOD}.phase5cFacts`))}`,
      );
      expect(anchor?.textContent).toContain("Resolve");
    });
  });

  it("badges billing invoice-date provenance on the real balances workpaper", async () => {
    aiState = workspace({
      fieldProvenance: {
        [`billing:${BILLING}.invoiceDate`]: { state: "ai_generated_untouched" },
      } as never,
    });
    const { container } = renderBalances();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`billing:${BILLING}.invoiceDate`))}`,
      );
      expect(anchor?.textContent).toContain("AI drafted");
    });
  });

  it("marks a cash collection date on the real balances workpaper", async () => {
    aiState = workspace({
      reviewItems: [reviewItem(`cash:${CASH}.collectionDate`, "additional_topics", "red")],
      reviewIssueCount: 1,
    });
    const { container } = renderBalances();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`cash:${CASH}.collectionDate`))}`,
      );
      expect(anchor?.textContent).toContain("Resolve");
    });
  });

  it("presents billing and cash targets as their section, never as a false anchor", () => {
    for (const key of [
      `billing:${BILLING}.invoiceDate`,
      `billing:${BILLING}.amountInput`,
      `cash:${CASH}.collectionDate`,
    ]) {
      const presented = describeReviewTarget(key, "additional_topics");
      expect(presented.kind).toBe("section");
      expect(presented.anchorId).toBeNull();
    }
  });

  it("shows the field's own provenance, never the parent object's", async () => {
    aiState = workspace({
      fieldProvenance: {
        [`vc:${VC_ESTIMATED}.treatment`]: { state: "ai_generated_user_edited" },
      } as never,
      objectProvenance: {
        [VC_ESTIMATED]: {
          canonicalId: VC_ESTIMATED,
          state: "ai_generated_untouched",
          userModified: false,
        },
      } as never,
    });
    const { container } = renderArea();
    await waitFor(() => {
      const anchor = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(`vc:${VC_ESTIMATED}.treatment`))}`,
      );
      expect(anchor?.textContent).toContain("AI drafted · edited");
    });
    const anchor = container.querySelector(
      `#${CSS.escape(reviewTargetAnchorId(`vc:${VC_ESTIMATED}.treatment`))}`,
    )!;
    // The unrelated object badge must not leak into the field boundary.
    expect(anchor.querySelector("span")?.textContent).not.toBe("AI drafted");
  });
});

it("keeps the workspace usable without any AI review state", async () => {
  aiState = workspace({ hasAnalysis: false });
  renderArea();
  await waitFor(() => expect(screen.getAllByText(/Step 1/).length).toBeGreaterThan(0));
});
