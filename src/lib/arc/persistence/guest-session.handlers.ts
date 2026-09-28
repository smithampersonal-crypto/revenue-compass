/**
 * Package 3D-T — browser sessions that own several temporary analyses.
 *
 * The HttpOnly cookie now carries a *session* credential. Each temporary
 * analysis (one `guest_workspaces` row) is authorized by its own credential,
 * HMAC(session credential, analysis id), derived here on every request and
 * never stored or sent; the row holds only its SHA-256 hash, exactly like the
 * pre-3D-T single-workspace credential. Every downstream handler therefore
 * keeps receiving "a credential" and hashing it unchanged.
 *
 * Legacy rows (created before 3D-T, credential = the cookie itself) are
 * wrapped in a session and re-keyed lazily and atomically the first time they
 * are opened.
 */

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  createGuestToken,
  deriveAnalysisToken,
  guestExpiresAt,
  hashGuestToken,
  isAnalysisId,
  isGuestExpired,
} from "./guest";
import type { GuestRow } from "./guest.handlers";
import { ARC_WORKFLOW_SCHEMA_VERSION, toCanonicalInputs } from "./schema";

export interface GuestSessionRef {
  id: string;
  expiresAt: string;
}

export interface GuestAnalysisRow {
  id: string;
  session_id: string | null;
  credential_kind: "legacy" | "derived" | string;
  token_hash: string;
  status: string;
  expires_at: string;
}

export interface GuestAnalysisSummaryRow {
  id: string;
  origin: string;
  draft_json: unknown;
  updated_at: string;
  expires_at: string;
  /** Display name of the first selected source document, if any. */
  firstSourceName: string | null;
  /** Stages of this analysis's AI runs. */
  runStages: string[];
  /** Raw persisted review payload, normalized by the caller-supplied reader. */
  reviewItems: unknown;
}

export interface GuestSessionStore {
  /** Resolves (lazily wrapping a legacy workspace) a live session by credential hash. */
  resolveSession(sessionHash: string): Promise<GuestSessionRef | null>;
  createSession(row: { token_hash: string; expires_at: string }): Promise<GuestSessionRef | null>;
  findAnalysis(id: string): Promise<GuestAnalysisRow | null>;
  upgradeLegacy(args: {
    sessionHash: string;
    workspaceId: string;
    newTokenHash: string;
  }): Promise<boolean>;
  insertAnalysis(row: {
    id: string;
    session_id: string;
    credential_kind: "derived";
    origin: string;
    token_hash: string;
    draft_json: unknown;
    schema_version: string;
    expires_at: string;
  }): Promise<GuestRow | null>;
  /** Active, unexpired analyses of the session only. No cap. */
  listSummaries(sessionId: string, now: Date): Promise<GuestAnalysisSummaryRow[]>;
}

export interface GuestSessionDeps {
  store: GuestSessionStore;
  now(): Date;
  newToken?: () => string;
  newId?: () => string;
}

/* -------------------------------------------------------------- resolve -- */

/**
 * The credential for one temporary analysis, or null when the cookie session
 * does not own it. Ownership is proven by the session link *and* the hash of
 * the derived credential; the analysis id alone never authorizes anything.
 */
export async function resolveAnalysisToken(
  deps: GuestSessionDeps,
  input: { sessionToken: string | null; analysisId: unknown },
): Promise<string | null> {
  if (!input.sessionToken || !isAnalysisId(input.analysisId)) return null;
  const analysisId = input.analysisId.toLowerCase();

  const sessionHash = await hashGuestToken(input.sessionToken);
  const session = await deps.store.resolveSession(sessionHash);
  if (!session) return null;

  const row = await deps.store.findAnalysis(analysisId);
  if (!row || row.session_id !== session.id) return null;

  const derived = await deriveAnalysisToken(input.sessionToken, analysisId);
  const derivedHash = await hashGuestToken(derived);

  if (row.credential_kind === "derived") {
    return row.token_hash === derivedHash ? derived : null;
  }

  // Legacy row: its credential is the session cookie itself.
  if (row.token_hash !== sessionHash) return null;
  if (row.status !== "active") {
    // A legacy row that was already saved keeps its original credential so
    // the idempotent save-retry path can still return the committed result.
    return input.sessionToken;
  }
  const upgraded = await deps.store.upgradeLegacy({
    sessionHash,
    workspaceId: analysisId,
    newTokenHash: derivedHash,
  });
  return upgraded ? derived : null;
}

/* --------------------------------------------------------------- create -- */

export type NewAnalysisOrigin = "blank" | "upload" | `sample:${string}`;

