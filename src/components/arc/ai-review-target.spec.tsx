// @vitest-environment jsdom
/**
 * Phase 9G — Task 7. Inline review markers and provenance badges.
 *
 * The wrapper is presentation only: it owns no accounting value, no onChange,
 * no severity derivation and no fingerprint. It renders the stable exact
 * anchor the review navigation scrolls to, shows Review/Resolve for an open
 * AI review item on that exact target, and otherwise shows provenance — never
 * both, and never as an approval.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiReviewTarget, AiReviewTargetProvider } from "./AiReviewTarget";
import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import { reviewTargetAnchorId } from "@/lib/arc/ai/review-presentation";

const YELLOW: AiReviewItemDto = {
  id: "item-yellow",
  targetKey: "contract.customerName",
  section: "step_1",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the customer.",
  reviewFingerprint: "fp-yellow",
  guidanceReferenceCount: 0,
  citations: [],
  resolution: null,
};

function harness(
  state: {
    reviewItems?: AiReviewItemDto[];
    fieldProvenance?: Record<string, { state: string }>;
    objectProvenance?: Record<
      string,
      { canonicalId: string; state: string; userModified: boolean }
    >;
  },
  children: React.ReactNode,
) {
  return render(
    <AiReviewTargetProvider
      workspace={
        {
          reviewItems: state.reviewItems ?? [],
          fieldProvenance: state.fieldProvenance ?? {},
          objectProvenance: state.objectProvenance ?? {},
        } as never
      }
    >
      {children}
    </AiReviewTargetProvider>,
  );
}

describe("AiReviewTarget", () => {
  it("renders a stable exact anchor for the canonical target", () => {
    const { container } = harness(
      {},
      <AiReviewTarget targetKey="contract.customerName">
        <input aria-label="Customer name" />
      </AiReviewTarget>,
    );
    expect(
      container.querySelector(`#${CSS.escape(reviewTargetAnchorId("contract.customerName"))}`),
    ).not.toBeNull();
    expect(screen.getByLabelText("Customer name")).toBeInTheDocument();
  });

  it("shows Review for an open yellow item on the exact target", () => {
    harness(
      { reviewItems: [YELLOW] },
      <AiReviewTarget targetKey="contract.customerName">
        <input aria-label="Customer name" />
      </AiReviewTarget>,
    );
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("shows Resolve for an open red item on the exact target", () => {
    harness(
      { reviewItems: [{ ...YELLOW, state: "red", severity: "red" }] },
      <AiReviewTarget targetKey="contract.customerName">
        <input aria-label="Customer name" />
      </AiReviewTarget>,
    );
    expect(screen.getByText("Resolve")).toBeInTheDocument();
  });

  it("never marks a target whose review item is resolved", () => {
    harness(
      { reviewItems: [{ ...YELLOW, state: "resolved" }] },
      <AiReviewTarget targetKey="contract.customerName">
        <input aria-label="Customer name" />
      </AiReviewTarget>,
    );
    expect(screen.queryByText("Review")).toBeNull();
    expect(screen.queryByText("Resolve")).toBeNull();
  });

  it("never marks a different target", () => {
    harness(
      { reviewItems: [YELLOW] },
      <AiReviewTarget targetKey="contract.contractNumber">
        <input aria-label="Contract number" />
      </AiReviewTarget>,
    );
    expect(screen.queryByText("Review")).toBeNull();
  });

  it("uses compact accessible markers for AI provenance and leaves manual input unmarked", () => {
    harness(
      {
        fieldProvenance: {
          "contract.customerName": { state: "ai_generated_untouched" },
          "contract.contractNumber": { state: "ai_generated_user_edited" },
          "contract.executionDate": { state: "ai_difference_preserved_user_override" },
          "contract.currency": { state: "manual_from_start" },
        },
      },
      <>
        <AiReviewTarget targetKey="contract.customerName">
          <input aria-label="a" />
        </AiReviewTarget>
        <AiReviewTarget targetKey="contract.contractNumber">
          <input aria-label="b" />
        </AiReviewTarget>
        <AiReviewTarget targetKey="contract.executionDate">
          <input aria-label="c" />
        </AiReviewTarget>
        <AiReviewTarget targetKey="contract.currency">
          <input aria-label="d" />
        </AiReviewTarget>
      </>,
    );
    const drafted = screen.getByLabelText("AI drafted");
    const edited = screen.getByLabelText("AI drafted · edited");
    expect(drafted).toHaveAttribute("title", "AI drafted");
    expect(edited).toHaveAttribute("title", "AI drafted · edited");
    expect(drafted).toHaveAttribute("data-ai-provenance-marker");
    expect(edited).toHaveAttribute("data-ai-provenance-marker");
    expect(drafted).toHaveTextContent("");
    expect(edited).toHaveTextContent("");
    expect(drafted.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    expect(edited.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
    expect(screen.getByText("Your value preserved")).toBeInTheDocument();
    expect(screen.queryByText(/manual/i)).toBeNull();
  });

  it("prefers the review marker over the provenance badge", () => {
    harness(
      {
        reviewItems: [YELLOW],
        fieldProvenance: { "contract.customerName": { state: "ai_generated_untouched" } },
      },
      <AiReviewTarget targetKey="contract.customerName">
        <input aria-label="Customer name" />
      </AiReviewTarget>,
    );
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.queryByLabelText("AI drafted")).toBeNull();
  });

  it("binds object provenance by canonical id, never by position", () => {
    harness(
      {
        objectProvenance: {
          "po-17": { canonicalId: "po-17", state: "ai_generated_untouched", userModified: false },
        },
      },
      <AiReviewTarget targetKey="po:po-17" canonicalObjectId="po-17">
        <div>Performance obligation</div>
      </AiReviewTarget>,
    );
    expect(screen.getByLabelText("AI drafted")).toHaveAttribute("title", "AI drafted");
  });

  it("shows the field's own provenance, never the parent object's", () => {
    harness(
      {
        fieldProvenance: { "vc:vc-1.treatment": { state: "ai_generated_user_edited" } },
        objectProvenance: {
          "vc-1": { canonicalId: "vc-1", state: "ai_generated_untouched", userModified: false },
        },
      },
      <AiReviewTarget targetKey="vc:vc-1.treatment" canonicalObjectId="vc-1">
        <div>Treatment</div>
      </AiReviewTarget>,
    );
    expect(screen.getByLabelText("AI drafted · edited")).toHaveAttribute(
      "title",
      "AI drafted · edited",
    );
    expect(screen.queryByLabelText("AI drafted")).toBeNull();
  });

  it("owns exactly one canonical target key", () => {
    const { container } = harness(
      {},
      <AiReviewTarget targetKey="vc:vc-1.meter.unit">
        <input aria-label="Unit" />
      </AiReviewTarget>,
    );
    expect(
      container.querySelector(`#${CSS.escape(reviewTargetAnchorId("vc:vc-1.meter.unit"))}`),
    ).not.toBeNull();
    expect(
      container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId("vc:vc-1.meter.rateAmountInput"))}`,
      ),
    ).toBeNull();
  });

  it("never marks a sibling field's review item", () => {
    harness(
      {
        reviewItems: [
          {
            ...YELLOW,
            id: "r",
            targetKey: "vc:vc-1.meter.rateAmountInput",
            severity: "red",
            state: "red",
          },
        ],
      },
      <AiReviewTarget targetKey="vc:vc-1.meter.unit">
        <input aria-label="Unit" />
      </AiReviewTarget>,
    );
    expect(screen.queryByText("Resolve")).toBeNull();
  });

  it("renders plain children when no AI workspace is present", () => {
    render(
      <AiReviewTarget targetKey="contract.customerName">
        <input aria-label="Customer name" />
      </AiReviewTarget>,
    );
    expect(screen.getByLabelText("Customer name")).toBeInTheDocument();
    expect(screen.queryByText("Review")).toBeNull();
  });
});
