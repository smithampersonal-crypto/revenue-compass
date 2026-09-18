/**
 * Phase 9G — Task 7. The pure review presentation registry.
 *
 * One place owns every answer to "what does an accountant call this, which
 * workflow section owns it, and is there a real control to scroll to". Raw
 * target-key parsing therefore never leaks into JSX.
 *
 * Presentation only. Nothing here participates in review fingerprints,
 * severity, merge semantics, accounting math or finalization, and it never
 * invents a field binding: a composite, advisory or unrepresentable target
 * honestly falls back to its owning section.
 *
 * Pure: no React, no network, no database, no clock.
 */

import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";

import { stableHash } from "./identity";
import type { AiProvenanceState } from "./merge";
import type { AiReviewCitationDto, AiReviewResolutionDto } from "./review-dto";
import type { AiReviewItemState, AiReviewSeverity, ManualRedReason } from "./review-state";

/* --------------------------------------------------------- section copy */

const SECTION_LABELS: Record<GuidanceReviewSection, string> = {
  step_1: "Step 1 — Identify the Contract",
  step_2: "Step 2 — Identify Performance Obligations",
  step_3: "Step 3 — Determine the Transaction Price",
  step_4: "Step 4 — Allocate the Transaction Price",
  step_5: "Step 5 — Recognize Revenue",
  additional_topics: "Additional Topics Applied",
};

export function reviewSectionLabel(section: GuidanceReviewSection): string {
  return SECTION_LABELS[section];
}

/** The workflow accordion that owns a section, before subtopic refinement. */
const SECTION_ELEMENT_IDS: Record<GuidanceReviewSection, string> = {
  step_1: "step-1",
  step_2: "step-2",
  step_3: "step-3",
  step_4: "step-4",
  step_5: "step-5",
  additional_topics: "additional-topics",
};

/* ------------------------------------------------------------ state copy */

export const REVIEW_STATE_LABELS = {
  yellow: "Needs confirmation",
  red: "Needs resolution",
  resolved: "Resolved",
} as const;

/** Severity is always expressed in words. Colour is never the only signal. */
export function reviewStateLabel(item: {
  state: AiReviewItemState;
  severity: AiReviewSeverity;
}): string {
  return item.state === "resolved"
    ? REVIEW_STATE_LABELS.resolved
    : REVIEW_STATE_LABELS[item.severity];
}

/** The restrained inline marker beside an accounting control. */
export function reviewMarkerLabel(severity: AiReviewSeverity): string {
  return severity === "red" ? "Resolve" : "Review";
}

/* ----------------------------------------------------------- target keys */

export type ReviewAnchorKind = "exact" | "section";

export interface ReviewTargetPresentation {
  /** Whether ARC has a real individual control for this target. */
  kind: ReviewAnchorKind;
  /** Accountant-facing description. Never a raw target key. */
  label: string;
  /** The DOM anchor an exact target may be scrolled to, else null. */
  anchorId: string | null;
  /** The accordion to open and scroll to. Always present. */
  sectionElementId: string;
}

/** A deterministic, DOM-safe anchor id. Stable across renders and processes. */
export function reviewTargetAnchorId(targetKey: string): string {
  const slug = targetKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `ai-review-target-${slug || "target"}-${stableHash(targetKey).slice(0, 8)}`;
}

function humanize(field: string): string {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.length === 0 ? "" : words.charAt(0).toUpperCase() + words.slice(1);
}

const PO_FIELDS = new Set([
  "classification",
  "recognitionMethod",
  "recognitionDate",
  "servicePeriod",
  "sspInput",
  "name",
  "kind",
  "materialRightStatus",
]);

const TRANSACTION_PRICE_FIELDS: Record<string, string> = {
  input: "Fixed consideration",
  notes: "Transaction price notes",
};

const VC_FIELDS = new Set(["treatment", "inception", "usagePeriods"]);

/**
 * Classifies one canonical target into presentation. The persisted review
 * section is authoritative for WHERE the item lives; the target key only says
 * whether a precise control exists and what to call it.
 */
