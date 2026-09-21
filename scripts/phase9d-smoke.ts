/**
 * Phase 9D — developer-only live acceptance run.
 *
 * NOT part of `bun run test`, `bun run verify` or CI. It refuses to run without
 * BOTH a configured OPENAI_API_KEY and an explicit ARC_ALLOW_LIVE_PHASE9D=1
 * opt-in, and it performs at most:
 *   - one LIVE non-generative responses.inputTokens.count call, and
 *   - one LIVE responses.create call, only if the token preflight passes.
 *
 * The fixture is the ORIGINAL four-page fictional Genomix Clinical Diagnostics
 * LLC / Synthesis BioAnalytics Inc. contract package used throughout 9A/9B —
 * byte-identity verified before it is used. It is synthetic test material and
 * never a real client contract.
 *
 * It reserves no ARC allowance and writes nothing: no ai_runs, no
 * ai_monthly_usage, no ai_analysis_state, no WorkflowDraft. It prints no API
 * key, no prompt, no PDF bytes, no base64, no page text, no signed URL and no
 * complete model response.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { AI_LIMITS } from "@/lib/arc/ai/config.server";
import { openAiClient, createTokenCounter } from "@/lib/arc/ai/openai.server";
import { buildAiInstructions } from "@/lib/arc/ai/prompt";
import {
  buildAiRequestPackage,
  releaseRequestSensitivePayload,
} from "@/lib/arc/ai/request-package.server";
import {
  arcStructuredOutput,
  createTerraAnalyzer,
  TerraAnalysisError,
} from "@/lib/arc/ai/terra.server";

/** The original fictional package. Identity is asserted, never assumed. */
const FIXTURE_PATH =
  process.env["ARC_PHASE9D_FIXTURE_PDF"] ??
  path.join(process.cwd(), "fixtures", "genomix-synthesis-contract-package.pdf");
const FIXTURE_SHA256 = "7487979e42fb2dab23c6a6b4858806ae0d37831c63c0ddd98730fccf09fdd4c7";
const FIXTURE_BYTES = 56598;
const FIXTURE_PAGES = 4;

