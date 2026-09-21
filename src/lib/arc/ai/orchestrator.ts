/**
 * Phase 9F Task 12 — server-only end-to-end AI orchestration.
 *
 * Pure and dependency-injected: no Supabase client, no OpenAI client, no
 * secret and no logging live here, so the whole lifecycle is testable against
 * a fake model. Every authority rule that already held in Phase 9B–9E holds
 * unchanged; this module only sequences those layers and records the
 * lifecycle in the trusted database routines.
 *
 * The invariant chain, in order, is:
 *   created → extracting → preflight_ready → analyzing → validating →
 *   applying → succeeded, with exactly one terminal failure stage otherwise.
 *
 * - allowance is reserved BEFORE the single generative call and never after;
 * - exactly one `responses.create` happens per run — there is no retry, no
 *   repair call and no fallback model anywhere in this file;
 * - a failure after the model responded restores the exact pre-run canonical
 *   inputs and sidecar, so a partially applied analysis cannot exist;
 * - nothing here logs a prompt, a PDF, a response body or a credential.
 */

import type { WorkflowDraft } from "@/lib/asc606-workflow/types";

import { valueFingerprint } from "./identity";
import { AiMergeError, mergeAiAnalysis, type AiAnalysisState } from "./merge";
import type { AiRunScope, AuthorizedSource } from "./request-package.server";
import {
  AI_RUN_NOT_AVAILABLE,
  isActiveStage,
  quotaScopeFor,
  runBelongsToCaller,
  utcMonthOf,
  type AiCallerScope,
  type AiRunDeps,
  type AiRunStage,
  type AiRunStatusDto,
  type AiRunStore,
  type AiRunRow,
} from "./runs.handlers";
import {
  assessSafeReanalysis,
  isChangedSourceReanalysis,
  type PriorAnalysisLoad,
} from "./safe-reanalysis";
import { TerraAnalysisError, type TerraAnalyzer, type TerraAnchorDiagnostic } from "./terra.server";
import type { AiPreflightResult, PriorAccountingContext } from "./types";

/* ------------------------------------------------------------- boundary */

export type AiFailureCategory = "preflight" | "api" | "response" | "application";

/** Everything the orchestrator needs about the scope it is about to change. */
import type { AiContractAnalysis } from "./schema";

export interface AiExecutionContext {
  draft: WorkflowDraft;
  aiState: AiAnalysisState;
  priorContext: PriorAccountingContext | null;
  /**
   * Phase 9G-R3. Immutable structured output of the last successful run,
   * supplied only when the sidecar predates identity signatures.
   */
  priorAnalysis?: AiContractAnalysis | null;
  /**
   * ARC v1 Safe Re-analysis. Whether the REQUIRED prior immutable structured
   * result was actually loaded and parsed. Only the trusted integration layer
   * knows this; the pure safety gate must never infer it.
   */
  priorAnalysisLoad?: PriorAnalysisLoad | undefined;
  schemaVersion: string;
  /** Observed optimistic lock of the revision or temporary workspace. */
  lockVersion: number;
  /** Deterministic ARC facts the model is told, never asked to invent. */
  manuallyEnteredFacts: Record<string, string | number | boolean | null>;
  arcFactSignals: readonly string[];
}

export interface AiApplyArgs {
  runId: string;
  ownerUserId: string | null;
  guestTokenHash: string | null;
  expectedLockVersion: number;
  canonicalInputs: WorkflowDraft;
  schemaVersion: string;
  aiState: AiAnalysisState;
  sourceSetFingerprint: string;
  structuredResult: unknown;
  usageMetadata: unknown;
  reviewIssueCount: number;
}

/** A lost optimistic lock (ARC conflict code PT409) during application. */
export class AiApplyConflictError extends Error {
  constructor() {
    super("The analysis changed while the AI result was being applied.");
    this.name = "AiApplyConflictError";
  }
}

