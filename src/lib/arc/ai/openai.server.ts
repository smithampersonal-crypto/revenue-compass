/**
 * Phase 9B — server-only OpenAI client boundary.
 *
 * The SDK, the API key and every request shape stay on the server. Phase 9B
 * only ever calls the NON-generative input-token-count endpoint: no generative
 * `responses.create` call exists in this phase, and counting consumes no user
 * AI allowance.
 */

import { AI_LIMITS } from "./config.server";

/** Injected everywhere so tests never depend on a live OpenAI request. */
export interface OpenAiTokenCounter {
  count(input: Record<string, unknown>): Promise<{ input_tokens: number }>;
}

/**
 * Phase 9D — the same single client serves the non-generative token count and
 * the one deliberate generative call, so both travel over one configuration.
 */
interface ArcOpenAiClient {
  responses: {
    inputTokens: {
      count(body: Record<string, unknown>): Promise<{ input_tokens: number }>;
    };
    create(body: Record<string, unknown>): Promise<unknown>;
  };
}

type TokenCountingClient = ArcOpenAiClient;

let cachedClient: ArcOpenAiClient | null = null;

/** Lazily created inside server code only. Never imported by browser modules. */
export async function openAiClient(): Promise<ArcOpenAiClient> {
  if (cachedClient) return cachedClient;
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("AI analysis is not configured.");

  const { default: OpenAI } = await import("openai");
  cachedClient = new OpenAI({
    apiKey,
    // At most one deliberate request per run: the SDK never retries this path.
    maxRetries: 0,
    timeout: AI_LIMITS.requestTimeoutMs,
  }) as unknown as ArcOpenAiClient;
  return cachedClient;
}


export function createTokenCounter(client: TokenCountingClient): OpenAiTokenCounter {
  return {
    count: async (input) => {
      const result = await client.responses.inputTokens.count(input);
      return { input_tokens: result.input_tokens };
    },
  };
}

export async function productionTokenCounter(): Promise<OpenAiTokenCounter> {
  return createTokenCounter(await openAiClient());
}
