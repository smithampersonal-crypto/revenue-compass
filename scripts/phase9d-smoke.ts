/**
 * Phase 9D — developer-only live acceptance run.
 *
 * NOT part of `bun run test`, `bun run verify` or CI. It refuses to run without
 * BOTH a configured OPENAI_API_KEY and an explicit ARC_ALLOW_LIVE_PHASE9D=1
 * opt-in, and it performs at most:
 *   - one LIVE non-generative responses.inputTokens.count call, and
 *   - one LIVE responses.create call, only if the token preflight passes.
 *
 * It reserves no ARC allowance and writes nothing: no ai_runs, no
 * ai_monthly_usage, no ai_analysis_state, no WorkflowDraft. It prints no API
 * key, no prompt, no PDF bytes, no base64, no page text, no signed URL and no
 * complete model response.
 */

import { createHash } from "node:crypto";

import { AI_LIMITS } from "@/lib/arc/ai/config.server";
import { openAiClient, createTokenCounter } from "@/lib/arc/ai/openai.server";
import { buildAiInstructions } from "@/lib/arc/ai/prompt";
import { buildAiRequestPackage, releaseRequestBytes } from "@/lib/arc/ai/request-package.server";
import {
  arcStructuredOutput,
  createTerraAnalyzer,
  TerraAnalysisError,
} from "@/lib/arc/ai/terra.server";

import { buildGenomixAcceptancePdf } from "./genomix-acceptance-pdf";

function fail(message: string): never {
  console.error(`\nPhase 9D smoke refused: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!process.env["OPENAI_API_KEY"]) fail("OPENAI_API_KEY is not configured.");
  if (process.env["ARC_ALLOW_LIVE_PHASE9D"] !== "1") {
    fail("ARC_ALLOW_LIVE_PHASE9D=1 is required for a live Phase 9D acceptance run.");
  }

  // 1. The fictional Genomix package (developer fixture, never a real client).
  const pdfBytes = buildGenomixAcceptancePdf();
  const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const documentId = "genomix-acceptance";

  console.log("ARC Phase 9D live acceptance");
  console.log("-".repeat(60));
  console.log(`fixture bytes           ${pdfBytes.byteLength}`);
  console.log(`fixture sha256          ${sha256.slice(0, 16)}...`);

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
          promptVersion: AI_LIMITS.promptVersion,
        }),
    },
    deps: {
      loadAuthorizedSelectedSources: async () => [
        {
          documentId,
          displayName: "Genomix / Synthesis BioAnalytics contract package",
          originalFilename: "genomix-synthesis-package.pdf",
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

  console.log(`pages extracted         ${built.package.sources[0]?.pageCount}`);
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
    });

    const { analysis, validation } = result;
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
    console.log(`verified citations      ${validation.verifiedCitations.length}`);
    console.log(`logical documents       ${analysis.logicalDocuments.length}`);
    console.log(`promises                ${analysis.promises.length}`);
    console.log(`PO proposals            ${analysis.performanceObligations.length}`);
    console.log(
      `variable components     ${analysis.transactionPrice.variableConsiderationComponents.length}`,
    );
    console.log(`additional topics       ${analysis.additionalTopics.length}`);
    console.log(`issues raised           ${analysis.issues.length}`);

    for (const issue of validation.citationIssues.slice(0, 20)) {
      console.log(`  citation issue: ${issue.code} (${issue.location})`);
    }
    for (const issue of validation.guidanceIssues.slice(0, 10)) {
      console.log(`  guidance issue: ${issue.code} card ${issue.guidanceId}`);
    }

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
    for (const component of analysis.transactionPrice.variableConsiderationComponents) {
      console.log(
        `  variable ${component.semanticKey} [${component.type}] ` +
          `${component.contractualRateOrAmountInput ?? "-"} ${component.reviewState}`,
      );
    }
    for (const issue of analysis.issues.slice(0, 15)) {
      console.log(
        `  issue [${issue.reviewState}] ${issue.section}: ${issue.message.slice(0, 160)}`,
      );
    }
  } catch (error) {
    if (error instanceof TerraAnalysisError) {
      console.error(`\nlive call failed (${error.category}): ${error.message}`);
      for (const detail of error.details.slice(0, 10)) console.error(`  ${detail}`);
    } else {
      console.error(`\nlive call failed: ${(error as Error).message.slice(0, 300)}`);
    }
    process.exitCode = 1;
  } finally {
    // 17. Release the PDF/base64 references.
    releaseRequestBytes(built.package);
  }
}

void main();