export interface AiRunExecutionStore extends AiRunStore {
  /**
   * `arc_advance_ai_run_stage`: one atomic adjacent-stage claim.
   * `false` means another caller already claimed it — the loser must stop.
   */
  advanceStage(runId: string, from: AiRunStage, to: AiRunStage): Promise<boolean>;
  loadExecutionContext(caller: AiCallerScope): Promise<AiExecutionContext>;
  /** `arc_record_ai_preflight`: source + guidance provenance, one transition. */
  recordPreflight(args: {
    runId: string;
    sourceSetFingerprint: string;
    sources: readonly { documentId: string; sha256: string; byteSize: number; pageCount: number }[];
    guidance: readonly { cardId: number; inclusionReason: string; matchedSignals: string[] }[];
    sourceCount: number;
    pageCount: number;
    inputTokens: number;
  }): Promise<void>;
  /**
   * `arc_reserve_ai_allowance`: the only place allowance is consumed, and the
   * only transition into `analyzing` — the charge and the stage commit together.
   */
  reserveAllowance(args: {
    runId: string;
    ownerUserId: string | null;
    guestTokenHash: string | null;
    utcMonth: string;
    userMonthlyLimit: number;
    guestLimit: number;
  }): Promise<{ reserved: boolean; alreadyReserved: boolean; remainingAllowance: number }>;
  /** `arc_apply_ai_run`: canonical inputs + sidecar + run success, atomically. */
  applyRun(args: AiApplyArgs): Promise<void>;
  /**
   * `arc_restore_pre_ai_run`: exact pre-run canonical inputs and sidecar.
   * Reserved for the EXPLICIT, user-initiated whole-run restore only — the
   * orchestrator never calls it on its own.
   */
  restorePreRun(args: {
    runId: string;
    ownerUserId: string | null;
    guestTokenHash: string | null;
    expectedLockVersion: number;
  }): Promise<void>;
  markFailure(args: {
    runId: string;
    failureStage: string;
    category: AiFailureCategory;
    code: string;
    safeMessage: string;
  }): Promise<void>;
}

export interface AiExecutionDeps extends Omit<AiRunDeps, "store"> {
  store: AiRunExecutionStore;
  /** Phase 9B builder: authorization, evidence, one canonical request, preflight. */
  buildPackage(args: {
    scope: AiRunScope;
    currentContext: {
      manuallyEnteredFacts: Record<string, string | number | boolean | null>;
      draftFingerprint: string;
    };
    priorContext: PriorAccountingContext | null;
    arcFactSignals: readonly string[];
  }): Promise<AiPreflightResult & { authorizedSources?: readonly AuthorizedSource[] }>;
  analyzer: TerraAnalyzer;
  /** Frees the in-memory base64 attachments as soon as the run is finished. */
  releaseBytes?: (requestPackage: unknown) => void;
  /**
   * Developer-only, in-memory, bounded merge diagnostic. Production
   * orchestration never supplies this. It receives the failing error's class
   * name and the top code frames only — never the model response, page text,
   * draft values, prompt or credentials — and nothing here is persisted.
   */
  onMergeDiagnostic?: (diagnostic: { errorName: string; frames: readonly string[] }) => void;
  /**
   * Bounded, sanitized citation-anchor diagnostic. Emitted ONCE, and only for
   * a `citation_anchor_failure`, carrying the run id, the failure code and the
   * materializer's own issue code, schema path and at most three submitted
   * anchor ids per issue. Never excerpt text, page text, model output, prompt,
   * source content, user data or credentials. Purely observational: the
   * fail-closed path is unchanged.
   */
  onCitationAnchorDiagnostic?: (diagnostic: {
    runId: string;
    failureCode: string;
    issues: readonly TerraAnchorDiagnostic[];
  }) => void;
}

/** Bounded, non-sensitive frames: file, line and column only. */
function mergeDiagnosticOf(error: unknown): { errorName: string; frames: readonly string[] } {
  const errorName = error instanceof Error ? error.name : typeof error;
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  const frames = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 5)
    .map((line) => line.replace(/^at\s+/, "").slice(0, 160));
  return { errorName, frames };
}

export const AI_ALLOWANCE_EXHAUSTED =
  "You have used all of your AI analyses for now. ARC still works fully without AI.";
export const AI_SOURCES_CHANGED =
  "The selected documents changed while the analysis was starting. Start it again.";
export const AI_PREFLIGHT_FAILED =
  "ARC could not prepare the AI analysis. No AI allowance was used.";
export const AI_APPLY_FAILED =
  "ARC could not apply the AI analysis, so nothing was changed. Please try again.";
/** Safe decline: a structurally unsafe re-analysis is expected, never a crash. */
export const AI_REANALYSIS_DECLINED =
  "The latest AI analysis described this contract differently, so ARC did not apply it. Your existing analysis has been preserved.";
export const AI_REANALYSIS_SOURCE_CHANGED =
  "The selected documents are not the ones this analysis is based on, so ARC did not apply a new AI analysis. Your existing analysis has been preserved.";
/** Persisted failure codes for the two safe-decline conditions. */
export const AI_REANALYSIS_DECLINED_CODE = "reanalysis_declined";
export const AI_REANALYSIS_SOURCE_CHANGED_CODE = "reanalysis_source_changed";

/* ------------------------------------------------------------ execution */

