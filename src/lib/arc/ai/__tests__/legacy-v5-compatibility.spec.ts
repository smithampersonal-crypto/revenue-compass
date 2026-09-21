/**
 * Package 2C-A acceptance patch — historical v5 compatibility.
 *
 * Every assertion runs against a hand-authored literal v5 payload, never a v6
 * fixture with `accountingLabel` removed.
 */

import { describe, expect, it } from "vitest";

import {
  AI_OUTPUT_SCHEMA_VERSION,
  LEGACY_AI_OUTPUT_SCHEMA_VERSION,
  parseAiContractAnalysis,
  parsePersistedAiContractAnalysis,
} from "../schema";

import { legacyV5Analysis } from "./legacy-v5-fixture";

function clone(): Record<string, unknown> {
  return structuredClone(legacyV5Analysis) as Record<string, unknown>;
}

describe("historical arc.ai.schema.v5 analyses", () => {
  it("is a literal v5 payload carrying no accounting labels anywhere", () => {
    expect((legacyV5Analysis as Record<string, unknown>)["schemaVersion"]).toBe(
      LEGACY_AI_OUTPUT_SCHEMA_VERSION,
    );
    expect(JSON.stringify(legacyV5Analysis)).not.toMatch(/accountingLabel/);
  });

  it("is rejected by the live v6-only parser", () => {
    expect(parseAiContractAnalysis(clone()).ok).toBe(false);
  });

  it("is accepted by persisted version dispatch as v5", () => {
    const parsed = parsePersistedAiContractAnalysis(clone(), LEGACY_AI_OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.analysis.schemaVersion).toBe(LEGACY_AI_OUTPUT_SCHEMA_VERSION);
  });

  it("never synthesizes an accountingLabel on load", () => {
    const parsed = parsePersistedAiContractAnalysis(clone(), LEGACY_AI_OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.analysis.promises[0]).not.toHaveProperty("accountingLabel");
    expect(parsed.analysis.performanceObligations[0]).not.toHaveProperty("accountingLabel");
    expect(JSON.stringify(parsed.analysis)).not.toMatch(/accountingLabel/);
  });

  it("fails closed when the recorded version is v6 but the payload is v5", () => {
    expect(parsePersistedAiContractAnalysis(clone(), AI_OUTPUT_SCHEMA_VERSION).ok).toBe(false);
  });

  it("fails closed for unknown and malformed persisted versions", () => {
    const unknown = clone();
    unknown["schemaVersion"] = "arc.ai.schema.v4";
    expect(parsePersistedAiContractAnalysis(unknown, "arc.ai.schema.v4").ok).toBe(false);

    const malformed = clone();
    delete malformed["schemaVersion"];
    expect(parsePersistedAiContractAnalysis(malformed).ok).toBe(false);

    const extraneous = clone();
    (extraneous["promises"] as Array<Record<string, unknown>>)[0]!["unexpected"] = true;
    expect(parsePersistedAiContractAnalysis(extraneous, LEGACY_AI_OUTPUT_SCHEMA_VERSION).ok).toBe(
      false,
    );
  });
});
