import { createContext, useContext, type ReactNode } from "react";
import { PencilLine, Sparkles } from "lucide-react";

import type {
  AiFieldProvenanceDto,
  AiObjectProvenanceDto,
  AiReviewItemDto,
} from "@/lib/arc/ai/review-dto";
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
const ProvenanceLabelContext = createContext<string | null>(null);
const ExactTargetProvenanceLabelContext = createContext<string | null>(null);

export function AiReviewTargetProvider({
  workspace,
  children,
}: {
  workspace: AiReviewTargetWorkspace | null;
  children: ReactNode;
}) {
  return <TargetContext.Provider value={workspace}>{children}</TargetContext.Provider>;
}

/**
 * A field target (`vc:<id>.treatment`) always reads field provenance for that
 * exact key. An object boundary (`po:<id>`, no field segment) reads object
 * provenance by canonical id. The two sources are never conflated, so a field
 * badge can never display its parent object's provenance.
 */
function isFieldTarget(targetKey: string): boolean {
  return targetKey.includes(".");
}

/** Quiet metadata for the exact field target currently in scope. */
export function AiInlineProvenanceMarker() {
  const label = useContext(ProvenanceLabelContext);
  if (label !== "AI drafted" && label !== "AI drafted · edited") return null;

  return (
    <span
      aria-label={label}
      title={label}
      tabIndex={0}
      className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/80"
      data-ai-provenance-marker
    >
      <Sparkles aria-hidden="true" size={12} strokeWidth={1.75} />
      {label === "AI drafted · edited" ? (
        <PencilLine aria-hidden="true" size={9} strokeWidth={1.75} />
      ) : null}
    </span>
  );
}

/** Marker for an existing custom label owned by a composite exact target. */
export function AiExactTargetProvenanceMarker() {
  const label = useContext(ExactTargetProvenanceLabelContext);
  if (label !== "AI drafted" && label !== "AI drafted · edited") return null;

  return (
    <span
      aria-label={label}
      title={label}
      tabIndex={0}
      className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/80"
      data-ai-provenance-marker
    >
      <Sparkles aria-hidden="true" size={12} strokeWidth={1.75} />
      {label === "AI drafted · edited" ? (
        <PencilLine aria-hidden="true" size={9} strokeWidth={1.75} />
      ) : null}
    </span>
  );
}

function isCompositeFieldTarget(targetKey: string): boolean {
  return /\.(?:inception|phase5cFacts|progressEvents|realizedEvents|seriesPeriods|servicePeriod|usagePeriods(?:\.|$))/.test(
    targetKey,
  );
}

export function AiProvenanceLegend({ workspace }: { workspace: AiReviewTargetWorkspace | null }) {
  const hasAiFieldProvenance = Object.values(workspace?.fieldProvenance ?? {}).some(
    ({ state }) => state === "ai_generated_untouched" || state === "ai_generated_user_edited",
  );
  if (!hasAiFieldProvenance) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
      <Sparkles aria-hidden="true" size={12} strokeWidth={1.75} />
      AI drafted · Hover for provenance
    </span>
  );
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
    workspace?.reviewItems.find(
      (item) => item.targetKey === targetKey && item.state !== "resolved",
    ) ?? null;
  const marker = openItem === null ? null : reviewMarkerLabel(openItem.severity);

  const provenanceState = isFieldTarget(targetKey)
    ? (workspace?.fieldProvenance[targetKey]?.state ?? null)
    : canonicalObjectId !== undefined
      ? (workspace?.objectProvenance[canonicalObjectId]?.state ?? null)
      : null;
  const badge = marker === null && provenanceState ? provenanceBadgeLabel(provenanceState) : null;
  const fieldBadge = isFieldTarget(targetKey) ? badge : null;
  const compactFieldBadge =
    fieldBadge === "AI drafted" || fieldBadge === "AI drafted · edited" ? fieldBadge : null;
  const commonLabelBadge = isCompositeFieldTarget(targetKey) ? null : compactFieldBadge;
  const visibleBoundaryBadge =
    fieldBadge !== "AI drafted" && fieldBadge !== "AI drafted · edited" ? fieldBadge : null;

  return (
    <ExactTargetProvenanceLabelContext.Provider value={compactFieldBadge}>
      <ProvenanceLabelContext.Provider value={commonLabelBadge}>
        <div id={anchorId} className={className} data-ai-review-target={targetKey}>
      {marker || visibleBoundaryBadge ? (
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
          {visibleBoundaryBadge ? (
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {visibleBoundaryBadge}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
        </div>
      </ProvenanceLabelContext.Provider>
    </ExactTargetProvenanceLabelContext.Provider>
  );
}
