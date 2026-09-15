/**
 * Phase 9B acceptance patch — Finding 1.
 *
 * Exact preflight over the CANONICAL Responses request envelope.
 *
 * This module never constructs, reduces, filters or whitelists a request. It
 * receives the same `requestParams` object the eventual Phase 9D generative
 * call will send and hands it to the non-generative input-token-count endpoint
 * unchanged, so a future token-bearing field cannot be silently dropped from
 * the count. No generative request is made here and no AI allowance is used.
 */

import { AI_LIMITS, type AiLimits } from "./config.server";
import type { OpenAiTokenCounter } from "./openai.server";
import { AI_PREFLIGHT_MESSAGES, type AiPreflightFailureCode } from "./types";

export interface AiPreflightArgs {
  /** The canonical Responses request parameters. Counted verbatim. */
  requestParams: Record<string, unknown>;
  combinedFileBytes: number;
  tokenCounter: OpenAiTokenCounter;
  limits?: AiLimits;
}

export type AiPreflightCheck =
  | { ok: true; inputTokens: number; combinedFileBytes: number }
  | {
      ok: false;
      code: Extract<AiPreflightFailureCode, "combined_bytes_exceeded" | "input_tokens_exceeded">;
      message: string;
      combinedFileBytes: number;
      inputTokens?: number;
    };

/**
 * Phase 9D deviation, forced by the live API.
 *
 * `POST /v1/responses/input_tokens` rejects EXACTLY two of the canonical
 * generation fields with `400 Unknown parameter`: `store` and `background`.
 * Both are storage/execution control flags carrying no prompt tokens; the live
 * count is byte-identical with and without them (verified against the real
 * endpoint). Every token-bearing field — model, instructions, input (the PDFs
 * included), reasoning, tools and the strict `text` schema — is passed through
 * by reference, unchanged. This is the only difference between the counted
 * body and the generated body, and it is never a whitelist: fields are
 * removed by this fixed list, never selected into the count.
 */
export const COUNT_UNSUPPORTED_CONTROL_FLAGS = ["store", "background"] as const;

export function countableRequestView(
  requestParams: Record<string, unknown>,
): Record<string, unknown> {
  const view: Record<string, unknown> = { ...requestParams };
  for (const key of COUNT_UNSUPPORTED_CONTROL_FLAGS) delete view[key];
  return view;
}

export async function preflightAiRequest(args: AiPreflightArgs): Promise<AiPreflightCheck> {
  const limits = args.limits ?? AI_LIMITS;
  const { combinedFileBytes } = args;

  // Byte cap first: nothing is counted once it has already failed.
  if (combinedFileBytes > limits.maxCombinedFileBytes) {
    return {
      ok: false,
      code: "combined_bytes_exceeded",
      message: AI_PREFLIGHT_MESSAGES["combined_bytes_exceeded"],
      combinedFileBytes,
    };
  }

  // The same object, minus only the two control flags the count endpoint
  // rejects. No projection, no field list, nothing token-bearing removed.
  const { input_tokens: inputTokens } = await args.tokenCounter.count(
    countableRequestView(args.requestParams),
  );

  if (inputTokens > limits.maxInputTokens) {
    return {
      ok: false,
      code: "input_tokens_exceeded",
      message: AI_PREFLIGHT_MESSAGES["input_tokens_exceeded"],
      combinedFileBytes,
      inputTokens,
    };
  }

  return { ok: true, inputTokens, combinedFileBytes };
}