function scopeOf(caller: AiCallerScope): AiRunScope {
  return caller.kind === "revision"
    ? {
        kind: "authenticated",
        userId: caller.userId,
        contractId: caller.contractId,
        revisionId: caller.revisionId,
      }
    : { kind: "guest", guestTokenHash: caller.guestTokenHash };
}

function ownerArgs(caller: AiCallerScope): {
  ownerUserId: string | null;
  guestTokenHash: string | null;
} {
  return caller.kind === "revision"
    ? { ownerUserId: caller.userId, guestTokenHash: null }
    : { ownerUserId: caller.authenticatedUserId, guestTokenHash: caller.guestTokenHash };
}

function statusOf(run: AiRunRow, remaining: number): AiRunStatusDto {
  return {
    runId: run.id,
    stage: run.stage,
    sourceCount: run.sourceCount,
    pageCount: run.pageCount,
    inputTokens: run.inputTokens,
    remainingAllowance: remaining,
    reviewIssueCount: run.reviewIssueCount,
    completedAt: run.completedAt,
    safeError: run.safeMessage,
  };
}

async function finish(
  deps: AiExecutionDeps,
  caller: AiCallerScope,
  runId: string,
): Promise<AiRunStatusDto> {
  const run = await deps.store.findRun(runId);
  if (!run) throw new Error(AI_RUN_NOT_AVAILABLE);
  const { usageSummaryHandler } = await import("./runs.handlers");
  const usage = await usageSummaryHandler({ ...deps, store: deps.store }, caller);
  return statusOf(run, usage.remaining);
}

/**
 * Terra's own categories, mapped onto ARC's four persisted failure stages.
 *
 * EXHAUSTIVE by construction: there is no permissive default. A new Terra
 * failure category without an explicit mapping here is a compile-time error,
 * so an unmapped response-side failure can never silently be recorded as an
 * API failure.
 */
export function failureCategoryFor(error: TerraAnalysisError): AiFailureCategory {
  switch (error.category) {
    // Nothing was produced by the model: the call itself failed.
    case "authentication_or_configuration":
    case "model_access":
    case "request_validation":
    case "token_limit":
    case "api_failure":
      return "api";
    // A response exists and ARC's own local validation rejected it.
    case "structured_output_parse_failure":
    case "response_invalid":
    case "citation_anchor_failure":
    case "citation_validation_failure":
      return "response";
    default: {
      const exhaustive: never = error.category;
      throw new Error(`unmapped Terra failure category: ${String(exhaustive)}`);
    }
  }
}

/**
 * Runs one created run to a terminal stage.
 *
 * Re-entrant by design: a run that is no longer `created` is never executed a
 * second time, so a duplicated client call, a refresh or a retried request
 * returns the current status instead of contacting the model again.
 */
