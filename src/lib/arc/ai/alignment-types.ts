/**
 * Pure structural-identity types for cross-run reconciliation (Phase 9G-R3 / Phase L).
 *
 * These types are deliberately persistence-free:
 * - `ProposalAlignment` is ephemeral reconciliation topology produced during a single
 *   apply/merge pass. It is NEVER added to `AiAnalysisState`, state serialization, or any
 *   Supabase column. Durable conclusions persist through existing object provenance
 *   (1:1 exact-match aliases) and existing review items.
 * - `CitationSpan` is an ARC-owned citation span. Provider anchor ids are never carried
 *   here, and bounded excerpts are compared transiently only.
 */

/** ARC-owned citation span. Provider anchor ids are intentionally absent. */
export interface CitationSpan {
  documentId: string;
  pageStart: number;
  pageEnd: number;
  /** Bounded, already-validated excerpt normalized for transient comparison. */
  normalizedExcerpt?: string;
}

/** Canonical object kinds participating in structural identity reconciliation. */
export type AlignmentObjectKind =
  | "promise"
  | "performance_obligation"
  | "variable_consideration"
  | "billing_term"
  | "consideration_event"
  | "projected_collection";

/** Frozen alignment relation vocabulary. */
export type ProposalAlignmentRelation =
  "exact" | "subsumes" | "split_from" | "ambiguous" | "unmatched";

/**
 * Ephemeral result of reconciling one AI proposal against canonical structure.
 * `canonicalIds` is empty for `unmatched`, exactly one for `exact`, and may hold several
 * for `subsumes` / `split_from` / `ambiguous`.
 */
export interface ProposalAlignment {
  objectKind: AlignmentObjectKind;
  /** Model-supplied semantic key: display/diagnostic metadata only, never identity. */
  proposalKey: string;
  canonicalIds: readonly string[];
  relation: ProposalAlignmentRelation;
  /** Pure, non-persisted diagnostics consumed by later graph processing and review construction. */
  diagnostics?: {
    /** Canonical ids that were plausible but not uniquely supported. */
    contendingCanonicalIds?: readonly string[];
    /** Deterministic reason codes recorded by the sufficiency evaluation. */
    evidenceCodes?: readonly string[];
    /** Structural notes (never raw source corpus). */
    notes?: readonly string[];
  };
}
