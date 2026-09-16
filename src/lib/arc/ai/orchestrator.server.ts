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

export async function createExecutionBoundaries(): Promise<
  Pick<AiExecutionDeps, "buildPackage" | "analyzer" | "releaseBytes">
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
