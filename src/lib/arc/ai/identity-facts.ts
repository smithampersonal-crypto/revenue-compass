/**
 * Phase 9G-R3 / Phase L — Tranche 2: pure structural identity FACTS and evidence sufficiency.
 *
 * This module answers exactly one question: *is it admissible that these two sides are the same
 * economic object?* It never decides topology (that is `identity-graph.ts`), never touches the
 * canonical draft, and never persists anything.
 *
 * Frozen rules (Design Rev 3 + Amendment 3A):
 *   - Accounting/model judgments (promise type, distinctness, satisfaction pattern, recognition
 *     method, series conclusion) are DIAGNOSTIC ONLY. They are never a hard gate and never
 *     sufficient identity by themselves.
 *   - Only objective contractual incompatibility is a hard contradiction. A different document id
 *     is NOT a contradiction.
 *   - Source evidence: exact normalized bounded-excerpt equality or strict normalized containment
 *     is STRONG. Same document/page overlap and partial lexical overlap are CORROBORATION ONLY.
 *     There is no percentage or fuzzy-similarity threshold anywhere in this file.
 *   - Cross-document continuity requires independent economic corroboration.
 *
 * Bounded excerpts are compared transiently. They arrive on `CitationSpan` values that the caller
 * derives from the last successful immutable `AiContractAnalysis`; the canonical draft does not
 * persist them, and this module never writes them anywhere.
 */

import type { AlignmentObjectKind, CitationSpan } from "./alignment-types";

/* --------------------------------------------------------------- fact model */

export interface IdentityFacts {
  objectKind: AlignmentObjectKind;
  /** Proposal semantic key or canonical id. Display/diagnostic only — never an identity signal. */
  ref: string;
  /** Objective contractual facts, normalized. */
  contractual: Readonly<Record<string, string>>;
  /** Contractual keys whose conflicting values are a hard contradiction. */
  decisiveKeys: readonly string[];
  /** Objective quantitative measures extracted from contractual prose (rates, quantities, bands). */
  measures: readonly string[];
  /** Accounting/model judgments. Diagnostics and review only — never identity. */
  judgments: Readonly<Record<string, string>>;
  /** ARC-owned citation spans. Provider anchor ids are never carried here. */
  citations: readonly CitationSpan[];
  /** Resolved canonical graph relationships (member promise ids, target obligation id, ...). */
  relations: readonly string[];
  /** Normalized description. Exact equality is strong; partial overlap is corroboration only. */
  normalizedDescription: string | null;
}

export interface IncumbentIdentityFacts extends IdentityFacts {
  canonicalId: string;
}

export type EvidenceCode =
  | "hard_contradiction_object_kind"
  | "hard_contradiction_decisive_fact"
  | "hard_contradiction_graph_disjoint"
  | "strong_excerpt_equality"
  | "strong_excerpt_containment"
  | "strong_decisive_fact_agreement"
  | "strong_description_equality"
  | "strong_shared_contractual_measure"
  | "corroborating_page_overlap"
  | "corroborating_shared_relation"
  | "corroborating_lexical_overlap"
  | "diagnostic_judgment_agreement"
  | "diagnostic_judgment_drift";

/**
 * Evidence classes. Source evidence can NEVER corroborate source evidence: an exact excerpt and the
 * page overlap implied by that very citation are one signal, not two.
 */
export type EvidenceClass =
  | "source"
  | "economic_contractual"
  | "graph"
  | "model_description"
  | "judgment";

export const EVIDENCE_CLASS_BY_CODE: Readonly<Record<EvidenceCode, EvidenceClass>> = {
  hard_contradiction_object_kind: "economic_contractual",
  hard_contradiction_decisive_fact: "economic_contractual",
  hard_contradiction_graph_disjoint: "graph",
  strong_excerpt_equality: "source",
  strong_excerpt_containment: "source",
  strong_decisive_fact_agreement: "economic_contractual",
  strong_description_equality: "model_description",
  strong_shared_contractual_measure: "economic_contractual",
  corroborating_page_overlap: "source",
  corroborating_shared_relation: "graph",
  corroborating_lexical_overlap: "model_description",
  diagnostic_judgment_agreement: "judgment",
  diagnostic_judgment_drift: "judgment",
};

export function evidenceClassOf(code: EvidenceCode): EvidenceClass {
  return EVIDENCE_CLASS_BY_CODE[code];
}

/** A strong signal together with the concrete anchor it rests on (used to detect indistinguishable evidence). */
export interface EvidenceAnchor {
  code: EvidenceCode;
  anchor: string;
}

