/**
 * Phase 9G — Task 4. Pure edit reconciliation.
 *
 * The canonical draft is authoritative accounting. This module makes ARC's AI
 * sidecar FOLLOW an accountant's edit: it never rewrites, reinterprets or
 * second-guesses the edit itself.
 *
 * Pure: no database, no React, no network, no OpenAI, no environment, no
 * clock, no randomness. Timestamps are authored by the trusted persistence
 * layer, which passes the stamp back into `applyEditReviewIntents`.
 */

import { parseUsdToCents, type WorkflowDraft } from "@/lib/asc606-workflow";
import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";

import { valueFingerprint } from "./identity";
import { aiObjectFingerprint, type AiAnalysisState } from "./merge";
import type { AiReviewItem, AiReviewSeverity } from "./review-state";

/* ------------------------------------------------------- canonical reading */

type ObjectFamily = "promise" | "po" | "vc" | "modification" | "billing" | "cash";

const OBJECT_FAMILIES: readonly ObjectFamily[] = [
  "promise",
  "po",
  "vc",
  "modification",
  "billing",
  "cash",
];

/** Families that are advisory or diagnostic and have no canonical value. */
const UNREPRESENTABLE_PREFIXES = ["additionalTopic:", "issue:"];

interface ParsedKey {
  family: ObjectFamily | "contract" | "criterion" | "transactionPrice" | "structural" | null;
  canonicalId: string | null;
  field: string | null;
  criterionId?: string;
}

/** Parses a stable provenance/review key back into the draft location it names. */
export function parseCanonicalKey(key: string): ParsedKey {
  for (const prefix of UNREPRESENTABLE_PREFIXES) {
    if (key.startsWith(prefix)) return { family: null, canonicalId: null, field: null };
  }
  for (const family of OBJECT_FAMILIES) {
    if (key.startsWith(`${family}:`)) {
      const rest = key.slice(family.length + 1);
      const dot = rest.indexOf(".");
      if (dot < 0) return { family, canonicalId: rest, field: null };
      return { family, canonicalId: rest.slice(0, dot), field: rest.slice(dot + 1) };
    }
  }
  if (key.startsWith("contract.criteria.")) {
    const rest = key.slice("contract.criteria.".length);
    const dot = rest.indexOf(".");
    if (dot < 0) return { family: null, canonicalId: null, field: null };
    return {
      family: "criterion",
      canonicalId: null,
      field: rest.slice(dot + 1),
      criterionId: rest.slice(0, dot),
    };
  }
  if (key.startsWith("contract.")) {
    return { family: "contract", canonicalId: null, field: key.slice("contract.".length) };
  }
  if (key.startsWith("transactionPrice.")) {
    return {
      family: "transactionPrice",
      canonicalId: null,
      field: key.slice("transactionPrice.".length),
    };
  }
  if (key.startsWith("draft.")) {
    return { family: "structural", canonicalId: null, field: key.slice("draft.".length) };
  }
  return { family: null, canonicalId: null, field: null };
}

function rowFor(draft: WorkflowDraft, family: ObjectFamily, id: string): unknown {
  switch (family) {
    case "promise":
      return draft.promises.find((row) => row.id === id);
    case "po":
      return draft.performanceObligations.find((row) => row.id === id);
    case "vc":
      return draft.variableConsiderationComponents.find((row) => row.id === id);
    case "modification":
      return draft.contractModifications.find((row) => row.id === id);
    case "billing":
      return draft.contractBalances.considerationEvents.find((row) => row.id === id);
    case "cash":
      return draft.contractBalances.cashCollections.find((row) => row.id === id);
  }
}

/**
 * The exact canonical value a field key names. `representable` is false when
 * the key names nothing ARC stores canonically — an advisory topic, say —
 * so silence is never mistaken for an edit.
 */
export function canonicalFieldValue(
  draft: WorkflowDraft,
  key: string,
): { representable: boolean; value: unknown } {
  const parsed = parseCanonicalKey(key);
  if (parsed.family === null || parsed.field === null) {
    return { representable: false, value: null };
  }
  if (parsed.family === "contract") {
    const contract = draft.contract as unknown as Record<string, unknown>;
    return { representable: parsed.field in contract, value: contract[parsed.field] ?? null };
  }
  if (parsed.family === "criterion") {
    const criteria = draft.contract.criteria as unknown as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const criterion = criteria[parsed.criterionId!];
    if (criterion === undefined) return { representable: true, value: null };
    return { representable: true, value: criterion[parsed.field] ?? null };
  }
  if (parsed.family === "transactionPrice") {
    if (parsed.field === "input") {
      return { representable: true, value: draft.transactionPriceInput };
    }
    if (parsed.field === "notes") {
      return { representable: true, value: draft.transactionPriceNotes };
    }
    return { representable: false, value: null };
  }
  if (parsed.family === "structural") {
    const record = draft as unknown as Record<string, unknown>;
    return { representable: parsed.field in record, value: record[parsed.field] ?? null };
  }

  const row = rowFor(draft, parsed.family, parsed.canonicalId!) as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) return { representable: true, value: null };
  return { representable: true, value: row[parsed.field] ?? null };
}

