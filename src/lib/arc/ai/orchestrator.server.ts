/**
 * Phase 9F — production wiring for the AI orchestrator.
 *
 * Server-only by filename. This module supplies the real boundaries the pure
 * orchestrator calls: the Phase 9B authorized package builder, the single
 * Phase 9D Terra analyzer, and the byte-release hook. It holds no policy of
 * its own and logs nothing.
 */

import { AI_LIMITS } from "./config.server";
import { productionTerraAnalyzer, productionTokenCounter } from "./openai.server";
import type { AiExecutionDeps } from "./orchestrator";
import {
  arcCanonicalInstructions,
  buildAiRequestPackage,
  releaseRequestSensitivePayload,
  type AiRunScope,
} from "./request-package.server";
import type { AiRequestPackage } from "./types";

/** The one bounded diagnostic line. Sanitized upstream; re-bounded here. */
export function logCitationAnchorDiagnostic(diagnostic: {
  runId: string;
  failureCode: string;
  issues: readonly { issueCode: string; path: string; anchorIds: string[] }[];
}): void {
  console.error(
    JSON.stringify({
      event: "arc.ai.citation_anchor_failure",
      runId: diagnostic.runId,
      failureCode: diagnostic.failureCode,
      issues: diagnostic.issues.slice(0, 20).map((issue) => ({
        issueCode: issue.issueCode,
        path: issue.path.slice(0, 200),
        anchorIds: issue.anchorIds.slice(0, 3),
      })),
    }),
  );
}

export async function createExecutionBoundaries(): Promise<
  Pick<AiExecutionDeps, "buildPackage" | "analyzer" | "releaseBytes" | "onCitationAnchorDiagnostic">
> {
  const [
    { loadAuthorizedSelectedSources },
    { downloadPrivateObject },
    { arcStructuredOutput },
    countTokens,
    analyzer,
  ] = await Promise.all([
    import("./authorized-sources.server"),
    import("@/lib/arc/documents/storage.server"),
    import("./terra.server"),
    productionTokenCounter(),
    productionTerraAnalyzer(),
  ]);

  return {
    analyzer,
    onCitationAnchorDiagnostic: logCitationAnchorDiagnostic,
    releaseBytes: (requestPackage) =>
      releaseRequestSensitivePayload(requestPackage as AiRequestPackage),
    buildPackage: (args) =>
      buildAiRequestPackage({
        scope: args.scope as AiRunScope,
        currentContext: args.currentContext,
        priorContext: args.priorContext,
        arcFactSignals: args.arcFactSignals,
        requestOptions: {
          // The one strict structured-output contract, identical for the
          // counted envelope and the single generative call.
          structuredOutput: arcStructuredOutput(),
          // The real trust-tier instructions. Production never falls back to
          // the legacy package preamble.
          buildInstructions: (requestPackage) =>
            arcCanonicalInstructions(requestPackage, AI_LIMITS),
        },
        deps: {
          loadAuthorizedSelectedSources,
          download: downloadPrivateObject,
          countTokens,
          limits: AI_LIMITS,
        },
      }),
  };
}
