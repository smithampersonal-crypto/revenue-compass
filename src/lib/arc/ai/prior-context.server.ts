/**
 * Phase 9F Task 12 — protected prior finalized accounting context.
 *
 * An amendment analysis has to know what the previous finalized revision
 * concluded. That history is ARC's own trusted output, so it is supplied as
 * compact FACTS in the authenticated ARC context block — never as evidence and
 * never as something the model can rewrite. Old AI prose, old prompts, old
 * model responses and raw PDF text are never accounting authority here.
 *
 * The builder is pure; only `createPriorRevisionReader` touches the database.
 */

import type { PriorAccountingContext } from "./types";

/* ---------------------------------------------------------------- reading */

export interface PriorRevisionRecord {
  id: string;
  analysisId: string;
  status: string;
  canonicalInputs: unknown;
  engineOutputs: unknown;
  reconciliationSnapshot: unknown;
  schemaVersion: string;
  finalizedAt: string | null;
}

export interface AmendmentParent {
  analysisId: string;
  supersedesRevisionId: string | null;
}

export interface PriorRevisionReader {
  /** The editable revision itself: which analysis it belongs to, what it supersedes. */
  readAmendmentParent(revisionId: string): Promise<AmendmentParent | null>;
  readHistoricalRevision(revisionId: string): Promise<PriorRevisionRecord | null>;
}

/* ----------------------------------------------------------------- pure -- */

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry) => record(entry) === entry) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function centsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function dateOnly(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1]! : null;
}

/**
 * Builds the compact accounting facts an amendment needs. Deliberately bounded:
 * no monthly revenue-schedule rows and no journal entries are ever included.
 */
export function buildPriorAccountingContext(source: PriorRevisionRecord): PriorAccountingContext {
  const draft = record(source.canonicalInputs);
  const engine = record(source.engineOutputs);
  const workflow = record(engine["workflow"]);
  const reconciliation = record(source.reconciliationSnapshot);
  const totals = record(reconciliation["totals"]);

  const pos = list(draft["performanceObligations"]).map((po) => ({
    id: po["id"] ?? null,
    seq: po["seq"] ?? null,
    name: po["name"] ?? null,
    kind: po["kind"] ?? null,
    classification: po["classification"] ?? null,
    sspInput: po["sspInput"] ?? null,
    sspBasis: po["sspBasis"] ?? null,
    recognitionMethod: po["recognitionMethod"] ?? null,
    serviceStart: po["serviceStart"] ?? null,
    serviceEnd: po["serviceEnd"] ?? null,
    recognitionDate: po["recognitionDate"] ?? null,
  }));

  const allocation = list(workflow["allocation"]).map((row) => ({
    poId: row["poId"] ?? null,
    name: row["name"] ?? null,
    sspCents: row["sspCents"] ?? null,
    allocatedCents: row["allocatedCents"] ?? null,
  }));

  const recognitionSummary = pos.map((po) => ({
    poId: po.id,
    recognitionMethod: po.recognitionMethod,
    serviceStart: po.serviceStart,
    serviceEnd: po.serviceEnd,
    recognitionDate: po.recognitionDate,
  }));

  const modificationSummary = list(draft["contractModifications"]).map((mod) => ({
    id: mod["id"] ?? null,
    seq: mod["seq"] ?? null,
    modificationDate: mod["modificationDate"] ?? null,
    classification: mod["classification"] ?? null,
    additionalConsiderationInput: mod["additionalConsiderationInput"] ?? null,
  }));

  const price = centsOf(totals["transactionPriceCents"]);
  const revenue = centsOf(totals["revenueCents"]);
  const remaining = price !== null && revenue !== null ? dollars(price - revenue) : null;

  return {
    kind: "prior_finalized",
    sourceRevisionId: source.id,
    schemaVersion: source.schemaVersion,
    finalizedAt: source.finalizedAt,
    performanceObligations: pos,
    allocation,
    transactionPriceInput: text(draft["transactionPriceInput"]),
    recognitionSummary,
    modificationSummary,
    revenueRecognizedThroughDate: dateOnly(source.finalizedAt),
    remainingConsiderationInput: remaining,
  };
}

/**
 * Resolves the prior finalized context for an editable revision.
 *
 * Returns null for revision 1 (nothing superseded). A superseded revision that
 * belongs to a different analysis, or that is not finalized/superseded history,
 * is refused outright rather than silently used.
 */
export async function loadPriorAccountingContext(
  reader: PriorRevisionReader,
  revisionId: string,
): Promise<PriorAccountingContext | null> {
  const parent = await reader.readAmendmentParent(revisionId);
  if (!parent || parent.supersedesRevisionId === null) return null;

  const prior = await reader.readHistoricalRevision(parent.supersedesRevisionId);
  if (!prior) return null;
  if (prior.analysisId !== parent.analysisId) {
    throw new Error("The prior finalized analysis could not be verified.");
  }
  if (prior.status !== "finalized" && prior.status !== "superseded") return null;

  return buildPriorAccountingContext(prior);
}

/* --------------------------------------------------------------- database */

export async function createPriorRevisionReader(): Promise<PriorRevisionReader> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return {
    readAmendmentParent: async (revisionId) => {
      const { data, error } = await supabaseAdmin
        .from("analysis_revisions")
        .select("analysis_id, supersedes_revision_id")
        .eq("id", revisionId)
        .maybeSingle();
      if (error) throw new Error("The prior finalized analysis could not be read.");
      if (!data) return null;
      return {
        analysisId: data.analysis_id,
        supersedesRevisionId: data.supersedes_revision_id,
      };
    },

    readHistoricalRevision: async (revisionId) => {
      const { data, error } = await supabaseAdmin
        .from("analysis_revisions")
        .select(
          "id, analysis_id, status, canonical_inputs, engine_outputs, reconciliation_snapshot, schema_version, finalized_at",
        )
        .eq("id", revisionId)
        .maybeSingle();
      if (error) throw new Error("The prior finalized analysis could not be read.");
      if (!data) return null;
      return {
        id: data.id,
        analysisId: data.analysis_id,
        status: data.status,
        canonicalInputs: data.canonical_inputs,
        engineOutputs: data.engine_outputs,
        reconciliationSnapshot: data.reconciliation_snapshot,
        schemaVersion: data.schema_version,
        finalizedAt: data.finalized_at,
      };
    },
  };
}
