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

  // The identical object, unchanged: no projection, no field list.
  const { input_tokens: inputTokens } = await args.tokenCounter.count(args.requestParams);

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