export interface EvidenceAssessment {
  admissible: boolean;
  contradictions: readonly EvidenceCode[];
  strong: readonly EvidenceAnchor[];
  corroborating: readonly EvidenceCode[];
  diagnostics: readonly EvidenceCode[];
  /** Sorted union of every code raised, for review/diagnostic surfaces. */
  codes: readonly EvidenceCode[];
  /** Sorted distinct classes of the STRONG signals. */
  strongClasses: readonly EvidenceClass[];
  /** Sorted distinct classes of the corroborating signals. */
  corroboratingClasses: readonly EvidenceClass[];
  /** Deterministic signature of the strong anchors; equal signatures mean indistinguishable evidence. */
  anchorSignature: string;
  sharesDocument: boolean;
}

/* ------------------------------------------------------------ normalization */

/** Collapses case, punctuation and whitespace. Used for both descriptions and bounded excerpts. */
export function normalizeForComparison(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9%$.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A containment claim below this length is textually trivial, not evidence. Not a similarity threshold. */
const MINIMUM_MEANINGFUL_EXCERPT_LENGTH = 24;

const MEASURE_UNITS = new Set([
  "sample",
  "samples",
  "hour",
  "hours",
  "site",
  "sites",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "seat",
  "seats",
  "package",
  "packages",
  "terabyte",
  "terabytes",
]);

function singular(unit: string): string {
  return unit.endsWith("s") ? unit.slice(0, -1) : unit;
}

/**
 * Extracts objective contractual measures — currency amounts, percentages and quantity/unit pairs.
 * These are contractual facts stated in the text, not lexical similarity.
 */
export function extractContractualMeasures(
  ...texts: readonly (string | null | undefined)[]
): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (text === null || text === undefined || text === "") continue;
    const haystack = text.toLowerCase();

    for (const match of haystack.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)) {
      found.add(`usd:${Number(match[1]!.replace(/,/g, ""))}`);
    }
    for (const match of haystack.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?%/g)) {
      found.add(`pct:${Number(match[1]!.replace(/,/g, ""))}`);
    }
    for (const match of haystack.matchAll(/(\d[\d,]*(?:\.\d+)?)[\s-]+([a-z]+)/g)) {
      const unit = match[2]!;
      if (!MEASURE_UNITS.has(unit)) continue;
      found.add(`qty:${Number(match[1]!.replace(/,/g, ""))} ${singular(unit)}`);
    }
  }
  return [...found].sort();
}

function normalizedFactValue(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = normalizeForComparison(String(value));
  return text === "" ? null : text;
}

function compact(
  record: Readonly<Record<string, string | number | null | undefined>> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(record ?? {}).sort()) {
    const value = normalizedFactValue(record?.[key]);
    if (value !== null) result[key] = value;
  }
  return result;
}

/* -------------------------------------------------------------- fact builders */

export interface IdentityFactsInput {
  objectKind: AlignmentObjectKind;
  ref: string;
  contractual?: Readonly<Record<string, string | number | null | undefined>> | undefined;
  decisiveKeys?: readonly string[] | undefined;
  measureSources?: readonly (string | null | undefined)[] | undefined;
  judgments?: Readonly<Record<string, string | number | null | undefined>> | undefined;
  citations?: readonly CitationSpan[] | undefined;
  relations?: readonly (string | null | undefined)[] | undefined;
  description?: string | null | undefined;
}

export function buildIdentityFacts(input: IdentityFactsInput): IdentityFacts {
  const description = normalizeForComparison(input.description);
  return {
    objectKind: input.objectKind,
    ref: input.ref,
    contractual: compact(input.contractual),
    decisiveKeys: [...(input.decisiveKeys ?? [])].sort(),
    measures: extractContractualMeasures(input.description, ...(input.measureSources ?? [])),
    judgments: compact(input.judgments),
    citations: (input.citations ?? []).map((citation) => ({ ...citation })),
    relations: [
      ...new Set((input.relations ?? []).filter((id): id is string => Boolean(id))),
    ].sort(),
    normalizedDescription: description === "" ? null : description,
  };
}

/** Attaches a canonical id to a fact set. Canonical identity is ARC-owned, never model-owned. */
export function asIncumbent(facts: IdentityFacts, canonicalId: string): IncumbentIdentityFacts {
  return { ...facts, canonicalId };
}

/** True when this side carries prior AI-originated bounded excerpt evidence (from the prior analysis). */
export function hasPriorSourceEvidence(facts: IdentityFacts): boolean {
  return facts.citations.some((citation) => (citation.normalizedExcerpt ?? "").trim().length > 0);
}

export interface PromiseIdentitySource {
  semanticKey: string;
  promiseType?: string | null;
  description?: string | null;
  distinctConclusion?: string | null;
  citations?: readonly CitationSpan[];
}

