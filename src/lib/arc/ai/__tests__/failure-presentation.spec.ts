/**
 * Phase 9G — Task 3. The deterministic failure-presentation registry.
 *
 * Every user-facing string is ARC source code selected from trusted persisted
 * lifecycle facts. Nothing the provider, the database or an attacker can write
 * into persistence may reach the browser through this registry.
 */

import { describe, expect, it } from "vitest";

import {
  AI_FAILURE_HEADLINE_FIRST_RUN,
  AI_FAILURE_HEADLINE_REANALYSIS,
  presentAiFailure,
  type AiFailureFacts,
  type AiFailurePresentation,
} from "../failure-presentation";

const base: AiFailureFacts = {
  failureCategory: "application",
  failureCode: "apply_failed",
  hadPriorSuccessfulAnalysis: false,
  allowanceConsumed: false,
};

const strings = (presentation: AiFailurePresentation): string =>
  [
    presentation.headline,
    presentation.whatHappened,
    presentation.impact,
    presentation.whatYouCanDo,
    presentation.allowance,
  ].join(" \u0000 ");

describe("deterministic AI failure presentation", () => {
  it("maps a document preparation failure", () => {
    for (const code of [
      "preflight_failed",
      "no_sources",
      "unreadable_source",
      "storage_unavailable",
      "combined_bytes_exceeded",
      "input_tokens_exceeded",
    ]) {
      const presentation = presentAiFailure({
        ...base,
        failureCategory: "preflight",
        failureCode: code,
      });
      expect(presentation.category).toBe("document_preparation");
      expect(presentation.allowance).toContain("No AI allowance was used");
    }
  });

  it("maps an AI service failure without provider detail", () => {
    for (const code of [
      "authentication_or_configuration",
      "model_access",
      "request_validation",
      "token_limit",
      "api_failure",
    ]) {
      const presentation = presentAiFailure({
        ...base,
        failureCategory: "api",
        failureCode: code,
        allowanceConsumed: true,
      });
      expect(presentation.category).toBe("ai_service");
      expect(presentation.whatHappened).toContain("AI service");
      expect(strings(presentation)).not.toContain(code);
    }
  });

  it("maps an ARC validation failure", () => {
    for (const code of [
      "structured_output_parse_failure",
      "response_invalid",
      "citation_anchor_failure",
      "citation_validation_failure",
    ]) {
      const presentation = presentAiFailure({
        ...base,
        failureCategory: "response",
        failureCode: code,
        allowanceConsumed: true,
      });
      expect(presentation.category).toBe("arc_validation");
      expect(presentation.whatHappened).toContain("validation");
      expect(presentation.impact).toContain("not applied");
    }
  });

  it("maps a workspace-change conflict without database wording", () => {
    const presentation = presentAiFailure({
      ...base,
      failureCategory: "application",
      failureCode: "apply_conflict",
      allowanceConsumed: true,
    });
    expect(presentation.category).toBe("workspace_conflict");
    expect(presentation.whatHappened).toContain("workspace changed");
    const text = strings(presentation);
    for (const forbidden of ["PT409", "40001", "SQLSTATE", "serialization", "lock_version"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("maps an unexpected application failure", () => {
    for (const code of ["apply_failed", "merge_failed", "merged_draft_invalid"]) {
      const presentation = presentAiFailure({
        ...base,
        failureCategory: "application",
        failureCode: code,
      });
      expect(presentation.category).toBe("unexpected_application");
    }
  });

  it("treats an exhausted allowance as an availability condition", () => {
    const presentation = presentAiFailure({
      ...base,
      failureCategory: "preflight",
      failureCode: "allowance_exhausted",
    });
    expect(presentation.category).toBe("allowance_exhausted");
    expect(presentation.allowance).toContain("No AI allowance was used");
  });

  it("distinguishes a first run from a re-analysis", () => {
    expect(presentAiFailure({ ...base, hadPriorSuccessfulAnalysis: false }).headline).toBe(
      AI_FAILURE_HEADLINE_FIRST_RUN,
    );
    expect(presentAiFailure({ ...base, hadPriorSuccessfulAnalysis: true }).headline).toBe(
      AI_FAILURE_HEADLINE_REANALYSIS,
    );
    expect(presentAiFailure({ ...base, hadPriorSuccessfulAnalysis: false }).impact).toContain(
      "existing analysis was not changed",
    );
    expect(presentAiFailure({ ...base, hadPriorSuccessfulAnalysis: true }).impact).toContain(
      "previous AI analysis",
    );
  });

  it("reports allowance truthfully from the provider-start boundary", () => {
    expect(presentAiFailure({ ...base, allowanceConsumed: false }).allowance).toContain(
      "No AI allowance was used",
    );
    expect(presentAiFailure({ ...base, allowanceConsumed: true }).allowance).toContain(
      "one AI analysis",
    );
  });

  it("falls back safely for unknown, malformed or newly introduced codes", () => {
    for (const facts of [
      { failureCategory: null, failureCode: null },
      { failureCategory: "preflight", failureCode: "brand_new_code" },
      { failureCategory: "quantum", failureCode: "api_failure" },
      { failureCategory: "api", failureCode: "totally_unmapped" },
      { failureCategory: "{}", failureCode: "<script>" },
    ]) {
      const presentation = presentAiFailure({ ...base, ...facts });
      expect(presentation.category).toBe("unexpected_application");
      const text = strings(presentation);
      if (facts.failureCode) expect(text).not.toContain(facts.failureCode);
      if (facts.failureCategory) expect(text).not.toContain(facts.failureCategory);
    }
  });

  it("never reflects an alarming internal string", () => {
    const hostile = "service_role failed: gpt-5.6-terra prompt-v4 <contract payload>";
    const presentation = presentAiFailure({
      ...base,
      failureCategory: hostile,
      failureCode: hostile,
    });
    const text = strings(presentation);
    for (const forbidden of [
      "service_role",
      "gpt-5.6-terra",
      "prompt-v4",
      "contract payload",
      "arc.ai.schema",
      "Error:",
      " at ARC.",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
