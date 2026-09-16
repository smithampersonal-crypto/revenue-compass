/**
 * Phase 9D — the Terra analyzer boundary.
 *
 * Exactly ONE generative `responses.create` call per deliberate analysis:
 * no hidden retry (`maxRetries: 0`), no repair call, no fallback model. A
 * malformed response fails; ARC never asks the model to fix its own JSON.
 *
 * The boundary FAILS CLOSED. A response that parses and satisfies the local
 * schema but whose citations, Guidance references or material provenance do not
 * validate is an error, never a successful result: no caller can accidentally
 * consume an unverified analysis.
 *
 * Server-only. Nothing here logs the prompt, the request, the PDF bytes, the
 * base64 payload, page text, signed URLs, the API key or the raw response body,
 * and no provider error text ever reaches an ARC error message.
 */

import type { GuidancePack } from "@/lib/arc/guidance/types";

import {
  buildValidationFailureDetails,
  validateAiCitations,
  type AiCitationValidationResult,
} from "./citations";
import type { ArcStructuredOutput } from "./request-package.server";
import {
  AI_OUTPUT_SCHEMA_NAME,
  aiContractAnalysisJsonSchema,
  parseAiContractAnalysis,
  type AiContractAnalysis,
} from "./schema";
import type { AiDocumentEvidence } from "./types";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  totalTokens: number;
}

export interface AiAnalysisRequest {
  /** The exact canonical envelope already counted by preflight. */
  canonicalRequest: Record<string, unknown>;
  /** ARC's own local extraction, used only to verify the model's citations. */
  evidence: readonly AiDocumentEvidence[];
  /** The exact Guidance Pack supplied in this run. */
  guidance: GuidancePack;
  /**
   * Developer-only. When true, a provenance failure additionally carries
   * bounded excerpt diagnostics (path, page, mode, a short excerpt preview and
   * whether the difference looks like punctuation/whitespace or a paraphrase).
   * Used exclusively by the fictional Phase 9D acceptance fixture; production
   * callers leave it off and receive codes and paths only.
   */
  includeExcerptDiagnostics?: boolean;
  /**
   * Fires exactly once, after the provider response has been received and
   * BEFORE any parsing, schema, citation, Guidance or provenance validation.
   * Used by the orchestrator to record that the model has answered.
   */
  onResponseReceived?: () => Promise<void> | void;
}

export interface TerraAnalysisResult {
  analysis: AiContractAnalysis;
  responseId: string;
  usage: AiUsage;
  model: string;
  /** Always fully valid: an invalid validation result throws instead. */
  validation: AiCitationValidationResult;
}

export interface TerraAnalyzer {
  analyze(args: AiAnalysisRequest): Promise<TerraAnalysisResult>;
}

export type TerraFailureCategory =
  | "authentication_or_configuration"
  | "model_access"
  | "request_validation"
  | "token_limit"
  | "api_failure"
  | "structured_output_parse_failure"
  | "response_invalid"
  | "citation_validation_failure";

export class TerraAnalysisError extends Error {
  readonly category: TerraFailureCategory;
  /** Bounded, privacy-safe detail. Never a response body, prompt or credential. */
  readonly details: string[];
  constructor(category: TerraFailureCategory, message: string, details: string[] = []) {
    super(message);
    this.name = "TerraAnalysisError";
    this.category = category;
    this.details = details.slice(0, 40);
  }
}

/** The minimal generative surface ARC uses. Injected so tests never call out. */
export interface ResponsesGenerativeClient {
  responses: {
    create(body: Record<string, unknown>): Promise<unknown>;
  };
}

/**
 * ARC's own safe wording per failure category. The provider's raw
 * `error.message` is NEVER surfaced: it can contain request fragments, partial
 * credentials or provider internals.
 */
export const TERRA_SAFE_MESSAGES: Record<TerraFailureCategory, string> = {
  authentication_or_configuration: "AI analysis is not configured or authorized.",
  model_access: "The configured AI model is unavailable.",
  request_validation: "The AI request was rejected.",
  token_limit: "The AI request exceeded the provider's size limit.",
  api_failure: "The AI service request failed.",
  structured_output_parse_failure: "The model returned output ARC could not parse.",
  response_invalid: "The model response failed ARC's local schema validation.",
  citation_validation_failure: "The model response failed ARC provenance validation.",
};

/** Only a status code and a conservative, pattern-checked provider error type. */
const SAFE_ERROR_TYPE = /^[a-z][a-z0-9_]{0,39}$/;

function safeDiagnostics(error: unknown): string[] {
  const record = (error ?? {}) as { status?: unknown; type?: unknown; code?: unknown };
  const details: string[] = [];
  if (typeof record.status === "number") details.push(`provider status ${record.status}`);
  for (const key of ["type", "code"] as const) {
    const value = record[key];
    if (typeof value === "string" && SAFE_ERROR_TYPE.test(value)) {
      details.push(`provider ${key} ${value}`);
    }
  }
  return details;
}