export function promiseIdentityFacts(source: PromiseIdentitySource): IdentityFacts {
  return buildIdentityFacts({
    objectKind: "promise",
    ref: source.semanticKey,
    judgments: {
      promiseType: source.promiseType,
      distinctConclusion: source.distinctConclusion,
    },
    citations: source.citations,
    description: source.description,
  });
}

export interface PerformanceObligationIdentitySource {
  semanticKey: string;
  description?: string | null;
  satisfactionPattern?: string | null;
  citations?: readonly CitationSpan[];
  /** Canonical promise ids this obligation groups, already resolved by the caller. */
  memberCanonicalIds?: readonly string[];
}

export function performanceObligationIdentityFacts(
  source: PerformanceObligationIdentitySource,
): IdentityFacts {
  return buildIdentityFacts({
    objectKind: "performance_obligation",
    ref: source.semanticKey,
    judgments: { satisfactionPattern: source.satisfactionPattern },
    citations: source.citations,
    relations: source.memberCanonicalIds,
    description: source.description,
  });
}

export interface VariableConsiderationIdentitySource {
  semanticKey: string;
  type?: string | null;
  description?: string | null;
  unitDescription?: string | null;
  billingFrequency?: string | null;
  trigger?: string | null;
  contractualRateOrAmountInput?: string | null;
  /** Canonical target obligation id, already resolved by the caller. */
  targetCanonicalId?: string | null;
  citations?: readonly CitationSpan[];
}

export function variableConsiderationIdentityFacts(
  source: VariableConsiderationIdentitySource,
): IdentityFacts {
  return buildIdentityFacts({
    objectKind: "variable_consideration",
    ref: source.semanticKey,
    contractual: {
      rate: source.contractualRateOrAmountInput,
      billingFrequency: source.billingFrequency,
    },
    decisiveKeys: ["rate"],
    measureSources: [source.unitDescription, source.trigger],
    judgments: { type: source.type },
    citations: source.citations,
    relations: [source.targetCanonicalId],
    description: source.description,
  });
}

export interface BillingTermIdentitySource {
  semanticKey: string;
  description?: string | null;
  frequency?: string | null;
  billingTiming?: string | null;
  invoiceTrigger?: string | null;
  paymentTermsDays?: number | null;
  amountOrRateInput?: string | null;
  citations?: readonly CitationSpan[];
  objectKind?: Extract<
    AlignmentObjectKind,
    "billing_term" | "consideration_event" | "projected_collection"
  >;
}

export function billingTermIdentityFacts(source: BillingTermIdentitySource): IdentityFacts {
  return buildIdentityFacts({
    objectKind: source.objectKind ?? "billing_term",
    ref: source.semanticKey,
    contractual: {
      amount: source.amountOrRateInput,
      frequency: source.frequency,
      billingTiming: source.billingTiming,
      paymentTermsDays: source.paymentTermsDays,
    },
    decisiveKeys: ["amount"],
    measureSources: [source.invoiceTrigger],
    citations: source.citations,
    description: source.description,
  });
}

/* ------------------------------------------------------------ evidence rules */

function excerptsOf(facts: IdentityFacts): string[] {
  return facts.citations
    .map((citation) => normalizeForComparison(citation.normalizedExcerpt))
    .filter((excerpt) => excerpt.length >= MINIMUM_MEANINGFUL_EXCERPT_LENGTH)
    .sort();
}

function documentsOf(facts: IdentityFacts): Set<string> {
  return new Set(facts.citations.map((citation) => citation.documentId));
}

function pageKeysOf(facts: IdentityFacts): Set<string> {
  const keys = new Set<string>();
  for (const citation of facts.citations) {
    for (let page = citation.pageStart; page <= citation.pageEnd; page += 1) {
      keys.add(`${citation.documentId}#${page}`);
    }
  }
  return keys;
}

function intersect<T>(left: Iterable<T>, right: Set<T>): T[] {
  const result: T[] = [];
  for (const value of left) if (right.has(value)) result.push(value);
  return result;
}

function significantTokens(value: string | null): Set<string> {
  if (value === null) return new Set();
  return new Set(value.split(" ").filter((token) => token.length > 6));
}

/**
 * Evaluates whether two fact sets may be the same economic object.
 *
 * Sufficiency (no weighted score, no threshold):
 *   - Any hard contradiction rejects outright.
 *   - At least one STRONG signal is required; corroboration alone never identifies anything.
 *   - Same-document: one strong signal plus a source/graph corroborator, or two distinct strong
 *     signals.
 *   - Cross-document: two distinct strong signals, at least one of which is an objective
 *     contractual agreement (decisive fact or shared measure).
 */