export async function executeAiRunHandler(
  deps: AiExecutionDeps,
  caller: AiCallerScope,
  input: { runId: string },
): Promise<AiRunStatusDto> {
  const run = await deps.store.findRun(input.runId);
  if (!run || !runBelongsToCaller(run, caller)) throw new Error(AI_RUN_NOT_AVAILABLE);
  // Only a freshly created run may be executed. Every later stage is either
  // already in flight elsewhere or terminal.
  if (run.stage !== "created") return finish(deps, caller, run.id);

  // Exactly-once claim. The loser of a concurrent start stops here and never
  // touches the model, the allowance or the accountant's draft.
  const claimed = await deps.store.advanceStage(run.id, "created", "extracting");
  if (!claimed) return finish(deps, caller, run.id);

  const context = await deps.store.loadExecutionContext(caller);
  let requestPackage: unknown = null;

  try {
    /* ---------------------------------------------------------- preflight */
    // The whole UNPAID region — package build, exact token count and
    // provenance persistence — is bounded: an unexpected exception here
    // terminalizes the run as `preflight_failed` instead of leaving a durable
    // run active forever. Typed preflight refusals keep their own safe codes.
    type Preflight = Awaited<ReturnType<AiExecutionDeps["buildPackage"]>>;
    let preflight: Preflight | null = null;

    try {
      preflight = await deps.buildPackage({
        scope: scopeOf(caller),
        currentContext: {
          manuallyEnteredFacts: context.manuallyEnteredFacts,
          draftFingerprint: valueFingerprint(context.draft),
        },
        priorContext: context.priorContext,
        arcFactSignals: context.arcFactSignals,
      });

      if (preflight.ok) {
        requestPackage = preflight.package;
        const packaged = preflight.package.sources;
        await deps.store.recordPreflight({
          runId: run.id,
          // The run's immutable fingerprint is re-proved inside the routine: a
          // selection that changed since creation fails the run instead of
          // analyzing a different document set.
          sourceSetFingerprint: await sourceFingerprintOf(packaged),
          sources: packaged.map((source) => ({
            documentId: source.documentId,
            sha256: source.sha256,
            byteSize: source.byteSize,
            pageCount: source.pageCount,
          })),
          guidance: preflight.package.guidance.inclusions.map((inclusion) => ({
            cardId: inclusion.cardId,
            inclusionReason: inclusion.reason,
            matchedSignals: [...inclusion.matchedSignals],
          })),
          sourceCount: packaged.length,
          pageCount: packaged.reduce((total, source) => total + source.pageCount, 0),
          inputTokens: preflight.inputTokens,
        });
      }
    } catch {
      // No allowance was reserved and the model was never contacted; the raw
      // exception text is never persisted.
      await deps.store.markFailure({
        runId: run.id,
        failureStage: "extracting",
        category: "preflight",
        code: "preflight_failed",
        safeMessage: AI_PREFLIGHT_FAILED,
      });
      return finish(deps, caller, run.id);
    }

    if (!preflight.ok) {
      await deps.store.markFailure({
        runId: run.id,
        failureStage: "extracting",
        category: "preflight",
        code: preflight.code,
        safeMessage: preflight.message,
      });
      return finish(deps, caller, run.id);
    }

    const sources = preflight.package.sources;
    // The one deterministic identity of the source set actually analyzed. It
    // is reused verbatim for the apply argument and the applied sidecar state.
    const currentSourceSetFingerprint = await sourceFingerprintOf(sources);

    /* ------------------------- changed-source decline, BEFORE any payment */
    // A document set that is not the one the current analysis rests on can
    // never be applied, so it is refused here: no allowance is reserved and
    // the model is never contacted.
    if (isChangedSourceReanalysis(context.aiState, currentSourceSetFingerprint)) {
      await deps.store.markFailure({
        runId: run.id,
        failureStage: "preflight_ready",
        category: "preflight",
        code: AI_REANALYSIS_SOURCE_CHANGED_CODE,
        safeMessage: AI_REANALYSIS_SOURCE_CHANGED,
      });
      return finish(deps, caller, run.id);
    }

    /* ------------------------------ allowance, which also enters analyzing */
    const owner = ownerArgs(caller);
    const reservation = await deps.store.reserveAllowance({
      runId: run.id,
      ownerUserId: quotaScopeFor(caller) === "authenticated" ? owner.ownerUserId : null,
      guestTokenHash: owner.guestTokenHash,
      utcMonth: utcMonthOf(deps.now()),
      userMonthlyLimit: deps.limits.userMonthlyRunLimit,
      guestLimit: deps.limits.guestRunLimit,
    });

    if (!reservation.reserved && !reservation.alreadyReserved) {
      await deps.store.markFailure({
        runId: run.id,
        failureStage: "preflight_ready",
        category: "preflight",
        code: "allowance_exhausted",
        safeMessage: AI_ALLOWANCE_EXHAUSTED,
      });
      return finish(deps, caller, run.id);
    }

    /* ------------------------------------------------- the one model call */
    let result;
    try {
      result = await deps.analyzer.analyze({
        canonicalRequest: preflight.canonicalRequest,
        evidence: sources,
        guidance: preflight.package.guidance,
        // Fires once the provider response has been received and before any
        // parsing, schema, citation, Guidance or provenance validation.
        onResponseReceived: async () => {
          await deps.store.advanceStage(run.id, "analyzing", "validating");
        },
      });
    } catch (error) {
      const terra =
        error instanceof TerraAnalysisError
          ? error
          : new TerraAnalysisError("api_failure", "The AI service request failed.");
      const category = failureCategoryFor(terra);
      // Observational only, and only for the anchor-selection boundary.
      if (terra.category === "citation_anchor_failure" && deps.onCitationAnchorDiagnostic) {
        deps.onCitationAnchorDiagnostic({
          runId: run.id,
          failureCode: terra.category,
          issues: terra.anchorDiagnostics,
        });
      }
      await deps.store.markFailure({
        runId: run.id,
        // An API failure never produced a response, so the run is still
        // analyzing; a rejected response already moved to validating.
        failureStage: category === "response" ? "validating" : "analyzing",
        category,
        code: terra.category,
        safeMessage: terra.message,
      });
      return finish(deps, caller, run.id);
    }

    /* ------------------------------------------- deterministic application */
    await deps.store.advanceStage(run.id, "validating", "applying");

    // The merge is part of applying: it runs against the NEWEST accountant
    // draft, and a lost optimistic lock re-merges locally. There is no second
    // token count, no second allowance charge and no second model call here.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const latest = await deps.store.loadExecutionContext(caller);

      /* ------------------------------------- Safe Re-analysis firewall */
      // The single seam where a structurally unsafe result is refused. It
      // mutates nothing: declining simply skips the merge and the apply, so
      // canonical inputs, provenance, billing, the sidecar and
      // `last_successful_run_id` all remain exactly as they were.
      const safety = assessSafeReanalysis({
        analysis: result.analysis,
        priorAnalysis: latest.priorAnalysis ?? null,
        priorAnalysisLoad: latest.priorAnalysisLoad,
        currentDraft: latest.draft,
        currentAiState: latest.aiState,
        currentSourceSetFingerprint,
      });
      if (safety.outcome === "decline") {
        await deps.store.markFailure({
          runId: run.id,
          failureStage: "applying",
          category: "application",
          code: AI_REANALYSIS_DECLINED_CODE,
          safeMessage:
            safety.reason === "source_changed"
              ? AI_REANALYSIS_SOURCE_CHANGED
              : AI_REANALYSIS_DECLINED,
        });
        return finish(deps, caller, run.id);
      }

      let merged;
      try {
        merged = mergeAiAnalysis({
          currentDraft: latest.draft,
          currentAiState: latest.aiState,
          analysis: result.analysis,
          runId: run.id,
          guidancePack: preflight.package.guidance,
          priorContext: latest.priorContext,
          priorAnalysis: latest.priorAnalysis ?? null,
        });
      } catch (error) {
        deps.onMergeDiagnostic?.(mergeDiagnosticOf(error));
        await deps.store.markFailure({
          runId: run.id,
          failureStage: "applying",
          category: "application",
          code: error instanceof AiMergeError ? error.code : "merge_failed",
          safeMessage: AI_APPLY_FAILED,
        });
        return finish(deps, caller, run.id);
      }

      // Source freshness is a lifecycle concern, not merge policy: the merge
      // carries the previous state forward, and only a successful apply marks
      // the analyzed selection as current.
      const appliedAiState: AiAnalysisState = {
        ...merged.aiState,
        sourceSetFingerprint: currentSourceSetFingerprint,
        sourceState: "current",
      };

      try {
        await deps.store.applyRun({
          runId: run.id,
          ownerUserId: owner.ownerUserId,
          guestTokenHash: owner.guestTokenHash,
          expectedLockVersion: latest.lockVersion,
          canonicalInputs: merged.draft,
          schemaVersion: latest.schemaVersion,
          aiState: appliedAiState,
          sourceSetFingerprint: currentSourceSetFingerprint,
          structuredResult: result.analysis,
          usageMetadata: {
            responseId: result.responseId,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            reasoningTokens: result.usage.reasoningTokens,
            totalTokens: result.usage.totalTokens,
          },
          // Outstanding work only: an already resolved item is not an issue.
          reviewIssueCount: outstandingIssueCount(merged.issues),
        });
        return finish(deps, caller, run.id);
      } catch (error) {
        if (error instanceof AiApplyConflictError && attempt < maxAttempts) continue;
        // Nothing partial was committed: `arc_apply_ai_run` is atomic, so the
        // run simply fails. Restoring is an explicit, user-initiated action.
        await deps.store.markFailure({
          runId: run.id,
          failureStage: "applying",
          category: "application",
          code: error instanceof AiApplyConflictError ? "apply_conflict" : "apply_failed",
          safeMessage: AI_APPLY_FAILED,
        });
        return finish(deps, caller, run.id);
      }
    }

    return finish(deps, caller, run.id);
  } finally {
    if (requestPackage && deps.releaseBytes) deps.releaseBytes(requestPackage);
  }
}

/** Only unresolved review items count as outstanding issues. */
/**
 * Phase 9G-R Task R2. An outstanding issue is work the accountant must act on:
 * only `yellow` and `red` qualify. A routine assumption is deliberately not
 * counted — it is visible and evidenced, but it asks for nothing.
 */
export function outstandingIssueCount(items: readonly { state: string }[]): number {
  return items.filter((item) => item.state === "yellow" || item.state === "red").length;
}

/** Re-derives the run fingerprint from the packaged, verified sources. */
async function sourceFingerprintOf(
  sources: readonly { documentId: string; sha256: string }[],
): Promise<string> {
  const { computeSourceSetFingerprint } = await import("./source-fingerprint");
  return computeSourceSetFingerprint(
    sources.map((source) => ({ documentId: source.documentId, sha256: source.sha256 })),
  );
}

/** A run is resumable only while it is still active. */
export function isResumable(stage: AiRunStage): boolean {
  return isActiveStage(stage);
}