const SAMPLE_ORIGIN = /^sample:[a-z0-9-]{1,40}$/;

export function isNewAnalysisOrigin(value: unknown): value is NewAnalysisOrigin {
  return (
    value === "blank" || value === "upload" || (typeof value === "string" && SAMPLE_ORIGIN.test(value))
  );
}

export interface CreateAnalysisResult {
  analysisId: string;
  /** A new session credential for the cookie; null when the live session was reused. */
  issuedToken: string | null;
}

/**
 * Creates exactly one temporary analysis. Only ever reached from an explicit
 * button (a POST mutation); a live session and its remaining allowance are
 * reused, and a new session starts only when there is no live one.
 */
export async function createAnalysisHandler(
  deps: GuestSessionDeps,
  input: { sessionToken: string | null; origin: NewAnalysisOrigin; draft: WorkflowDraft | null },
): Promise<CreateAnalysisResult> {
  const now = deps.now();
  let sessionToken = input.sessionToken;
  let issuedToken: string | null = null;
  let session = sessionToken ? await deps.store.resolveSession(await hashGuestToken(sessionToken)) : null;

  if (!session || isGuestExpired(session.expiresAt, now)) {
    sessionToken = (deps.newToken ?? createGuestToken)();
    issuedToken = sessionToken;
    session = await deps.store.createSession({
      token_hash: await hashGuestToken(sessionToken),
      expires_at: guestExpiresAt(now),
    });
    if (!session) throw new Error("A temporary analysis could not be started.");
  }

  const analysisId = (deps.newId ?? (() => globalThis.crypto.randomUUID()))().toLowerCase();
  const token = await deriveAnalysisToken(sessionToken!, analysisId);
  const created = await deps.store.insertAnalysis({
    id: analysisId,
    session_id: session.id,
    credential_kind: "derived",
    origin: input.origin,
    token_hash: await hashGuestToken(token),
    draft_json: toCanonicalInputs(input.draft ?? createEmptyDraft()) as unknown,
    schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    // The analysis dies with its session, never later.
    expires_at: session.expiresAt,
  });
  if (!created) throw new Error("A temporary analysis could not be started.");

  return { analysisId, issuedToken };
}

/* ----------------------------------------------------------------- list -- */

export type RecentAnalysisStatus = "Analysis in progress" | "Review needed" | "Not analyzed" | "Draft";

export interface RecentAnalysisDto {
  analysisId: string;
  label: string;
  source: string;
  status: RecentAnalysisStatus;
  updatedAt: string;
  expiresAt: string;
}

const TERMINAL_STAGES = new Set([
  "succeeded",
  "preflight_failed",
  "api_failed",
  "response_invalid",
  "application_failed",
]);

export function recentAnalysisStatus(input: {
  origin: string;
  hasSource: boolean;
  runStages: string[];
  reviewNeeded: boolean;
}): RecentAnalysisStatus {
  if (input.runStages.some((stage) => !TERMINAL_STAGES.has(stage))) return "Analysis in progress";
  if (input.reviewNeeded) return "Review needed";
  const succeeded = input.runStages.includes("succeeded");
  if (!input.hasSource && !succeeded && !input.origin.startsWith("sample:")) return "Not analyzed";
  return "Draft";
}

function customerNameOf(draftJson: unknown): string {
  const contract = (draftJson as { contract?: { customerName?: unknown } } | null)?.contract;
  const name = typeof contract?.customerName === "string" ? contract.customerName.trim() : "";
  return name;
}

export async function listRecentAnalysesHandler(
  deps: GuestSessionDeps & {
    reviewNeeded(raw: unknown): boolean;
    sampleLabel(origin: string): string | null;
  },
  input: { sessionToken: string | null },
): Promise<RecentAnalysisDto[]> {
  if (!input.sessionToken) return [];
  const session = await deps.store.resolveSession(await hashGuestToken(input.sessionToken));
  if (!session) return [];
  const now = deps.now();
  const rows = await deps.store.listSummaries(session.id, now);
  return rows
    .filter((row) => !isGuestExpired(row.expires_at, now))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map((row) => {
      const sample = row.origin.startsWith("sample:") ? deps.sampleLabel(row.origin) : null;
      return {
        analysisId: row.id,
        label: customerNameOf(row.draft_json) || "Untitled analysis",
        source: row.firstSourceName ?? (sample ? `Sample — ${sample}` : "No source document"),
        status: recentAnalysisStatus({
          origin: row.origin,
          hasSource: row.firstSourceName !== null,
          runStages: row.runStages,
          reviewNeeded: deps.reviewNeeded(row.reviewItems),
        }),
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      };
    });
}
