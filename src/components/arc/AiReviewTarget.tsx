import { createContext, useContext, type ReactNode } from "react";

import type { AiFieldProvenanceDto, AiObjectProvenanceDto, AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import {
  provenanceBadgeLabel,
  reviewMarkerLabel,
  reviewTargetAnchorId,
} from "@/lib/arc/ai/review-presentation";

/**
 * Phase 9G — Task 7. The inline AI presentation boundary.
 *
 * This wrapper is presentation only. It never owns an accounting value, an
 * onChange, review severity derivation, merge behaviour, a review fingerprint
 * or any accounting maths: it reads the accepted safe workspace state and
 * renders a stable anchor, a review marker, or a provenance badge. Provenance
 * is never an approval, so a marker always outranks a badge.
 */
export type AiReviewTargetWorkspace = {
  reviewItems: ReadonlyArray<AiReviewItemDto>;
  fieldProvenance: Record<string, AiFieldProvenanceDto>;
  objectProvenance: Record<string, AiObjectProvenanceDto>;
};

const TargetContext = createContext<AiReviewTargetWorkspace | null>(null);

export function AiReviewTargetProvider({
  workspace,
  children,
}: {
  workspace: AiReviewTargetWorkspace | null;
  children: ReactNode;
}) {
  return <TargetContext.Provider value={workspace}>{children}</TargetContext.Provider>;
}

export function AiReviewTarget({
  targetKey,
  canonicalObjectId,
  className,
  children,
}: {
  targetKey: string;
  canonicalObjectId?: string;
  className?: string;
  children: ReactNode;
}) {
  const workspace = useContext(TargetContext);
  const anchorId = reviewTargetAnchorId(targetKey);

  const openItem =
    workspace?.reviewItems.find((item) => item.targetKey === targetKey && item.state !== "resolved") ??
    null;
  const marker = openItem === null ? null : reviewMarkerLabel(openItem.severity);

  const provenanceState =
    canonicalObjectId !== undefined
      ? (workspace?.objectProvenance[canonicalObjectId]?.state ?? null)
      : (workspace?.fieldProvenance[targetKey]?.state ?? null);
  const badge = marker === null && provenanceState ? provenanceBadgeLabel(provenanceState) : null;

  return (
    <div id={anchorId} className={className} data-ai-review-target={targetKey}>
      {marker || badge ? (
        <div className="mb-1 flex items-center gap-2">
          {marker ? (
            <span
              className={
                openItem?.severity === "red"
                  ? "rounded-full border border-destructive px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive"
                  : "rounded-full border border-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary"
              }
            >
              {marker}
            </span>
          ) : null}
          {badge ? (
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