export function classifyApiError(error: unknown): TerraAnalysisError {
  const status = (error as { status?: number } | null)?.status;
  let category: TerraFailureCategory = "api_failure";
  if (status === 401 || status === 403) category = "authentication_or_configuration";
  else if (status === 404) category = "model_access";
  else if (status === 400 || status === 422) category = "request_validation";
  else if (status === 413) category = "token_limit";
  // ARC's own message and bounded, structural diagnostics only.
  return new TerraAnalysisError(category, TERRA_SAFE_MESSAGES[category], safeDiagnostics(error));
}

/** Convenience field first, then the documented output-item walk. */
export function extractOutputText(response: unknown): string | null {
  const record = response as Record<string, unknown> | null;
  if (!record) return null;
  if (typeof record["output_text"] === "string" && record["output_text"].length > 0) {
    return record["output_text"];
  }
  const output = record["output"];
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const entry = part as { type?: string; text?: unknown };
      if (entry.type === "output_text" && typeof entry.text === "string") parts.push(entry.text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

function readUsage(response: unknown): AiUsage {
  const usage = (response as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const input = Number(usage["input_tokens"] ?? 0);
  const output = Number(usage["output_tokens"] ?? 0);
  const details = usage["output_tokens_details"] as Record<string, unknown> | undefined;
  const reasoningRaw = details?.["reasoning_tokens"];
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
    reasoningTokens: typeof reasoningRaw === "number" ? reasoningRaw : null,
    totalTokens: Number(usage["total_tokens"] ?? input + output) || input + output,
  };
}

/** Bounded, privacy-safe summaries of a provenance failure. */
export function summarizeValidationIssues(validation: AiCitationValidationResult): string[] {
  return [
    ...validation.citationIssues,
    ...validation.guidanceIssues,
    ...validation.provenanceIssues,
  ].map((issue) => `${issue.code} at ${issue.path}`);
}

export function createTerraAnalyzer(client: ResponsesGenerativeClient): TerraAnalyzer {
  return {
    async analyze(args: AiAnalysisRequest): Promise<TerraAnalysisResult> {
      let response: unknown;
      try {
        // EXACTLY ONE generative call. The canonical request object is sent
        // unchanged — the same object preflight counted.
        response = await client.responses.create(args.canonicalRequest);
      } catch (error) {
        throw classifyApiError(error);
      }

      // The response exists. Everything below is ARC's own local validation.
      await args.onResponseReceived?.();

      const outputText = extractOutputText(response);
      if (outputText === null) {
        throw new TerraAnalysisError(
          "structured_output_parse_failure",
          TERRA_SAFE_MESSAGES.structured_output_parse_failure,
          ["the response carried no structured output text"],
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(outputText);
      } catch {
        throw new TerraAnalysisError(
          "structured_output_parse_failure",
          TERRA_SAFE_MESSAGES.structured_output_parse_failure,
          ["the output text was not valid JSON"],
        );
      }

      // Independent local validation: strict Structured Outputs acceptance by
      // the API is never sufficient on its own.
      const validated = parseAiContractAnalysis(parsed);
      if (!validated.ok) {
        throw new TerraAnalysisError(
          "response_invalid",
          TERRA_SAFE_MESSAGES.response_invalid,
          validated.issues,
        );
      }

      const validation = validateAiCitations(validated.analysis, args.evidence, args.guidance);

      // FAIL CLOSED. No repair call, no retry, no fallback model, no canonical
      // state: the single response is simply rejected.
      if (!validation.ok) {
        const details = summarizeValidationIssues(validation);
        if (args.includeExcerptDiagnostics) {
          for (const diagnostic of diagnoseExcerptMismatches(
            validated.analysis,
            args.evidence,
            validation.citationIssues,
          )) {
            details.push(
              `mismatch ${diagnostic.path} p${diagnostic.pageStart}-${diagnostic.pageEnd} ` +
                `[${diagnostic.evidenceMode}] ${diagnostic.difference}: "${diagnostic.excerptPreview}"`,
            );
          }
        }
        throw new TerraAnalysisError(
          "citation_validation_failure",
          TERRA_SAFE_MESSAGES.citation_validation_failure,
          details,
        );
      }

      const record = response as Record<string, unknown>;
      return {
        analysis: validated.analysis,
        responseId: typeof record["id"] === "string" ? record["id"] : "",
        model: typeof record["model"] === "string" ? record["model"] : "",
        usage: readUsage(response),
        validation,
      };
    },
  };
}

/**
 * The strict Structured Output configuration ARC always sends. The installed
 * SDK (openai 7.15.0) types this exactly as `text.format` with
 * `{ type: "json_schema", name, strict, schema }`, so no shape adjustment was
 * needed.
 */
export function arcStructuredOutput(): ArcStructuredOutput {
  return {
    format: {
      type: "json_schema",
      name: AI_OUTPUT_SCHEMA_NAME,
      strict: true,
      schema: aiContractAnalysisJsonSchema,
    },
  };
}
