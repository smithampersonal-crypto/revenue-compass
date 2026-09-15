/**
 * Browser-safe Guidance Registry types.
 *
 * The Master Guidance workbook (`guidance/Revenue_Compass_ASC606_Master_Library.xlsx`)
 * is the human-controlled accounting source. It is compiled deterministically
 * into `registry.generated.ts`; runtime code only ever reads the compiled
 * registry plus the explicit machine policy in `policy.ts`.
 *
 * Nothing in this module reads a filesystem, parses Excel, or interprets the
 * accounting prose. Prose fields are carried through verbatim for later stages.
 */

export type GuidanceReviewSection =
  | "step_1"
  | "step_2"
  | "step_3"
  | "step_4"
  | "step_5"
  | "additional_topics";

export type GuidanceEngineSupport = "full" | "partial" | "advisory_only" | "not_supported";

export type GuidanceFinalizationImpact = "block" | "warn" | "none";

/** One Approved guidance card, compiled verbatim from the workbook. */
export interface GuidanceCard {
  id: number;
  topic: string;
  subtopic: string;
  primaryAscReference: string;
  relatedAscReferences: string;
  ruleSummary: string;
  decisionCriteria: string;
  factsRequired: string;
  importantNuances: string;
  whenRelevant: string;
  aiMayPropose: string;
  accountantMustApprove: string;
  engineBehavior: string;
  interpretiveSource: string;
  sourceUrls: string[];
  retrievalTags: string[];
  status: "Approved";
  /** ISO calendar date (YYYY-MM-DD). */
  lastReviewed: string;
  /** SHA-256 over the canonical serialization of every field above. */
  contentHash: string;
}

/**
 * ARC machine policy for a card. This is deliberately NOT derived from the
 * workbook prose: enforcement decisions are explicit, reviewable TypeScript.
 */
export interface GuidanceMachinePolicy {
  core: boolean;
  proposalDomains: readonly string[];
  reviewSection: GuidanceReviewSection;
  engineSupport: GuidanceEngineSupport;
  finalizationImpact: GuidanceFinalizationImpact;
  enginePolicyCodes: readonly string[];
  relatedGuidanceIds: readonly number[];
}

/** Why a card is in a Guidance Pack. */
export interface GuidanceInclusion {
  cardId: number;
  reason: "core" | "retrieved" | "dependency";
  matchedSignals: string[];
}

export interface GuidancePack {
  registryHash: string;
  cards: GuidanceCard[];
  inclusions: GuidanceInclusion[];
}
