/**
 * Deterministic Master Guidance workbook compiler.
 *
 * guidance/Revenue_Compass_ASC606_Master_Library.xlsx  (human accounting source)
 *   -> src/lib/arc/guidance/registry.generated.ts       (machine runtime source)
 *
 * This script is development-only tooling: it uses `exceljs`, `node:fs` and
 * `node:crypto`, none of which may ever enter the browser bundle. Runtime code
 * imports the generated registry, never this file.
 *
 *   bun scripts/compile-guidance-registry.ts            write the registry
 *   bun scripts/compile-guidance-registry.ts --check    fail if it is stale
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";

import { getGuidancePolicy, POLICY_CARD_IDS, referencedPolicyIds } from "../src/lib/arc/guidance/policy";
import type { GuidanceCard } from "../src/lib/arc/guidance/types";

export const GUIDANCE_REGISTRY_VERSION = "arc.guidance.v1";

export const WORKBOOK_PATH = "guidance/Revenue_Compass_ASC606_Master_Library.xlsx";
export const GENERATED_PATH = "src/lib/arc/guidance/registry.generated.ts";
export const CARDS_SHEET = "Guidance Cards";

/** The exact Guidance Cards headers, in order. */
export const GUIDANCE_HEADERS = [
  "Item No.",
  "Topic",
  "Subtopic",
  "Primary ASC Reference",
  "Related ASC References",
  "Rule Summary",
  "Decision Criteria",
  "Facts Required",
  "Important Nuances",
  "When Relevant",
  "AI May Propose",
  "Accountant Must Approve",
  "Revenue Compass Engine Behavior",
  "Interpretive Source",
  "Source URL(s)",
  "Retrieval Tags",
  "Status",
  "Last Reviewed",
] as const;

export type RawCell = string | number | Date | null | undefined;
export type RawRow = readonly RawCell[];

const REVIEW_SECTION_TOPIC: Record<string, string> = {
  "Step 1": "step_1",
  "Step 2": "step_2",
  "Step 3": "step_3",
  "Step 4": "step_4",
  "Step 5": "step_5",
  "Special Topics / Industry Applications": "additional_topics",
};

function text(value: RawCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "number") return String(value);
  return value;
}

