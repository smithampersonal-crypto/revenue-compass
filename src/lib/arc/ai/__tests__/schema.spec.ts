import { describe, expect, it } from "vitest";

import {
  AI_OUTPUT_SCHEMA_VERSION,
  AI_REVIEW_STATES,
  FORBIDDEN_ENGINE_OUTPUT_KEYS,
  FORBIDDEN_MODEL_IDENTITY_KEYS,
  aiContractAnalysisJsonSchema,
  aiContractAnalysisSchema,
  collectCitations,
  collectGuidanceIds,
  parseAiContractAnalysis,
} from "../schema";

import { validAnalysisFixture } from "./analysis-fixture";

type JsonSchema = Record<string, unknown>;

function walkObjects(node: unknown, visit: (object: JsonSchema) => void): void {
  if (Array.isArray(node)) {
    for (const entry of node) walkObjects(entry, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as JsonSchema;
  if (record["type"] === "object") visit(record);
  for (const value of Object.values(record)) walkObjects(value, visit);
}

describe("AiContractAnalysis schema", () => {
  it("accepts a complete valid analysis", () => {
    const result = parseAiContractAnalysis(validAnalysisFixture());
    expect(result.ok).toBe(true);
  });

  it("pins the output schema version to the 9C constant", () => {
    expect(AI_OUTPUT_SCHEMA_VERSION).toBe("arc.ai.schema.v2");
  });

  it("accepts only the authoritative schema version literal", () => {
    const good = validAnalysisFixture();
    good.schemaVersion = "arc.ai.schema.v2";
    expect(parseAiContractAnalysis(good).ok).toBe(true);

    for (const wrong of ["arc.ai.schema.fake", "arc.ai.schema.v1", ""]) {
      const bad = validAnalysisFixture() as unknown as { schemaVersion: string };
      bad.schemaVersion = wrong;
      expect(parseAiContractAnalysis(bad).ok).toBe(false);
    }
  });

  it("emits the version literal as a single-value enum on the wire", () => {
    const properties = aiContractAnalysisJsonSchema["properties"] as Record<string, JsonSchema>;
    expect(properties["schemaVersion"]).toEqual({
      type: "string",
      enum: [AI_OUTPUT_SCHEMA_VERSION],
    });
  });

  it("exposes exactly the five approved review states and no confidence score", () => {
    expect([...AI_REVIEW_STATES]).toEqual([
      "supported",
      "inference",
      "needs_review",
      "source_conflict",
      "needs_user_input",
    ]);
    expect(JSON.stringify(aiContractAnalysisJsonSchema)).not.toMatch(/confidence/i);
  });

  it("is strict everywhere: every object lists all properties and forbids extras", () => {
    let objects = 0;
    walkObjects(aiContractAnalysisJsonSchema, (object) => {
      objects += 1;
      expect(object["additionalProperties"]).toBe(false);
      const properties = Object.keys(object["properties"] as JsonSchema);
      expect(new Set(object["required"] as string[])).toEqual(new Set(properties));
    });
    expect(objects).toBeGreaterThan(15);
  });

  it("never exposes an unbounded free-form object or record", () => {
    walkObjects(aiContractAnalysisJsonSchema, (object) => {
      expect(Object.keys(object["properties"] as JsonSchema).length).toBeGreaterThan(0);
    });
  });

  it("bounds every array and string", () => {
    const check = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(check);
        return;
      }
      if (node === null || typeof node !== "object") return;
      const record = node as JsonSchema;
      if (record["type"] === "array") expect(record["maxItems"]).toBeTypeOf("number");
      const type = record["type"];
      const isString =
        type === "string" || (Array.isArray(type) && (type as string[]).includes("string"));
      if (isString && !record["enum"]) expect(record["maxLength"]).toBeTypeOf("number");
      Object.values(record).forEach(check);
    };
    check(aiContractAnalysisJsonSchema);
  });

  it("contains no ARC identity property and no deterministic engine output property", () => {
    const names = new Set<string>();
    walkObjects(aiContractAnalysisJsonSchema, (object) => {
      for (const key of Object.keys(object["properties"] as JsonSchema)) names.add(key);
    });
    for (const forbidden of FORBIDDEN_MODEL_IDENTITY_KEYS) expect(names.has(forbidden)).toBe(false);
    for (const forbidden of FORBIDDEN_ENGINE_OUTPUT_KEYS) expect(names.has(forbidden)).toBe(false);
  });

  it("expresses optionality as nullability, never as a missing property", () => {
    const analysis = validAnalysisFixture() as Record<string, unknown>;
    delete analysis["issues"];
    expect(parseAiContractAnalysis(analysis).ok).toBe(false);
  });

  it("rejects an unknown top-level property", () => {
    const analysis = { ...validAnalysisFixture(), revisionId: "rev-1" };
    expect(parseAiContractAnalysis(analysis).ok).toBe(false);
  });

  it("rejects pageEnd before pageStart", () => {
    const analysis = validAnalysisFixture();
    analysis.logicalDocuments[0]!.citations[0]!.pageEnd = 0;
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(false);
  });

  it("rejects a text citation with a null or blank excerpt", () => {
    const blank = validAnalysisFixture();
    blank.logicalDocuments[0]!.citations[0]!.excerpt = "   ";
    expect(aiContractAnalysisSchema.safeParse(blank).success).toBe(false);

    const missing = validAnalysisFixture();
    missing.logicalDocuments[0]!.citations[0]!.excerpt = null;
    expect(aiContractAnalysisSchema.safeParse(missing).success).toBe(false);
  });

  it("accepts a visual citation with a null excerpt", () => {
    const analysis = validAnalysisFixture();
    expect(analysis.transactionPrice.fixedConsiderationCitations[0]!.evidenceMode).toBe("visual");
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("rejects a non decimal-safe amount string", () => {
    const analysis = validAnalysisFixture();
    analysis.transactionPrice.fixedConsiderationInput = "245,000";
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(false);
  });

  it("rejects a zero or negative guidance id", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.guidanceIds = [0];
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(false);
  });

  it("bounds semantic keys to 120 characters", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.semanticKey = "p".repeat(121);
    expect(aiContractAnalysisSchema.safeParse(analysis).success).toBe(false);
  });

  it("collects every citation and guidance reference for downstream validation", () => {
    const analysis = validAnalysisFixture();
    expect(collectCitations(analysis).length).toBeGreaterThan(15);
    expect(collectGuidanceIds(analysis).length).toBeGreaterThan(10);
    expect(collectCitations(analysis).every((entry) => entry.path.length > 0)).toBe(true);
  });
});
