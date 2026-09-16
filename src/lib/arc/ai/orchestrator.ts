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
import { TerraAnalysisError, type TerraAnalyzer } from "./terra.server";
import type { AiPreflightResult, PriorAccountingContext } from "./types";

/* ------------------------------------------------------------- boundary */

export type AiFailureCategory = "preflight" | "api" | "response" | "application";

/** Everything the orchestrator needs about the scope it is about to change. */
export interface AiExecutionContext {
  draft: WorkflowDraft;
  aiState: AiAnalysisState;
  priorContext: PriorAccountingContext | null;
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

export interface AiRunExecutionStore extends AiRunStore {
  /** `arc_advance_ai_run_stage`: one atomic adjacent-stage claim. */
  advanceStage(runId: string, from: AiRunStage, to: AiRunStage): Promise<void>;
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
  /** `arc_reserve_ai_allowance`: the only place allowance is consumed. */
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
  /** `arc_restore_pre_ai_run`: exact pre-run canonical inputs and sidecar. */
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
}

export const AI_ALLOWANCE_EXHAUSTED =
  "You have used all of your AI analyses for now. ARC still works fully without AI.";
export const AI_SOURCES_CHANGED =
  "The selected documents changed while the analysis was starting. Start it again.";
export const AI_APPLY_FAILED =
  "ARC could not apply the AI analysis, so nothing was changed. Please try again.";

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

/** Terra's own categories, mapped onto ARC's four persisted failure stages. */
export function failureCategoryFor(error: TerraAnalysisError): AiFailureCategory {
  switch (error.category) {
    case "structured_output_parse_failure":
    case "response_invalid":
    case "citation_validation_failure":
      return "response";
    default:
      return "api";
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

  const context = await deps.store.loadExecutionContext(caller);
  let requestPackage: unknown = null;

  try {
    await deps.store.advanceStage(run.id, "created", "extracting");

    /* ---------------------------------------------------------- preflight */
    const preflight = await deps.buildPackage({
      scope: scopeOf(caller),
      currentContext: {
        manuallyEnteredFacts: context.manuallyEnteredFacts,
        draftFingerprint: valueFingerprint(context.draft),
      },
      priorContext: context.priorContext,
      arcFactSignals: context.arcFactSignals,
    });

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
    requestPackage = preflight.package;

    const sources = preflight.package.sources;
    const pageCount = sources.reduce((total, source) => total + source.pageCount, 0);

    await deps.store.recordPreflight({
      runId: run.id,
      // The run's immutable fingerprint is re-proved inside the routine: a
      // selection that changed since creation fails the run instead of
      // analyzing a different document set.
      sourceSetFingerprint: await sourceFingerprintOf(sources),
      sources: sources.map((source) => ({
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
      sourceCount: sources.length,
      pageCount,
      inputTokens: preflight.inputTokens,
    });

    /* ---------------------------------------------------------- allowance */
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
    await deps.store.advanceStage(run.id, "preflight_ready", "analyzing");

    let result;
    try {
      result = await deps.analyzer.analyze({
        canonicalRequest: preflight.canonicalRequest,
        evidence: sources,
        guidance: preflight.package.guidance,
      });
    } catch (error) {
      const terra =
        error instanceof TerraAnalysisError
          ? error
          : new TerraAnalysisError("api_failure", "The AI service request failed.");
      await deps.store.markFailure({
        runId: run.id,
        failureStage: "analyzing",
        category: failureCategoryFor(terra),
        code: terra.category,
        safeMessage: terra.message,
      });
      return finish(deps, caller, run.id);
    }

    /* ------------------------------------------- deterministic application */
    await deps.store.advanceStage(run.id, "analyzing", "validating");

    let merged;
    try {
      merged = mergeAiAnalysis({
        currentDraft: context.draft,
        currentAiState: context.aiState,
        analysis: result.analysis,
        runId: run.id,
        guidancePack: preflight.package.guidance,
        priorContext: context.priorContext,
      });
    } catch (error) {
      await deps.store.markFailure({
        runId: run.id,
        failureStage: "validating",
        category: "response",
        code: error instanceof AiMergeError ? error.code : "merge_failed",
        safeMessage: AI_APPLY_FAILED,
      });
      return finish(deps, caller, run.id);
    }

    await deps.store.advanceStage(run.id, "validating", "applying");

    try {
      await deps.store.applyRun({
        runId: run.id,
        ownerUserId: owner.ownerUserId,
        guestTokenHash: owner.guestTokenHash,
        expectedLockVersion: context.lockVersion,
        canonicalInputs: merged.draft,
        schemaVersion: context.schemaVersion,
        aiState: merged.aiState,
        sourceSetFingerprint: await sourceFingerprintOf(sources),
        structuredResult: result.analysis,
        usageMetadata: {
          responseId: result.responseId,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          totalTokens: result.usage.totalTokens,
        },
        reviewIssueCount: merged.issues.length,
      });
    } catch {
      // Nothing partial survives: the exact pre-run canonical inputs and
      // sidecar are restored before the run is marked failed.
      await deps.store.restorePreRun({
        runId: run.id,
        ownerUserId: owner.ownerUserId,
        guestTokenHash: owner.guestTokenHash,
        expectedLockVersion: context.lockVersion,
      });
      await deps.store.markFailure({
        runId: run.id,
        failureStage: "applying",
        category: "application",
        code: "apply_failed",
        safeMessage: AI_APPLY_FAILED,
      });
      return finish(deps, caller, run.id);
    }

    return finish(deps, caller, run.id);
  } finally {
    if (requestPackage && deps.releaseBytes) deps.releaseBytes(requestPackage);
  }
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
