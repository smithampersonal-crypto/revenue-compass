/**
 * Phase 9B — server-only AI configuration.
 *
 * One module owns the model choice and the exact preflight caps. Values are
 * read from the environment at module load on the server only; nothing here is
 * reachable from the browser.
 */

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const AI_LIMITS = {
  /** Server-configurable; Terra is the approved default. */
  model: process.env["ARC_AI_MODEL"] ?? "gpt-5.6-terra",
  reasoningEffort: process.env["ARC_AI_REASONING_EFFORT"] ?? "high",
  /** Exact proposed-request input-token cap. Never exceeded, never truncated. */
  maxInputTokens: numberFrom(process.env["ARC_AI_MAX_INPUT_TOKENS"], 200000),
  /** Exact combined original-PDF byte cap. */
  maxCombinedFileBytes: numberFrom(process.env["ARC_AI_MAX_COMBINED_FILE_BYTES"], 50000000),
  requestTimeoutMs: numberFrom(process.env["ARC_AI_REQUEST_TIMEOUT_MS"], 240000),
} as const;

export type AiLimits = typeof AI_LIMITS;
