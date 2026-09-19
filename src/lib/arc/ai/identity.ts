/**
 * Phase 9E — Task 10A. Deterministic identity and value fingerprints.
 *
 * Pure and browser-safe: no crypto randomness, no `Date.now()`, no
 * `Math.random()`, no UUIDs, no environment access, no array-index identity.
 * The same semantic input always produces the same canonical ID and the same
 * fingerprint, in any order, in any process.
 *
 * Terra's semantic keys are never authoritative ARC identities. They are only
 * the deterministic INPUT to the ID derivation below; ARC owns the result.
 */

/** Canonical object kinds ARC may create from an AI semantic object. */
export type AiObjectKind =
  | "promise"
  | "performance_obligation"
  | "variable_component"
  | "modification"
  | "consideration_event"
  | "cash_collection";

const ID_PREFIX: Record<AiObjectKind, string> = {
  promise: "pr",
  performance_obligation: "po",
  variable_component: "vc",
  modification: "mod",
  consideration_event: "ce",
  cash_collection: "cc",
};

/**
 * FNV-1a (32-bit, doubled) expressed with `Math.imul` so the result is exact
 * in every JavaScript engine. Not cryptographic — collision resistance
 * appropriate for edit detection and debug-readable IDs is all that is needed.
 */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 16-character lowercase hex digest over a string. */
export function stableHash(input: string): string {
  const low = fnv1a(input, 0x811c9dc5);
  const high = fnv1a(`\u0001${input}\u0001`, 0x7f4a7c15);
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

/**
 * Canonical JSON: object keys are emitted in sorted order so key ordering can
 * never change a fingerprint. Arrays keep their order because array order is
 * meaningful data — but array POSITION is never used as identity anywhere in
 * the adapter.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "nan";
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/**
 * Deterministic fingerprint of a semantic value. Used to decide whether a
 * canonical value still equals the value ARC last received from AI.
 */
export function valueFingerprint(value: unknown): string {
  return stableHash(canonicalJson(value));
}

/** A short, readable, deterministic slug. Never used alone as identity. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "item";
}

/**
 * Derives a canonical ARC ID from the object kind and the Terra semantic key.
 * Readable for debugging, with a deterministic collision-resistant suffix.
 */
export function deriveCanonicalId(kind: AiObjectKind, semanticKey: string): string {
  return `${ID_PREFIX[kind]}-${slugify(semanticKey)}-${stableHash(`${kind}\u0000${semanticKey}`).slice(0, 8)}`;
}

/**
 * Resolves a derived ID against IDs already in use (including every manual
 * object's ID, which is never rewritten). Resolution is deterministic: the
 * same candidate against the same taken set always yields the same result.
 */
export function resolveUniqueId(candidate: string, taken: ReadonlySet<string>): string {
  if (!taken.has(candidate)) return candidate;
  let attempt = 2;
  while (taken.has(`${candidate}-${attempt}`)) attempt += 1;
  return `${candidate}-${attempt}`;
}

/* ------------------------------------------------------- stable field keys */

/**
 * Stable, reorder-safe provenance keys. Array indexes are deliberately never
 * part of a key: reordering promises must not transfer field ownership.
 */
export const fieldKeys = {
  contract: (field: string) => `contract.${field}`,
  criterion: (criterionId: string) => `contract.criteria.${criterionId}.answer`,
  criterionRationale: (criterionId: string) => `contract.criteria.${criterionId}.rationale`,
  transactionPrice: (field: string) => `transactionPrice.${field}`,
  promise: (canonicalId: string, field: string) => `promise:${canonicalId}.${field}`,
  po: (canonicalId: string, field: string) => `po:${canonicalId}.${field}`,
  vc: (canonicalId: string, field: string) => `vc:${canonicalId}.${field}`,
  modification: (canonicalId: string, field: string) => `modification:${canonicalId}.${field}`,
  billing: (canonicalId: string, field: string) => `billing:${canonicalId}.${field}`,
  cash: (canonicalId: string, field: string) => `cash:${canonicalId}.${field}`,
  structural: (field: string) => `draft.${field}`,
  topic: (topic: string) => `additionalTopic:${topic}`,
  issue: (semanticKey: string) => `issue:${semanticKey}`,
} as const;

/**
 * Phase 9G-R Task R2. The single consolidated provisional standalone-selling-
 * price judgment. It is a real canonical composite target: Task 4 fingerprints
 * the whole Step 4 SSP workpaper behind it, never a synthetic null.
 */
export const PROVISIONAL_SSP_TARGET_KEY = "step4.provisionalSsp";