/** A deterministic marker for "the object this target names no longer exists". */
function absentMarker(key: string): string {
  return valueFingerprint({ absentCanonicalTarget: key });
}

/**
 * The complete material canonical conclusion a review target rests on, or null
 * when the target has no canonical representation at all.
 *
 * Object-scoped targets are fingerprinted against the SAME material subset the
 * merge engine uses for AI object identity, so the two definitions cannot
 * drift. A transaction-price target carries the whole price conclusion,
 * including whether the contract has variable consideration and what those
 * components say — display prose is deliberately excluded.
 */
export function canonicalReviewTargetFingerprint(
  draft: WorkflowDraft,
  targetKey: string,
): string | null {
  const parsed = parseCanonicalKey(targetKey);
  if (parsed.family === null) return null;

  if (OBJECT_FAMILIES.includes(parsed.family as ObjectFamily)) {
    return aiObjectFingerprint(draft, parsed.canonicalId!) ?? absentMarker(targetKey);
  }

  if (parsed.family === "transactionPrice") {
    return valueFingerprint({
      transactionPriceInput: draft.transactionPriceInput,
      hasVariableConsideration: draft.hasVariableConsideration,
      variableConsideration: draft.variableConsiderationComponents
        .map((row) => aiObjectFingerprint(draft, row.id) ?? row.id)
        .sort(),
    });
  }

  const { representable, value } = canonicalFieldValue(draft, targetKey);
  if (!representable) return null;
  return valueFingerprint({ targetKey, value });
}

/* -------------------------------------------------------------- interfaces */

export interface ReconcileAiEditInput {
  previousDraft: WorkflowDraft;
  nextDraft: WorkflowDraft;
  currentAiState: AiAnalysisState;
}

/**
 * An intent, never a database row. The pure layer authors no event id, no
 * timestamp and no actor identity — those are trusted persistence concerns.
 */
export interface EditReviewEventIntent {
  type: "yellow_affirmed" | "review_item_reopened";
  reviewItemId: string;
  targetKey: string;
  section: GuidanceReviewSection;
  severity: AiReviewSeverity;
  reviewFingerprint: string;
}

export interface ReconcileAiEditResult {
  aiState: AiAnalysisState;
  reviewEvents: EditReviewEventIntent[];
  /** True when anything in the sidecar actually moved. */
  changed: boolean;
}

/* ----------------------------------------------------------- red curing -- */

