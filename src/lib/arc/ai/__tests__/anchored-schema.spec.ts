/**
 * Phase 9F — the provider-facing anchored schema.
 *
 * The wire schema replaces every internal citation node with a bounded
 * `anchorIds` array. The transform is structural (deep clone + node
 * replacement) and fails closed if the replacement count does not exactly
 * match an independent count of internal citation nodes.
 */

import { describe, expect, it } from "vitest";

import {
  AI_OUTPUT_SCHEMA_VERSION,
  aiAnchoredContractAnalysisJsonSchema,
  aiContractAnalysisJsonSchema,
  countCitationSchemaNodes,
  toAnchoredProviderSchema,
  type JsonSchema,
} from "../schema";

function walk(node: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => walk(entry, visit));
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  visit(record);
  for (const child of Object.values(record)) walk(child, visit);
}

function citationNodes(): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  walk(aiAnchoredContractAnalysisJsonSchema, (record) => {
    const properties = record["properties"] as Record<string, unknown> | undefined;
    if (properties && "anchorIds" in properties && "documentId" in properties) found.push(record);
  });
  return found;
}

describe("anchored provider schema", () => {
  it("bumps the output schema version", () => {
    expect(AI_OUTPUT_SCHEMA_VERSION).toBe("arc.ai.schema.v5");
  });

  it("counts the internal citation nodes and replaces exactly that many", () => {
    const expected = countCitationSchemaNodes(aiContractAnalysisJsonSchema);
    expect(expected).toBeGreaterThan(0);
    expect(citationNodes()).toHaveLength(expected);
  });

  it("exposes no excerpt, anchorStart or anchorEnd anywhere", () => {
    const serialized = JSON.stringify(aiAnchoredContractAnalysisJsonSchema);
    expect(serialized).not.toContain("excerpt");
    expect(serialized).not.toContain("anchorStart");
    expect(serialized).not.toContain("anchorEnd");
  });

  it("requires anchorIds with 0 to 3 items", () => {
    const nodes = citationNodes();
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node["additionalProperties"]).toBe(false);
      expect(node["required"]).toEqual([
        "documentId",
        "pageStart",
        "pageEnd",
        "evidenceMode",
        "anchorIds",
      ]);
      const anchorIds = (node["properties"] as Record<string, JsonSchema>)["anchorIds"]!;
      expect(anchorIds["type"]).toBe("array");
      expect(anchorIds["minItems"]).toBe(0);
      expect(anchorIds["maxItems"]).toBe(3);
    }
  });

  it("rejects four anchor ids and accepts up to three", () => {
    const node = citationNodes()[0]!;
    const anchorIds = (node["properties"] as Record<string, JsonSchema>)["anchorIds"]!;
    const accepts = (count: number) =>
      count >= (anchorIds["minItems"] as number) && count <= (anchorIds["maxItems"] as number);
    expect(accepts(0)).toBe(true);
    expect(accepts(3)).toBe(true);
    expect(accepts(4)).toBe(false);
  });

  it("does not mutate the internal schema", () => {
    const before = JSON.stringify(aiContractAnalysisJsonSchema);
    toAnchoredProviderSchema(aiContractAnalysisJsonSchema);
    expect(JSON.stringify(aiContractAnalysisJsonSchema)).toBe(before);
    expect(before).toContain("excerpt");
  });

  it("fails closed when a schema contains no citation nodes", () => {
    expect(() =>
      toAnchoredProviderSchema({ type: "object", properties: {}, required: [] }),
    ).toThrow(/citation/i);
  });

  it("fails closed when a citation-shaped node cannot be replaced", () => {
    const mismatched: JsonSchema = {
      type: "object",
      properties: {
        citations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              documentId: { type: "string" },
              pageStart: { type: "integer" },
              pageEnd: { type: "integer" },
              evidenceMode: { type: "string", enum: ["text", "visual"] },
              excerpt: { type: ["string", "null"] },
              rogue: { type: "string" },
            },
            required: ["documentId", "pageStart", "pageEnd", "evidenceMode", "excerpt", "rogue"],
            additionalProperties: false,
          },
        },
      },
      required: ["citations"],
      additionalProperties: false,
    };
    expect(() => toAnchoredProviderSchema(mismatched)).toThrow(/parity|unexpected/i);
  });
});
