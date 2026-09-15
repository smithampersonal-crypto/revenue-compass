import { describe, expect, it } from "vitest";

import {
  compileRegistry,
  GUIDANCE_HEADERS,
  normalizeTag,
  renderRegistryModule,
  type RawRow,
} from "../../../../../scripts/compile-guidance-registry";

const HEADERS = [...GUIDANCE_HEADERS];
const NO_COVERAGE = { enforcePolicyCoverage: false } as const;

function row(overrides: Partial<Record<number, unknown>> = {}, id = 1): RawRow {
  const base: unknown[] = [
    id,
    "Step 1",
    "Contract Identification — Five Criteria",
    "ASC 606-10-25-1",
    "ASC 606-10-25-2",
    "Rule summary prose.",
    "Decision criteria prose.",
    "Facts required prose.",
    "Important nuances prose.",
    "When relevant prose.",
    "AI may propose prose.",
    "Accountant must approve prose.",
    "Engine behavior prose.",
    "FASB ASC",
    "https://asc.fasb.org/\n\nhttps://example.test/a",
    "step1, Contract Criteria , collectibility",
    "Approved",
    new Date(Date.UTC(2026, 8, 5)),
  ];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base as RawRow;
}

describe("guidance registry compiler", () => {
  it("rejects a duplicate Item No.", () => {
    expect(() => compileRegistry(HEADERS, [row({}, 1), row({}, 1)], NO_COVERAGE)).toThrow(
      /Duplicate Item No/,
    );
  });

  it("rejects an invalid, non-numeric Item No.", () => {
    expect(() => compileRegistry(HEADERS, [row({ 0: "one" })], NO_COVERAGE)).toThrow(
      /Invalid Item No/,
    );
  });

  it("rejects a missing required header", () => {
    const broken: string[] = [...HEADERS];
    broken[15] = "Tags";
    expect(() => compileRegistry(broken, [row()], NO_COVERAGE)).toThrow(
      /required header at column 16/,
    );
  });

  it("rejects a malformed Approved row", () => {
    expect(() => compileRegistry(HEADERS, [row({ 5: "   " })], NO_COVERAGE)).toThrow(
      /empty required field/,
    );
  });

  it("rejects an invalid Status value", () => {
    expect(() => compileRegistry(HEADERS, [row({ 16: "Final" })], NO_COVERAGE)).toThrow(
      /Invalid Status/,
    );
  });

  it("rejects duplicate normalized retrieval tags", () => {
    expect(() => compileRegistry(HEADERS, [row({ 15: "step1, STEP1" })], NO_COVERAGE)).toThrow(
      /Duplicate normalized retrieval tag/,
    );
  });

  it("excludes a Draft card from the authoritative registry", () => {
    expect(() => compileRegistry(HEADERS, [row({ 16: "Draft" })])).toThrow(
      /nonexistent guidance card 1/,
    );
  });

  it("normalizes retrieval tags and splits source URLs deterministically", () => {
    expect(normalizeTag("  Contract   Criteria ")).toBe("contract criteria");
    expect(normalizeTag("ＳＴＥＰ1")).toBe("step1");
  });

  it("rejects policy references to cards the workbook does not contain", () => {
    expect(() => compileRegistry(HEADERS, [row()])).toThrow(
      /ARC machine policy references nonexistent guidance card 3/,
    );
  });

  it("produces stable card and registry hashes for identical input", () => {
    const rows = [row()];
    const first = compileRegistry(HEADERS, rows, NO_COVERAGE);
    const second = compileRegistry(HEADERS, rows, NO_COVERAGE);
    expect(first.hash).toBe(second.hash);
    expect(first.cards[0]!.contentHash).toBe(second.cards[0]!.contentHash);
  });

  it("renders a generated module that is explicitly not hand-editable", () => {
    const rendered = renderRegistryModule({ version: "arc.guidance.v1", hash: "x", cards: [] });
    expect(rendered.startsWith("// GENERATED — DO NOT EDIT")).toBe(true);
  });
});
