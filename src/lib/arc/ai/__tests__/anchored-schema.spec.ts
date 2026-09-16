/**
 * Phase 9F — the provider-facing anchored schema.
 *
 * The wire schema replaces every internal citation node with an anchor
 * selector. The transform is structural (deep clone + node replacement) and
 * fails closed if the replacement count does not exactly match an independent
 * count of internal citation nodes.
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

describe("anchored provider schema", () => {
  it("bumps the output schema version", () => {
    expect(AI_OUTPUT_SCHEMA_VERSION).toBe("arc.ai.schema.v2");
  });

  it("counts the internal citation nodes and replaces exactly that many", () => {
    const expected = countCitationSchemaNodes(aiContractAnalysisJsonSchema);
    expect(expected).toBeGreaterThan(0);

    let anchored = 0;
    walk(aiAnchoredContractAnalysisJsonSchema, (record) => {
      const properties = record["properties"] as Record<string, unknown> | undefined;
      if (properties && "anchorStart" in properties && "documentId" in properties) anchored += 1;
    });
    expect(anchored).toBe(expected);
  });

  it("leaves no provider-facing excerpt anywhere", () => {
    walk(aiAnchoredContractAnalysisJsonSchema, (record) => {
      const properties = record["properties"] as Record<string, unknown> | undefined;
      if (properties) expect("excerpt" in properties).toBe(false);
    });
  });

  it("makes anchorStart and anchorEnd required but nullable", () => {
    let checked = 0;
    walk(aiAnchoredContractAnalysisJsonSchema, (record) => {
      const properties = record["properties"] as Record<string, JsonSchema> | undefined;
      if (!properties || !("anchorStart" in properties)) return;
      checked += 1;
      expect(record["additionalProperties"]).toBe(false);
      expect(record["required"]).toEqual([
        "documentId",
        "pageStart",
        "pageEnd",
        "evidenceMode",
        "anchorStart",
        "anchorEnd",
      ]);
      for (const key of ["anchorStart", "anchorEnd"] as const) {
        expect(properties[key]!["type"]).toEqual(["string", "null"]);
      }
    });
    expect(checked).toBeGreaterThan(0);
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
    // A node that the independent counter sees but that carries an unexpected
    // extra property must abort the whole transform rather than ship partly
    // transformed.
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