export function describeReviewTarget(
  targetKey: string,
  section: GuidanceReviewSection,
): ReviewTargetPresentation {
  const exact = (label: string): ReviewTargetPresentation => ({
    kind: "exact",
    label,
    anchorId: reviewTargetAnchorId(targetKey),
    sectionElementId: sectionElementIdFor(targetKey, section),
  });
  const fallback = (): ReviewTargetPresentation => ({
    kind: "section",
    label: reviewSectionLabel(section),
    anchorId: null,
    sectionElementId: sectionElementIdFor(targetKey, section),
  });

  const criterion = /^contract\.criteria\.([^.]+)\.(answer|rationale)$/.exec(targetKey);
  if (criterion) {
    const name = humanize(criterion[1]!);
    return exact(
      criterion[2] === "rationale"
        ? `Contract criterion rationale — ${name}`
        : `Contract criterion — ${name}`,
    );
  }

  const contract = /^contract\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (contract) return exact(`Contract detail — ${humanize(contract[1]!)}`);

  const promise = /^promise:[^.]+\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (promise) return exact(`Promise — ${humanize(promise[1]!)}`);

  if (/^po:[^.]+$/.test(targetKey) || /^object:[^.]+$/.test(targetKey)) {
    return exact("Performance obligation");
  }

  const po = /^po:[^.]+\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (po && PO_FIELDS.has(po[1]!)) {
    return exact(`Performance obligation — ${humanize(po[1]!)}`);
  }

  const price = /^transactionPrice\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (price) {
    const label = TRANSACTION_PRICE_FIELDS[price[1]!];
    // Financing, noncash and consideration-payable conclusions are advisory:
    // ARC has no canonical field for them, so navigation must not pretend it
    // does. The accountant is taken to Step 3 instead.
    return label ? exact(label) : fallback();
  }

  const vc = /^vc:[^.]+\.(.+)$/.exec(targetKey);
  if (vc && (VC_FIELDS.has(vc[1]!) || vc[1]!.startsWith("meter."))) {
    return exact(`Variable consideration — ${humanize(vc[1]!)}`);
  }

  const modification = /^modification:[^.]+\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (modification) return exact(`Contract modification — ${humanize(modification[1]!)}`);

  const structural = /^draft\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (structural) return exact(`Analysis setting — ${humanize(structural[1]!)}`);

  const billing = /^billing:[^.]+\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (billing) return exact(`Billing event — ${humanize(billing[1]!)}`);

  const cash = /^cash:[^.]+\.([A-Za-z0-9_]+)$/.exec(targetKey);
  if (cash) return exact(`Cash collection — ${humanize(cash[1]!)}`);

  return fallback();
}

/**
 * Additional Topics is several accordions, so a modification or a variable
 * consideration target opens its own subtopic. Anything else opens Additional
 * Topics Applied rather than guessing a subtopic.
 */
function sectionElementIdFor(targetKey: string, section: GuidanceReviewSection): string {
  if (section !== "additional_topics") return SECTION_ELEMENT_IDS[section];
  if (targetKey.startsWith("modification:") || targetKey === "draft.hasContractModifications") {
    return "topic-modifications";
  }
  if (targetKey.startsWith("vc:")) return "topic-variable-consideration";
  return SECTION_ELEMENT_IDS.additional_topics;
}

/* --------------------------------------------------------------- evidence */

/** Validated citation material only. No document id, no filename, no URL. */
export function citationLabel(citation: AiReviewCitationDto): string {
  const pages =
    citation.pageEnd > citation.pageStart
      ? `pages ${citation.pageStart}–${citation.pageEnd}`
      : `page ${citation.pageStart}`;
  return citation.evidenceMode === "visual"
    ? `Visual source evidence — ${pages}`
    : `Source evidence — ${pages}`;
}

/* ------------------------------------------------------------ resolutions */

export const MANUAL_RED_REASON_OPTIONS: ReadonlyArray<{
  value: ManualRedReason;
  label: string;
  helper: string;
}> = [
  {
    value: "reviewed_current_treatment",
    label: "Reviewed current treatment",
    helper:
      "I independently reviewed the current accounting treatment and concluded it is appropriate.",
  },
  {
    value: "outside_source_information",
    label: "Used information outside the uploaded source documents",
    helper:
      "I resolved this item using other information that is not contained in the selected contract documents.",
  },
  {
    value: "not_applicable",
    label: "Not applicable",
    helper: "This review item does not apply to this contract or accounting conclusion.",
  },
];

const MANUAL_RED_REASON_LABELS: Record<ManualRedReason, string> = {
  reviewed_current_treatment: "Reviewed current treatment",
  outside_source_information: "Used information outside the uploaded source documents",
  not_applicable: "Not applicable",
};

export function manualRedReasonLabel(reason: ManualRedReason): string {
  return MANUAL_RED_REASON_LABELS[reason];
}

/** Matches the accepted Task 2 server bound. The server revalidates it. */
export const REVIEW_NOTE_MAX_LENGTH = 2000;

/** How a resolved item is described. Task 4 edits are never called approvals. */
export function resolutionSummary(resolution: AiReviewResolutionDto | null): string | null {
  if (resolution === null) return null;
  if (resolution.kind === "manual_red") return MANUAL_RED_REASON_LABELS[resolution.reason];
  return resolution.method === "edited"
    ? "Resolved by editing the accounting conclusion"
    : "Confirmed";
}

/* ------------------------------------------------------------ provenance */

const PROVENANCE_LABELS: Partial<Record<AiProvenanceState, string>> = {
  ai_generated_untouched: "AI drafted",
  ai_generated_user_edited: "AI drafted · edited",
  ai_difference_preserved_user_override: "Your value preserved",
};

/**
 * Provenance is informational, never an approval state. Ordinary manual input
 * and historical prior-finalized values are deliberately unbadged: the absence
 * of a badge already means normal accounting input.
 */
export function provenanceBadgeLabel(state: AiProvenanceState): string | null {
  return PROVENANCE_LABELS[state] ?? null;
}