function isoDate(value: RawCell): string {
  if (value instanceof Date) {
    return [
      String(value.getUTCFullYear()).padStart(4, "0"),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0"),
    ].join("-");
  }
  const raw = text(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) {
    throw new Error(`Malformed Last Reviewed value: ${JSON.stringify(raw)}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** NFKC + lowercase + whitespace collapse + trim. */
export function normalizeTag(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitTags(value: RawCell): string[] {
  const parts = text(value)
    .split(/[\n,;]+/)
    .map(normalizeTag)
    .filter((part) => part.length > 0);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) {
      throw new Error(`Duplicate normalized retrieval tag: ${JSON.stringify(part)}`);
    }
    seen.add(part);
    unique.push(part);
  }
  return unique;
}

function splitUrls(value: RawCell): string[] {
  return text(value)
    .split(/[\n\r]+/)
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Canonical, field-ordered serialization used for the per-card hash. */
function canonicalCard(card: Omit<GuidanceCard, "contentHash">): string {
  return JSON.stringify([
    card.id,
    card.topic,
    card.subtopic,
    card.primaryAscReference,
    card.relatedAscReferences,
    card.ruleSummary,
    card.decisionCriteria,
    card.factsRequired,
    card.importantNuances,
    card.whenRelevant,
    card.aiMayPropose,
    card.accountantMustApprove,
    card.engineBehavior,
    card.interpretiveSource,
    card.sourceUrls,
    card.retrievalTags,
    card.status,
    card.lastReviewed,
  ]);
}

export interface CompiledRegistry {
  version: string;
  hash: string;
  cards: GuidanceCard[];
}

/** Compiles validated header + data rows into the deterministic registry. */
export function compileRegistry(headers: readonly RawCell[], rows: readonly RawRow[]): CompiledRegistry {
  const actual = headers.map((cell) => text(cell).trim());
  GUIDANCE_HEADERS.forEach((expected, index) => {
    if (actual[index] !== expected) {
      throw new Error(
        `Missing or misordered required header at column ${index + 1}: expected ${JSON.stringify(
          expected,
        )}, found ${JSON.stringify(actual[index] ?? "")}.`,
      );
    }
  });

  const cards: GuidanceCard[] = [];
  const seenIds = new Set<number>();

  for (const row of rows) {
    const rawId = row[0];
    const status = text(row[16]).trim();
    if (status === "") continue; // blank spacer row
    if (status !== "Approved" && status !== "Draft" && status !== "Retired") {
      throw new Error(`Invalid Status value: ${JSON.stringify(status)}`);
    }
    if (status !== "Approved") continue; // non-authoritative card

    const id = typeof rawId === "number" ? rawId : Number(text(rawId).trim());
    if (!Number.isInteger(id) || id < 1) {
      throw new Error(`Invalid Item No.: ${JSON.stringify(text(rawId))}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate Item No.: ${id}`);
    }
    seenIds.add(id);

    const base: Omit<GuidanceCard, "contentHash"> = {
      id,
      topic: text(row[1]).trim(),
      subtopic: text(row[2]).trim(),
      primaryAscReference: text(row[3]).trim(),
      relatedAscReferences: text(row[4]).trim(),
      ruleSummary: text(row[5]),
      decisionCriteria: text(row[6]),
      factsRequired: text(row[7]),
      importantNuances: text(row[8]),
      whenRelevant: text(row[9]),
      aiMayPropose: text(row[10]),
      accountantMustApprove: text(row[11]),
      engineBehavior: text(row[12]),
      interpretiveSource: text(row[13]),
      sourceUrls: splitUrls(row[14]),
      retrievalTags: splitTags(row[15]),
      status: "Approved",
      lastReviewed: isoDate(row[17]),
    };

    for (const [field, value] of Object.entries(base)) {
      if (typeof value === "string" && value.trim() === "") {
        throw new Error(`Malformed Approved row ${id}: empty required field ${field}.`);
      }
    }
    if (base.retrievalTags.length === 0) {
      throw new Error(`Malformed Approved row ${id}: no retrieval tags.`);
    }
    if (!REVIEW_SECTION_TOPIC[base.topic]) {
      throw new Error(`Malformed Approved row ${id}: unknown Topic ${JSON.stringify(base.topic)}.`);
    }

    cards.push({ ...base, contentHash: sha256(canonicalCard(base)) });
  }

  cards.sort((a, b) => a.id - b.id);

  // Every Approved card must resolve to reviewed machine policy, and that
  // policy must agree with the workbook's own topic placement.
  const known = new Set(cards.map((card) => card.id));
  for (const card of cards) {
    const policy = getGuidancePolicy(card.id);
    if (policy.reviewSection !== REVIEW_SECTION_TOPIC[card.topic]) {
      throw new Error(
        `Policy review section for card ${card.id} (${policy.reviewSection}) does not match workbook topic ${card.topic}.`,
      );
    }
    for (const related of policy.relatedGuidanceIds) {
      if (!known.has(related)) {
        throw new Error(`Card ${card.id} policy references nonexistent guidance card ${related}.`);
      }
    }
  }
  for (const id of referencedPolicyIds()) {
    if (!known.has(id)) {
      throw new Error(`ARC machine policy references nonexistent guidance card ${id}.`);
    }
  }
  for (const id of POLICY_CARD_IDS) {
    if (!known.has(id)) {
      throw new Error(`Policy covers card ${id}, which the workbook does not contain.`);
    }
  }

  const hash = sha256(
    JSON.stringify([GUIDANCE_REGISTRY_VERSION, cards.map((card) => [card.id, card.contentHash])]),
  );

  return { version: GUIDANCE_REGISTRY_VERSION, hash, cards };
}

export function renderRegistryModule(registry: CompiledRegistry): string {
  return `// GENERATED — DO NOT EDIT
// Source: ${WORKBOOK_PATH}
// Regenerate with: bun run guidance:compile
import type { GuidanceCard } from "./types";

export const GUIDANCE_REGISTRY_VERSION = ${JSON.stringify(registry.version)};
export const GUIDANCE_REGISTRY_HASH = ${JSON.stringify(registry.hash)};
export const GUIDANCE_REGISTRY_CARD_COUNT = ${registry.cards.length};

export const GUIDANCE_CARDS: readonly GuidanceCard[] = ${JSON.stringify(registry.cards, null, 2)};
`;
}

export async function readWorkbook(
  filePath: string,
): Promise<{ headers: RawCell[]; rows: RawRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(filePath));
  const sheet = workbook.getWorksheet(CARDS_SHEET);
  if (!sheet) {
    throw new Error(`Workbook is missing the ${CARDS_SHEET} worksheet.`);
  }
  const cell = (row: number, column: number): RawCell => {
    const value = sheet.getRow(row).getCell(column).value;
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === "number" || typeof value === "string") return value;
    if (typeof value === "object" && "richText" in value) {
      return (value.richText as Array<{ text: string }>).map((part) => part.text).join("");
    }
    if (typeof value === "object" && "text" in value) return String(value.text);
    if (typeof value === "object" && "result" in value) return String(value.result ?? "");
    return String(value);
  };
  const headers = GUIDANCE_HEADERS.map((_, index) => cell(2, index + 1));
  const rows: RawRow[] = [];
  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    rows.push(GUIDANCE_HEADERS.map((_, index) => cell(rowNumber, index + 1)));
  }
  return { headers, rows };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const checkOnly = process.argv.includes("--check");
  const { headers, rows } = await readWorkbook(path.join(root, WORKBOOK_PATH));
  const registry = compileRegistry(headers, rows);
  const rendered = renderRegistryModule(registry);
  const target = path.join(root, GENERATED_PATH);

  if (checkOnly) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      console.error("guidance:check — generated registry is missing. Run bun run guidance:compile.");
      process.exit(1);
    }
    if (current !== rendered) {
      console.error(
        "guidance:check — generated registry is stale. Run bun run guidance:compile and commit the result.",
      );
      process.exit(1);
    }
    console.log(
      `guidance:check — current: ${registry.cards.length} approved cards, hash ${registry.hash}.`,
    );
    return;
  }

  writeFileSync(target, rendered, "utf8");
  console.log(
    `guidance:compile — wrote ${registry.cards.length} approved cards, hash ${registry.hash}.`,
  );
}

const invokedDirectly = process.argv[1]?.includes("compile-guidance-registry");
if (invokedDirectly) {
  await main();
}