export function assessIdentityEvidence(
  left: IdentityFacts,
  right: IdentityFacts,
): EvidenceAssessment {
  const contradictions: EvidenceCode[] = [];
  const strong: EvidenceAnchor[] = [];
  const corroborating: EvidenceCode[] = [];
  const diagnostics: EvidenceCode[] = [];

  if (left.objectKind !== right.objectKind) {
    contradictions.push("hard_contradiction_object_kind");
  }

  // Objective contractual incompatibility — the only hard contradiction class.
  const decisiveKeys = [...new Set([...left.decisiveKeys, ...right.decisiveKeys])].sort();
  for (const key of decisiveKeys) {
    const a = left.contractual[key];
    const b = right.contractual[key];
    if (a === undefined || b === undefined) continue;
    if (a !== b) contradictions.push("hard_contradiction_decisive_fact");
    else strong.push({ code: "strong_decisive_fact_agreement", anchor: `fact:${key}=${a}` });
  }

  const sharedRelations = intersect(left.relations, new Set(right.relations));
  if (left.relations.length > 0 && right.relations.length > 0) {
    if (sharedRelations.length === 0) contradictions.push("hard_contradiction_graph_disjoint");
    else corroborating.push("corroborating_shared_relation");
  }

  // Source evidence: bounded excerpt equality / strict containment only.
  const leftExcerpts = excerptsOf(left);
  const rightExcerpts = excerptsOf(right);
  for (const a of leftExcerpts) {
    for (const b of rightExcerpts) {
      if (a === b) {
        strong.push({ code: "strong_excerpt_equality", anchor: `excerpt:${a}` });
        continue;
      }
      if (a.includes(b) || b.includes(a)) {
        const contained = a.length < b.length ? a : b;
        strong.push({ code: "strong_excerpt_containment", anchor: `excerpt:${contained}` });
      }
    }
  }

  // Exact normalized description equality is strong; partial overlap is corroboration only.
  if (
    left.normalizedDescription !== null &&
    left.normalizedDescription === right.normalizedDescription
  ) {
    strong.push({
      code: "strong_description_equality",
      anchor: `description:${left.normalizedDescription}`,
    });
  } else {
    const shared = intersect(
      significantTokens(left.normalizedDescription),
      significantTokens(right.normalizedDescription),
    );
    if (shared.length > 0) corroborating.push("corroborating_lexical_overlap");
  }

  for (const measure of intersect(left.measures, new Set(right.measures))) {
    strong.push({ code: "strong_shared_contractual_measure", anchor: `measure:${measure}` });
  }

  const sharesDocument = intersect(documentsOf(left), documentsOf(right)).length > 0;
  if (intersect(pageKeysOf(left), pageKeysOf(right)).length > 0) {
    corroborating.push("corroborating_page_overlap");
  }

  // Judgments: recorded for review, never gating.
  const judgmentKeys = [
    ...new Set([...Object.keys(left.judgments), ...Object.keys(right.judgments)]),
  ].sort();
  for (const key of judgmentKeys) {
    const a = left.judgments[key];
    const b = right.judgments[key];
    if (a === undefined || b === undefined) continue;
    diagnostics.push(a === b ? "diagnostic_judgment_agreement" : "diagnostic_judgment_drift");
  }

  const distinctStrongCodes = new Set(strong.map((entry) => entry.code));
  const hasSourceOrGraphCorroboration =
    corroborating.includes("corroborating_page_overlap") ||
    corroborating.includes("corroborating_shared_relation");
  const hasObjectiveContractualAgreement =
    distinctStrongCodes.has("strong_decisive_fact_agreement") ||
    distinctStrongCodes.has("strong_shared_contractual_measure");

  let admissible = false;
  if (contradictions.length === 0 && strong.length > 0) {
    admissible = sharesDocument
      ? hasSourceOrGraphCorroboration || distinctStrongCodes.size >= 2
      : distinctStrongCodes.size >= 2 && hasObjectiveContractualAgreement;
  }

  const uniqueSorted = (codes: readonly EvidenceCode[]): EvidenceCode[] =>
    [...new Set(codes)].sort();
  const strongSorted = [...strong].sort((a, b) =>
    `${a.code}${a.anchor}`.localeCompare(`${b.code}${b.anchor}`),
  );

  return {
    admissible,
    contradictions: uniqueSorted(contradictions),
    strong: strongSorted,
    corroborating: uniqueSorted(corroborating),
    diagnostics: uniqueSorted(diagnostics),
    codes: uniqueSorted([
      ...contradictions,
      ...strongSorted.map((entry) => entry.code),
      ...corroborating,
      ...diagnostics,
    ]),
    anchorSignature: strongSorted.map((entry) => `${entry.code}|${entry.anchor}`).join("||"),
    sharesDocument,
  };
}
