/**
 * Phase 9F — Task 8. PREFLIGHT ONLY.
 *
 * Builds the exact canonical Genomix request (original PDF once at high
 * detail + the ARC anchored citation mirror + prompt v3 + the anchored strict
 * schema) and performs ONLY the non-generative input-token count. It never
 * calls `responses.create`, consumes no AI allowance, touches no database and
 * writes no canonical state.
 *
 * Developer-only. Requires ARC_ALLOW_PREFLIGHT_PHASE9F=1 and a configured
 * OPENAI_API_KEY. Prints no key, PDF bytes, base64, page text, prompt or
 * provider body.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { AI_LIMITS } from "@/lib/arc/ai/config.server";
import { productionTokenCounter } from "@/lib/arc/ai/openai.server";
import {
  buildAiRequestPackage,
  releaseRequestSensitivePayload,
  type AuthorizedSource,
} from "@/lib/arc/ai/request-package.server";
import { arcStructuredOutput } from "@/lib/arc/ai/terra.server";
import { buildCitationAnchorPages } from "@/lib/arc/ai/citation-anchors";

const FIXTURE_PATH = path.join(process.cwd(), "fixtures", "genomix-synthesis-contract-package.pdf");
const FIXTURE_SHA256 = "7487979e42fb2dab23c6a6b4858806ae0d37831c63c0ddd98730fccf09fdd4c7";

function fail(message: string): never {
  console.error(`\nPhase 9F preflight refused: ${message}\n`);
  process.exit(1);
}

function say(label: string, value: unknown): void {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main(): Promise<void> {
  if (!process.env["OPENAI_API_KEY"]) fail("OPENAI_API_KEY is not configured.");
  if (process.env["ARC_ALLOW_PREFLIGHT_PHASE9F"] !== "1") {
    fail("ARC_ALLOW_PREFLIGHT_PHASE9F=1 is required.");
  }

  const bytes = new Uint8Array(await readFile(FIXTURE_PATH));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== FIXTURE_SHA256) fail("fixture SHA-256 mismatch.");

  const source: AuthorizedSource = {
    documentId: "doc-genomix-preflight",
    displayName: "Genomix / Synthesis contract package",
    originalFilename: "genomix-synthesis-contract-package.pdf",
    sha256: sha,
    byteSize: bytes.byteLength,
    storageObjectPath: "fixture://genomix",
  };

  const result = await buildAiRequestPackage({
    scope: {
      kind: "authenticated",
      userId: "preflight",
      contractId: "preflight",
      revisionId: "preflight",
    },
    currentContext: {
      manuallyEnteredFacts: { contractTitle: "Genomix master agreement (fixture)" },
      draftFingerprint: "preflight",
    },
    requestOptions: {
      structuredOutput: arcStructuredOutput(),
      buildInstructions: (requestPackage) => arcCanonicalInstructions(requestPackage, AI_LIMITS),
    },
    deps: {
      loadAuthorizedSelectedSources: async () => [source],
      download: async () => bytes,
      // The REAL non-generative counting boundary. No generative call exists
      // anywhere in this script.
      countTokens: await productionTokenCounter(),
      limits: AI_LIMITS,
    },
  });

  if (!result.ok) fail(`preflight failed: ${result.code}`);

  const anchors = buildCitationAnchorPages(result.package.sources);
  say("configuration", {
    model: AI_LIMITS.model,
    reasoningEffort: AI_LIMITS.reasoningEffort,
    promptVersion: AI_LIMITS.promptVersion,
    outputSchemaVersion: AI_LIMITS.outputSchemaVersion,
    maxInputTokens: AI_LIMITS.maxInputTokens,
  });
  say("evidence", {
    pages: result.package.sources.reduce((total, doc) => total + doc.pages.length, 0),
    anchorPages: anchors.length,
    anchors: anchors.reduce((total, page) => total + page.anchors.length, 0),
  });
  say("preflight input tokens", result.inputTokens);
  say("within cap", result.inputTokens <= AI_LIMITS.maxInputTokens);
  say("truncation", "disabled (no truncation, no source dropped)");

  releaseRequestSensitivePayload(result.package);
}

await main();
