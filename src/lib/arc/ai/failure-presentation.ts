/**
 * Phase 9G — Task 3. ARC's deterministic failure-presentation registry.
 *
 * Every user-facing word about a failed AI run is written here, in ARC source
 * code, and selected by an explicit allowlist from trusted persisted lifecycle
 * facts: the recorded failure category, the recorded failure code, whether a
 * valid prior AI analysis exists and whether the provider-start boundary was
 * crossed.
 *
 * The model never writes user-facing copy. A persisted string — `safe_message`
 * included — is never reflected to the browser, because a string that was safe
 * when it was written is not evidence that it is safe to display forever. An
 * unknown, malformed or newly introduced code falls back to the generic
 * unexpected-application presentation rather than leaking itself.
 *
 * Pure and browser-safe: no persistence, no provider, no I/O.
 */

export type AiFailurePresentationCategory =
  | "document_preparation"
  | "ai_service"
  | "arc_validation"
  | "workspace_conflict"
  | "unexpected_application"
  /** Not a failure: ARC deliberately declined to apply a structurally unsafe result. */
  | "structurally_declined"
  /** Not a failure of the system: an expected availability condition. */
  | "allowance_exhausted";

export interface AiFailurePresentation {
  category: AiFailurePresentationCategory;
  headline: string;
  whatHappened: string;
  impact: string;
  whatYouCanDo: string;
  allowance: string;
}

/** Trusted persisted lifecycle facts. Never browser-supplied. */
export interface AiFailureFacts {
  /** Persisted `failure_category`, as written by the orchestrator. */
  failureCategory: string | null;
  /** Persisted `failure_code`, as written by the orchestrator. */
  failureCode: string | null;
  /** Authoritative: a prior successful run exists for this scope. */
  hadPriorSuccessfulAnalysis: boolean;
  /** Authoritative: the provider-start boundary was crossed for this run. */
  allowanceConsumed: boolean;
}

export const AI_FAILURE_HEADLINE_FIRST_RUN = "AI analysis failed · Existing analysis unchanged";
export const AI_FAILURE_HEADLINE_REANALYSIS = "Re-analysis failed · Previous analysis preserved";
export const AI_ALLOWANCE_HEADLINE = "AI analysis not run · No analyses remaining";

const ALLOWANCE_NOT_USED = "No AI allowance was used.";
const ALLOWANCE_USED = "This attempt used one AI analysis from your allowance.";

const IMPACT_FIRST_RUN = "Your existing analysis was not changed.";
const IMPACT_REANALYSIS = "Your previous AI analysis and your current workspace were preserved.";

/**
 * The allowlist. A code that is not named here is unknown by definition, and
 * an unknown code is presented as an unexpected application failure.
 */
const CATEGORY_BY_CODE: Readonly<Record<string, Record<string, AiFailurePresentationCategory>>> = {
  preflight: {
    preflight_failed: "document_preparation",
    no_sources: "document_preparation",
    unreadable_source: "document_preparation",
    storage_unavailable: "document_preparation",
    combined_bytes_exceeded: "document_preparation",
    input_tokens_exceeded: "document_preparation",
    sources_changed: "workspace_conflict",
    reanalysis_source_changed: "structurally_declined",
    allowance_exhausted: "allowance_exhausted",
  },
  api: {
    authentication_or_configuration: "ai_service",
    model_access: "ai_service",
    request_validation: "ai_service",
    token_limit: "ai_service",
    api_failure: "ai_service",
  },
  response: {
    structured_output_parse_failure: "arc_validation",
    response_invalid: "arc_validation",
    citation_anchor_failure: "arc_validation",
    citation_validation_failure: "arc_validation",
  },
  application: {
    apply_conflict: "workspace_conflict",
    apply_failed: "unexpected_application",
    merge_failed: "unexpected_application",
    merged_draft_invalid: "unexpected_application",
    reanalysis_declined: "structurally_declined",
  },
};

interface CategoryCopy {
  whatHappened: string;
  extraImpact?: string;
  whatYouCanDo: string;
}

const COPY: Readonly<Record<AiFailurePresentationCategory, CategoryCopy>> = {
  document_preparation: {
    whatHappened: "ARC could not prepare the selected documents for AI analysis.",
    whatYouCanDo:
      "Check the documents you selected — that each one opens correctly and that the selection is not unusually large — then run the analysis again.",
  },
  ai_service: {
    whatHappened: "The AI service could not complete this analysis.",
    whatYouCanDo:
      "Try the analysis again in a few minutes. You can continue working manually in the meantime.",
  },
  arc_validation: {
    whatHappened: "ARC received an AI response, but it did not pass ARC's validation checks.",
    extraImpact: "The unvalidated AI response was not applied to your analysis.",
    whatYouCanDo:
      "Run the analysis again. If it keeps failing this way, continue manually — ARC's own calculations are unaffected.",
  },
  workspace_conflict: {
    whatHappened: "The workspace changed before ARC could safely apply the analysis.",
    whatYouCanDo:
      "Review the current changes and run the analysis again if you still want an updated AI analysis.",
  },
  unexpected_application: {
    whatHappened: "ARC could not finish applying the AI analysis.",
    whatYouCanDo: "Try the analysis again. You can continue working manually in the meantime.",
  },
  structurally_declined: {
    whatHappened:
      "The latest AI analysis described this contract differently from your current analysis, so ARC did not apply it.",
    extraImpact: "Nothing in your analysis was created, changed, merged or removed.",
    whatYouCanDo:
      "Review the contract yourself and adjust your analysis where you think it is needed, or start a new analysis if this contract really has changed.",
  },
  allowance_exhausted: {
    whatHappened: "You have used all of your AI analyses for now.",
    whatYouCanDo:
      "ARC still works fully without AI. You can keep working manually and run an AI analysis once your allowance resets.",
  },
};

function categoryFor(facts: AiFailureFacts): AiFailurePresentationCategory {
  const byCode =
    typeof facts.failureCategory === "string" ? CATEGORY_BY_CODE[facts.failureCategory] : undefined;
  if (!byCode || typeof facts.failureCode !== "string") return "unexpected_application";
  return byCode[facts.failureCode] ?? "unexpected_application";
}

/**
 * Selects one settled presentation. Deterministic and total: every input,
 * including a hostile or unrecognised one, produces safe ARC-authored copy.
 */
export function presentAiFailure(facts: AiFailureFacts): AiFailurePresentation {
  const category = categoryFor(facts);
  const copy = COPY[category];
  const impactBase = facts.hadPriorSuccessfulAnalysis ? IMPACT_REANALYSIS : IMPACT_FIRST_RUN;

  return {
    category,
    headline:
      category === "allowance_exhausted"
        ? AI_ALLOWANCE_HEADLINE
        : facts.hadPriorSuccessfulAnalysis
          ? AI_FAILURE_HEADLINE_REANALYSIS
          : AI_FAILURE_HEADLINE_FIRST_RUN,
    whatHappened: copy.whatHappened,
    impact: copy.extraImpact ? `${impactBase} ${copy.extraImpact}` : impactBase,
    whatYouCanDo: copy.whatYouCanDo,
    // Truthful by construction: taken from the provider-start boundary, never
    // inferred from the failure category.
    allowance:
      category === "allowance_exhausted" || !facts.allowanceConsumed
        ? ALLOWANCE_NOT_USED
        : ALLOWANCE_USED,
  };
}