function isSupplied(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/**
 * The only red conditions an edit may clear are ones ARC can deterministically
 * prove cured with an existing predicate. Everything else stays red: an edit is
 * never accountant judgment, and judgment stays a deliberate Task 2 action.
 */
function redConditionCured(
  item: AiReviewItem,
  nextDraft: WorkflowDraft,
  previousDraft: WorkflowDraft,
): boolean {
  if (item.reasonCode === "missing_required_input") {
    const before = canonicalFieldValue(previousDraft, item.targetKey);
    const after = canonicalFieldValue(nextDraft, item.targetKey);
    if (!after.representable) return false;
    return !isSupplied(before.value) && isSupplied(after.value);
  }
  if (item.reasonCode === "missing_ssp") {
    const after = canonicalFieldValue(nextDraft, item.targetKey);
    if (!after.representable || typeof after.value !== "string") return false;
    const parsed = parseUsdToCents(after.value);
    return parsed.ok && parsed.cents > 0;
  }
  return false;
}

/* ------------------------------------------------------------ reconcile -- */

export function reconcileAiEdits(input: ReconcileAiEditInput): ReconcileAiEditResult {
  const previous = input.previousDraft;
  const next = input.nextDraft;
  const state = structuredClone(input.currentAiState);
  const events: EditReviewEventIntent[] = [];
  let changed = false;

  /* ----------------------------------------------------- field provenance */

  for (const [key, provenance] of Object.entries(state.fieldProvenance)) {
    if (provenance.state !== "ai_generated_untouched") continue;
    const before = canonicalFieldValue(previous, key);
    const after = canonicalFieldValue(next, key);
    if (!before.representable || !after.representable) continue;
    if (valueFingerprint(before.value) === valueFingerprint(after.value)) continue;
    // The AI baseline fingerprint is deliberately NOT replaced: it is how a
    // later re-analysis knows the accountant changed this field.
    state.fieldProvenance[key] = { ...provenance, state: "ai_generated_user_edited" };
    changed = true;
  }

  /* ---------------------------------------------------- object provenance */

  const tombstones = new Set(state.tombstones);
  for (const [semanticKey, provenance] of Object.entries(state.objectProvenance)) {
    const before = aiObjectFingerprint(previous, provenance.canonicalId);
    const after = aiObjectFingerprint(next, provenance.canonicalId);
    if (before !== null && after === null) {
      tombstones.add(semanticKey);
      delete state.objectProvenance[semanticKey];
      changed = true;
      continue;
    }
    if (before === null || after === null || before === after) continue;
    if (provenance.userModified && provenance.state === "ai_generated_user_edited") continue;
    state.objectProvenance[semanticKey] = {
      ...provenance,
      state:
        provenance.state === "ai_generated_untouched"
          ? "ai_generated_user_edited"
          : provenance.state,
      userModified: true,
    };
    changed = true;
  }
  const sortedTombstones = [...tombstones].sort();
  if (sortedTombstones.join("\u0000") !== state.tombstones.join("\u0000")) {
    state.tombstones = sortedTombstones;
  }

  /* -------------------------------------------------------- review items */

  const reviewItems: AiReviewItem[] = [];
  for (const item of state.reviewItems) {
    const before = canonicalReviewTargetFingerprint(previous, item.targetKey);
    const after = canonicalReviewTargetFingerprint(next, item.targetKey);
    const materialChanged = before !== null && after !== null && before !== after;

    if (item.state === "resolved") {
      if (!materialChanged) {
        reviewItems.push(item);
        continue;
      }
      // The prior resolution stays in immutable event history; the current
      // item returns to the severity it was raised at.
      reviewItems.push({
        ...item,
        state: item.severity,
        resolution: null,
        affirmedAt: null,
        affirmedMethod: null,
      });
      events.push({
        type: "review_item_reopened",
        reviewItemId: item.id,
        targetKey: item.targetKey,
        section: item.section,
        severity: item.severity,
        reviewFingerprint: item.reviewFingerprint,
      });
      changed = true;
      continue;
    }

    if (item.severity === "red") {
      if (redConditionCured(item, next, previous)) {
        changed = true;
        continue; // deterministically cured: the issue no longer exists
      }
      reviewItems.push(item);
      continue;
    }

    if (!materialChanged) {
      reviewItems.push(item);
      continue;
    }

    // A direct edit of the exact reviewed conclusion IS the accountant's
    // review of it. The method is server-derived; the browser cannot ask for it.
    reviewItems.push(item);
    events.push({
      type: "yellow_affirmed",
      reviewItemId: item.id,
      targetKey: item.targetKey,
      section: item.section,
      severity: "yellow",
      reviewFingerprint: item.reviewFingerprint,
    });
    changed = true;
  }
  state.reviewItems = reviewItems;

  return { aiState: state, reviewEvents: events, changed };
}

/**
 * Stamps the edit-driven yellow resolutions the pure pass identified. The
 * caller supplies the authoritative server timestamp; nothing here reads a
 * clock of its own.
 */
export function applyEditReviewIntents(
  aiState: AiAnalysisState,
  intents: readonly EditReviewEventIntent[],
  nowIso: string,
): AiAnalysisState {
  const affirmed = new Map(
    intents
      .filter((intent) => intent.type === "yellow_affirmed")
      .map((intent) => [intent.reviewItemId, intent] as const),
  );
  if (affirmed.size === 0) return aiState;

  return {
    ...aiState,
    reviewItems: aiState.reviewItems.map((item) => {
      const intent = affirmed.get(item.id);
      if (intent === undefined) return item;
      return {
        ...item,
        state: "resolved",
        resolution: {
          kind: "affirmed",
          at: nowIso,
          method: "edited",
          reviewFingerprint: intent.reviewFingerprint,
        },
        affirmedAt: nowIso,
        affirmedMethod: "edited",
      };
    }),
  };
}