function fail(message: string): never {
  console.error(`\nPhase 9D smoke refused: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!process.env["OPENAI_API_KEY"]) fail("OPENAI_API_KEY is not configured.");
  if (process.env["ARC_ALLOW_LIVE_PHASE9D"] !== "1") {
    fail("ARC_ALLOW_LIVE_PHASE9D=1 is required for a live Phase 9D acceptance run.");
  }

  // 1. The original fictional Genomix package, verified byte-for-byte.
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = new Uint8Array(await readFile(FIXTURE_PATH));
  } catch {
    fail(`the fictional Genomix acceptance PDF was not found at ${FIXTURE_PATH}`);
  }
  const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
  if (pdfBytes.byteLength !== FIXTURE_BYTES || sha256 !== FIXTURE_SHA256) {
    fail("the acceptance PDF does not match the expected fictional Genomix fixture identity.");
  }
  const documentId = "genomix-acceptance";

  console.log("ARC Phase 9D live acceptance");
  console.log("-".repeat(60));
  console.log(`fixture bytes           ${pdfBytes.byteLength} (expected ${FIXTURE_BYTES})`);
  console.log(`fixture sha256          ${sha256}`);

  // 2-9. Extraction, Guidance pack, instructions, strict schema, ONE canonical
  // request, the 50 MB byte cap and the LIVE input-token count all happen
  // inside the existing Phase 9B package builder.
  const counter = createTokenCounter(await openAiClient());
  const built = await buildAiRequestPackage({
    scope: { kind: "guest", guestTokenHash: "phase9d-developer-acceptance" },
    currentContext: {
      manuallyEnteredFacts: {
        contractTitle: "Genomix Clinical Diagnostics LLC - Synthesis BioAnalytics Inc.",
      },
      draftFingerprint: "phase9d-acceptance",
    },
    requestOptions: {
      structuredOutput: arcStructuredOutput(),
      buildInstructions: (pkg) =>
        buildAiInstructions({
          guidance: pkg.guidance,
          sources: pkg.sources.map((document) => ({
            documentId: document.documentId,
            sha256: document.sha256,
            pageCount: document.pageCount,
            displayName: document.displayName,
            originalFilename: document.originalFilename,
          })),
          arcContextFacts: pkg.currentContext.manuallyEnteredFacts,
        }),
    },
    deps: {
      loadAuthorizedSelectedSources: async () => [
        {
          documentId,
          displayName: "Genomix / Synthesis BioAnalytics contract package",
          originalFilename: "SaaS_Sales_Contract_Package_Genomix_Synthesis.pdf",
          sha256,
          byteSize: pdfBytes.byteLength,
          storageObjectPath: "developer-fixture/genomix.pdf",
        },
      ],
      download: async () => pdfBytes,
      countTokens: counter,
    },
  });

  if (!built.ok) {
    console.error(`\npreflight failed: ${built.code}`);
    if (built.inputTokens !== undefined) {
      console.error(`input tokens ${built.inputTokens} / limit ${AI_LIMITS.maxInputTokens}`);
    }
    process.exit(1);
  }

  const extractedPages = built.package.sources[0]?.pageCount;
  console.log(`pages extracted         ${extractedPages} (expected ${FIXTURE_PAGES})`);
  console.log(`guidance cards supplied ${built.package.guidance.cards.length}`);
  console.log(
    `guidance card ids       ${built.package.guidance.cards.map((card) => card.id).join(", ")}`,
  );
  console.log(`registry hash           ${built.package.guidance.registryHash.slice(0, 16)}...`);
  console.log(
    `LIVE input tokens       ${built.inputTokens} / limit ${AI_LIMITS.maxInputTokens} -> PASS`,
  );

  // 10-11. Only now, and exactly once.
  const analyzer = createTerraAnalyzer(await openAiClient());
  console.log(`\ncalling ${AI_LIMITS.model} once (reasoning: ${AI_LIMITS.reasoningEffort})...`);

  try {
    const result = await analyzer.analyze({
      canonicalRequest: built.canonicalRequest,
      evidence: built.package.sources,
      guidance: built.package.guidance,
      // Fictional developer fixture only: bounded mismatch diagnostics.
      includeExcerptDiagnostics: true,
    });

    const { analysis, validation } = result;
    const text = validation.verifiedCitations.filter((c) => c.verification === "text_matched");
    const visual = validation.verifiedCitations.filter(
      (c) => c.verification === "visual_page_reference",
    );

    console.log("-".repeat(60));
    console.log(`model                   ${result.model}`);
    console.log(`response id             ${result.responseId}`);
    console.log(
      `usage                   in ${result.usage.inputTokens} / out ${result.usage.outputTokens}` +
        ` / reasoning ${result.usage.reasoningTokens ?? "n/a"} / total ${result.usage.totalTokens}`,
    );
    console.log(`local schema valid      yes`);
    console.log(`citation issues         ${validation.citationIssues.length}`);
    console.log(`guidance issues         ${validation.guidanceIssues.length}`);
    console.log(`provenance issues       ${validation.provenanceIssues.length}`);
    console.log(`text citations verified ${text.length}`);
    console.log(`visual page references  ${visual.length}`);
    console.log(`logical documents       ${analysis.logicalDocuments.length}`);
    console.log(`promises                ${analysis.promises.length}`);
    console.log(`PO proposals            ${analysis.performanceObligations.length}`);
    console.log(
      `variable components     ${analysis.transactionPrice.variableConsiderationComponents.length}`,
    );
    console.log(`additional topics       ${analysis.additionalTopics.length}`);
    console.log(`issues raised           ${analysis.issues.length}`);

    console.log("\nbounded reviewer summary");
    console.log(`  ${analysis.analysisSummary.slice(0, 400)}`);
    for (const promise of analysis.promises) {
      console.log(
        `  promise ${promise.semanticKey} [${promise.promiseType}] ` +
          `distinct=${promise.distinctConclusion} ${promise.reviewState}`,
      );
    }
    for (const po of analysis.performanceObligations) {
      console.log(
        `  PO ${po.semanticKey} <- ${po.promiseKeys.join("+")} ` +
          `${po.satisfactionPattern} ${po.reviewState}`,
      );
    }
    console.log(
      `  fixed consideration ${analysis.transactionPrice.fixedConsiderationInput ?? "-"}`,
    );
    for (const component of analysis.transactionPrice.variableConsiderationComponents) {
      console.log(
        `  variable ${component.semanticKey} [${component.type}] ` +
          `${component.contractualRateOrAmountInput ?? "-"} ${component.reviewState}`,
      );
    }
    for (const term of analysis.billingTerms) {
      console.log(
        `  billing ${term.semanticKey} ${term.billingTiming}/${term.frequency} ` +
          `${term.amountOrRateInput ?? "-"} net ${term.paymentTermsDays ?? "-"}`,
      );
    }
    for (const issue of analysis.issues.slice(0, 15)) {
      console.log(
        `  issue [${issue.reviewState}] ${issue.section}: ${issue.message.slice(0, 160)}`,
      );
    }
  } catch (error) {
    if (error instanceof TerraAnalysisError) {
      // Fail closed: nothing is applied, nothing is persisted, nothing retried.
      console.error(`\nlive call failed (${error.category}): ${error.message}`);
      for (const detail of error.details) console.error(`  ${detail}`);
    } else {
      console.error(`\nlive call failed: ${(error as Error).message.slice(0, 300)}`);
    }
    process.exitCode = 1;
  } finally {
    // 17. Release the PDF/base64 references.
    releaseRequestSensitivePayload(built.package);
  }
}

void main();
