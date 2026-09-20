/**
 * Phase 9G-R3 — deterministic deleted-object identity.
 *
 * A semantic key is an ephemeral model alias, so a tombstone keyed only by the
 * alias the model happened to use when the accountant deleted the object is
 * not enough: the next run can propose the SAME economic object under a new
 * name and ARC would resurrect what the accountant removed.
 *
 * A tombstone therefore carries the deterministic identity signature of the
 * object that was deleted, plus every alias it has ever been known by.
 *
 * Storage compatibility: these records live in the EXISTING `tombstones` jsonb
 * array. An entry is either a plain string (the historical shape, still
 * written for keys with no recorded identity) or an identity record object.
 * No database migration is required and older rows read unchanged.
 */

import { BILLING_COLLECTION_ID_PREFIX, BILLING_EVENT_ID_PREFIX } from "./billing-identity";
import {
  identityKindOfCanonicalId,
  type AiIdentityKind,
  type IdentitySignature,
} from "./reconciliation";

/**
 * Phase L. Deletion identity covers more canonical kinds than re-identification
 * does: the derived billing objects carry no independent economic identity of
 * their own — theirs is the billing SCHEDULE plus the deterministic schedule
 * period — but an accountant can delete them, and a deletion must survive a
 * model rename exactly like a promise deletion does.
 */
export type AiTombstoneKind = AiIdentityKind | "billing_event" | "billing_collection";

export interface AiTombstoneIdentity {
  /** The alias the object carried when it was deleted. */
  semanticKey: string;
  kind: AiTombstoneKind;
  signature: IdentitySignature;
  /** Every alias suppressed by this tombstone, including `semanticKey`. */
  aliases: readonly string[];
}

/**
 * The ONE classifier for deletion identity. R3 kinds keep their existing
 * meaning; the derived billing objects are classified by their canonical
 * prefixes and nothing else.
 */
export function tombstoneKindOfCanonicalId(canonicalId: string): AiTombstoneKind | null {
  const identityKind = identityKindOfCanonicalId(canonicalId);
  if (identityKind !== null) return identityKind;
  if (canonicalId.startsWith(BILLING_EVENT_ID_PREFIX)) return "billing_event";
  if (canonicalId.startsWith(BILLING_COLLECTION_ID_PREFIX)) return "billing_collection";
  return null;
}

const RECORD_MARKER = "arcTombstoneIdentity";
const KINDS: readonly AiTombstoneKind[] = [
  "promise",
  "performance_obligation",
  "variable_component",
  "billing_event",
  "billing_collection",
];

/** The persisted `tombstones` array: strings plus identity records. */
export function encodeTombstones(
  tombstones: readonly string[],
  identities: readonly AiTombstoneIdentity[],
): unknown[] {
  const covered = new Set(identities.flatMap((identity) => [...identity.aliases]));
  const plain = tombstones.filter((key) => !covered.has(key)).sort();
  const records = [...identities]
    .sort((left, right) => left.semanticKey.localeCompare(right.semanticKey))
    .map((identity) => ({
      [RECORD_MARKER]: 1,
      semanticKey: identity.semanticKey,
      kind: identity.kind,
      signature: {
        gate: identity.signature.gate,
        corroborators: [...identity.signature.corroborators],
      },
      aliases: [...identity.aliases].sort(),
    }));
  return [...plain, ...records];
}

function readRecord(value: unknown): AiTombstoneIdentity | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record[RECORD_MARKER] !== 1) return null;
  const semanticKey = record["semanticKey"];
  const kind = record["kind"];
  const signature = record["signature"];
  if (typeof semanticKey !== "string" || semanticKey === "") return null;
  if (typeof kind !== "string" || !KINDS.includes(kind as AiIdentityKind)) return null;
  if (signature === null || typeof signature !== "object") return null;
  const gate = (signature as Record<string, unknown>)["gate"];
  const corroborators = (signature as Record<string, unknown>)["corroborators"];
  if (typeof gate !== "string" || !Array.isArray(corroborators)) return null;
  const aliases = Array.isArray(record["aliases"])
    ? (record["aliases"] as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    semanticKey,
    kind: kind as AiIdentityKind,
    signature: {
      gate,
      corroborators: corroborators.map((entry) => (typeof entry === "string" ? entry : null)),
    },
    aliases: [...new Set([semanticKey, ...aliases])].sort(),
  };
}

/**
 * Reads a persisted `tombstones` array of any vintage. Unreadable entries are
 * ignored rather than trusted; every alias a record suppresses is also
 * returned as a plain tombstone so key-level suppression never weakens.
 */
export function decodeTombstones(raw: unknown): {
  tombstones: string[];
  tombstoneIdentities: AiTombstoneIdentity[];
} {
  if (!Array.isArray(raw)) return { tombstones: [], tombstoneIdentities: [] };
  const tombstones = new Set<string>();
  const tombstoneIdentities: AiTombstoneIdentity[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      tombstones.add(entry);
      continue;
    }
    const record = readRecord(entry);
    if (record === null) continue;
    tombstoneIdentities.push(record);
    for (const alias of record.aliases) tombstones.add(alias);
  }
  return {
    tombstones: [...tombstones].sort(),
    tombstoneIdentities: tombstoneIdentities.sort((left, right) =>
      left.semanticKey.localeCompare(right.semanticKey),
    ),
  };
}
