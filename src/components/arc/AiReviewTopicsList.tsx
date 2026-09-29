import { Button } from "@/components/ui/button";
import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";
import {
  aiReviewTopicRowId,
  genericReviewTopicLabel,
  reviewStateLabel,
} from "@/lib/arc/ai/review-presentation";
import type { AiReviewItemState, AiReviewSeverity } from "@/lib/arc/ai/review-state";

export interface AiReviewTopicItem {
  id: string;
  targetKey: string;
  section: GuidanceReviewSection;
  state: AiReviewItemState;
  severity: AiReviewSeverity;
  reason: string;
}

/**
 * Package 3F.1 — read-only AI review topics inside Additional Topics Applied.
 *
 * These advisory conclusions have no canonical ARC field, so nothing here is
 * editable and nothing is resolved here: resolution stays in Review & Finalize.
 * The list is exactly the set counted by the Additional Topics badge.
 */
export function AiReviewTopicsList({
  items,
  onOpenReviewItem,
}: {
  items: readonly AiReviewTopicItem[];
  onOpenReviewItem?: ((reviewItemId: string) => void) | undefined;
}) {
  return (
    <section
      aria-labelledby="ai-review-topics-heading"
      className="rounded-md border border-border p-4"
      data-testid="ai-review-topics"
    >
      <h3 id="ai-review-topics-heading" className="text-sm font-semibold">
        AI review topics
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Advisory points with no editable field here. Review and resolve them in Review &amp;
        Finalize.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            id={aiReviewTopicRowId(item.id)}
            className="rounded-md border border-border/60 p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {genericReviewTopicLabel(item.targetKey)}
                </p>
                <p className="mt-1 break-words">{item.reason}</p>
              </div>
              <span className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                {reviewStateLabel(item)}
              </span>
            </div>
            {onOpenReviewItem ? (
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenReviewItem(item.id)}
                >
                  Review in Review &amp; Finalize
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
