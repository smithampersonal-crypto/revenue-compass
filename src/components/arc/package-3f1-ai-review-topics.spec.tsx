// @vitest-environment jsdom
/**
 * Package 3F.1 — generic Additional Topics AI review items are visible,
 * read-only, and counted from exactly the rows that are rendered.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdditionalTopics } from "@/components/arc/AdditionalTopics";
import type { AiReviewTopicItem } from "@/components/arc/AiReviewTopicsList";
import {
  aiReviewTopicRowId,
  describeReviewTarget,
  genericAdditionalTopicReviewItems,
  genericReviewTopicLabel,
} from "@/lib/arc/ai/review-presentation";
import { analyzeWorkflow, createEmptyDraft } from "@/lib/asc606-workflow";

const item = (
  id: string,
  targetKey: string,
  overrides: Partial<AiReviewTopicItem> = {},
): AiReviewTopicItem => ({
  id,
  targetKey,
  section: "additional_topics",
  state: "red",
  severity: "red",
  reason: `Advisory reason ${id}.`,
  ...overrides,
});

/** The four generic items from the original Aster run, plus non-generic ones. */
const ASTER_ITEMS: AiReviewTopicItem[] = [
  item("a", "additionalTopic:customer_acceptance"),
  item("b", "additionalTopic:licenses", { state: "yellow", severity: "yellow" }),
  item("c", "additionalTopic:warranties", { state: "yellow", severity: "yellow" }),
  item("d", "billing:billing_fixed_dated_invoices"),
  item("m", "modification:mod-1.effectiveDate"),
  item("v", "vc:vc-1.meter.unitRate"),
  item("x", "contract.criteria.collectibility_probable.answer", { section: "step_1" }),
  item("r", "additionalTopic:principal_agent", { state: "resolved" }),
];

function renderTopics(items: readonly AiReviewTopicItem[], onOpen = vi.fn()) {
  const draft = createEmptyDraft();
  render(
    <AdditionalTopics
      draft={draft}
      onChange={() => {}}
      result={analyzeWorkflow(draft)}
      open={{}}
      onToggle={() => {}}
      onNavigate={() => {}}
      aiReviewStatus={() => null}
      genericReviewItems={genericAdditionalTopicReviewItems(items)}
      onOpenReviewItem={onOpen}
    />,
  );
  return onOpen;
}

describe("3F.1 generic Additional Topics review", () => {
  it("the shared set is exactly the unresolved generic fallback items", () => {
    expect(genericAdditionalTopicReviewItems(ASTER_ITEMS).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("modification and VC navigation are unchanged", () => {
    expect(
      describeReviewTarget("modification:mod-1.effectiveDate", "additional_topics")
        .sectionElementId,
    ).toBe("topic-modifications");
    expect(
      describeReviewTarget("vc:vc-1.meter.unitRate", "additional_topics").sectionElementId,
    ).toBe("topic-variable-consideration");
    expect(
      describeReviewTarget("contract.criteria.collectibility_probable.answer", "step_1").kind,
    ).toBe("exact");
  });

  it("uses accountant-readable labels, never target keys", () => {
    expect(genericReviewTopicLabel("billing:billing_fixed_dated_invoices")).toBe(
      "Billing schedule",
    );
    expect(genericReviewTopicLabel("additionalTopic:customer_acceptance")).toBe(
      "Customer acceptance",
    );
  });

  it("badge count equals the visible rows; rows are read-only", () => {
    renderTopics(ASTER_ITEMS);
    expect(screen.getByText("4 AI review")).toBeInTheDocument();
    const list = screen.getByTestId("ai-review-topics");
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(list.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(within(list).getByText("Billing schedule")).toBeInTheDocument();
    expect(within(list).queryByText(/billing_fixed_dated_invoices/)).toBeNull();
    // Not duplicated from modification / VC / exact-field / resolved items.
    expect(within(list).queryByText(/modification:mod-1/)).toBeNull();
    expect(within(list).queryByText(/principal_agent/)).toBeNull();
    // Each row is a real navigation destination.
    expect(document.getElementById(aiReviewTopicRowId("d"))).toBeInTheDocument();
  });

  it("Review in Review & Finalize opens the corresponding review item", async () => {
    const onOpen = renderTopics(ASTER_ITEMS);
    const row = document.getElementById(aiReviewTopicRowId("a")) as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Review in Review & Finalize" }));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("no generic items: no badge and no list", () => {
    renderTopics(ASTER_ITEMS.filter((i) => !["a", "b", "c", "d"].includes(i.id)));
    expect(screen.queryByText(/AI review$/)).toBeNull();
    expect(screen.queryByTestId("ai-review-topics")).toBeNull();
  });
});
