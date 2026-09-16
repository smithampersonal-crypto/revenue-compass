/**
 * Phase 9D — the Terra analyzer boundary.
 *
 * Exactly ONE generative `responses.create` call per deliberate analysis:
 * no hidden retry (`maxRetries: 0`), no repair call, no fallback model. A
 * malformed response fails; ARC never asks the model to fix its own JSON.
 *
 * Server-only. Nothing here logs the prompt, the request, the PDF bytes, the
 * base64 payload, page text, signed URLs, the API key or the raw response body.
 */

import type { GuidancePack } from "@/lib/arc/guidance/types";

import { validateAiCitations, type AiCitationValidationResult } from "./citations";
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
}

export interface TerraAnalysisResult {
  analysis: AiContractAnalysis;
  responseId: string;
  usage: AiUsage;
  model: string;
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
  /** Bounded, privacy-safe detail. Never a response body or a prompt. */
  readonly details: string[];
  constructor(category: TerraFailureCategory, message: string, details: string[] = []) {
    super(message);
    this.name = "TerraAnalysisError";
    this.category = category;
    this.details = details.slice(0, 20);
  }
}

/** The minimal generative surface ARC uses. Injected so tests never call out. */
export interface ResponsesGenerativeClient {
  responses: {
    create(body: Record<string, unknown>): Promise<unknown>;
  };
}

function classifyApiError(error: unknown): TerraAnalysisError {
  const status = (error as { status?: number } | null)?.status;
  const raw = error instanceof Error ? error.message : "OpenAI request failed.";
  // Bounded message only: never the request, the prompt or the response body.
  const message = raw.slice(0, 300);
  if (status === 401 || status === 403) {
    return new TerraAnalysisError("authentication_or_configuration", message);
  }
  if (status === 404) return new TerraAnalysisError("model_access", message);
  if (status === 400 || status === 422) {
    return new TerraAnalysisError("request_validation", message);
  }
  if (status === 413) return new TerraAnalysisError("token_limit", message);
  return new TerraAnalysisError("api_failure", message);
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

      const outputText = extractOutputText(response);
      if (outputText === null) {
        throw new TerraAnalysisError(
          "structured_output_parse_failure",
          "The model returned no structured output text.",
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(outputText);
      } catch {
        throw new TerraAnalysisError(
          "structured_output_parse_failure",
          "The model output was not valid JSON.",
        );
      }

      // Independent local validation: strict Structured Outputs acceptance by
      // the API is never sufficient on its own.
      const validated = parseAiContractAnalysis(parsed);
      if (!validated.ok) {
        throw new TerraAnalysisError(
          "response_invalid",
          "The model response failed ARC's local schema validation.",
          validated.issues,
        );
      }

      const validation = validateAiCitations(validated.analysis, args.evidence, args.guidance);

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
