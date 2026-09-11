/**
 * Phase 7E — the real guest-workspace logic, expressed as dependency-injected
 * handlers.
 *
 * The `createServerFn` wrappers in `guest.functions.ts` call these exact
 * functions; nothing is duplicated for tests. Authorization is always the
 * hashed credential from the HttpOnly cookie — the browser never supplies a
 * guest workspace id, and the raw token never leaves the cookie.
 */

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  createGuestToken,
  guestExpiresAt,
  hashGuestToken,
  isGuestExpired,
  validateMigrationRequest,
} from "./guest";
import {
  ARC_WORKFLOW_SCHEMA_VERSION,
  parseCanonicalInputs,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "./schema";

/* --------------------------------------------------------------- plumbing */

export interface GuestRow {
  id: string;
  draft_json: unknown;
  schema_version: string;
  lock_version: number;
  status: string;
  expires_at: string;
}

export interface GuestSaveRow {
  lock_version: number;
  updated_at: string;
}

/** The narrow, server-only store surface. Guest rows are never client-visible. */
export interface GuestStore {
  findByHash(tokenHash: string): Promise<GuestRow | null>;
  insert(row: {
    token_hash: string;
    draft_json: unknown;
    schema_version: string;
    expires_at: string;
  }): Promise<GuestRow | null>;
  updateDraft(args: {
    tokenHash: string;
    expectedLockVersion: number;
    canonical: unknown;
  }): Promise<GuestSaveRow | null>;
}

export interface RpcOutcome {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface GuestDeps {
  store: GuestStore;
  now(): Date;
  /** Overridable only so tests can pin the credential; production is random. */
  newToken?: () => string;
}

export interface GuestMigrationDeps extends GuestDeps {
  userId: string;
  /** Trusted, service-role-only guest → account transaction. */
  migrateTransaction(args: Record<string, unknown>): Promise<RpcOutcome>;
}

/** What the workspace needs to render and autosave a guest analysis. */
export interface GuestWorkspaceState {
  draft: WorkflowDraft;
  lockVersion: number;
  /** ISO stamp; the credential and the workspace both die at this moment. */
  expiresAt: string;
  schemaVersion: string;
}

export interface ResumeGuestResult {
  workspace: GuestWorkspaceState;
  /**
   * A newly minted credential that the caller must place in the HttpOnly
   * cookie. Null when an existing workspace was resumed.
   */
  issuedToken: string | null;
  resumed: boolean;
}

/* ----------------------------------------------------------- resume/create */

export async function resumeOrCreateGuestHandler(
  deps: GuestDeps,
  input: { token: string | null },
): Promise<ResumeGuestResult> {
  const now = deps.now();

  if (input.token) {
    const row = await deps.store.findByHash(await hashGuestToken(input.token));
    // Authorization checks expiry on every load, whatever cleanup has run.
    if (row && row.status === "active" && !isGuestExpired(row.expires_at, now)) {
      const parsed = parseCanonicalInputs(row.draft_json, row.schema_version);
      if (parsed.ok) {
        return {
          workspace: {
            draft: parsed.draft,
            lockVersion: row.lock_version,
            expiresAt: row.expires_at,
            schemaVersion: row.schema_version,
          },
          issuedToken: null,
          resumed: true,
        };
      }
    }
  }

  const token = (deps.newToken ?? createGuestToken)();
  const expiresAt = guestExpiresAt(now);
  const created = await deps.store.insert({
    token_hash: await hashGuestToken(token),
    draft_json: toCanonicalInputs(createEmptyDraft()) as unknown,
    schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    expires_at: expiresAt,
  });
  if (!created) throw new Error("A temporary workspace could not be started.");

  return {
    workspace: {
      draft: createEmptyDraft(),
      lockVersion: created.lock_version,
      expiresAt: created.expires_at,
      schemaVersion: created.schema_version,
    },
    issuedToken: token,
    resumed: false,
  };
}

/* ------------------------------------------------------------------ save -- */

export type GuestSaveResult =
  | { ok: true; lockVersion: number; savedAt: string }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "expired" };

export async function saveGuestDraftHandler(
  deps: GuestDeps,
  input: { token: string | null; expectedLockVersion: number; draft: unknown },
): Promise<GuestSaveResult> {
  if (!input.token) return { ok: false, reason: "expired" };

  // Typing is not validation: a malformed draft is never persisted.
  const validated = validateDraftForPersistence(input.draft);
  if (!validated.ok) throw new Error(validated.reason);

  const tokenHash = await hashGuestToken(input.token);
  const row = await deps.store.findByHash(tokenHash);
  if (!row || row.status !== "active" || isGuestExpired(row.expires_at, deps.now())) {
    return { ok: false, reason: "expired" };
  }

  const saved = await deps.store.updateDraft({
    tokenHash,
    expectedLockVersion: input.expectedLockVersion,
    canonical: toCanonicalInputs(validated.draft) as unknown,
  });
  // Same optimistic-lock contract as an owned draft revision (7C).
  if (!saved) return { ok: false, reason: "conflict" };

  return { ok: true, lockVersion: saved.lock_version, savedAt: saved.updated_at };
}

/* ------------------------------------------------------------- migration -- */

export type GuestMigrationResult =
  | {
      ok: true;
      customerId: string;
      contractId: string;
      analysisId: string;
      revisionId: string;
      /**
       * True when the transaction had already committed on an earlier attempt
       * whose response was lost: the same rows are returned, never new ones.
       */
      recovered: boolean;
    }
  | { ok: false; code: "expired" | "conflict" | "invalid" | "failed"; reason: string };

const EXPIRED_MESSAGE = "This temporary workspace has expired, so there is nothing to save.";
const FAILED_MESSAGE =
  "This analysis could not be saved to your account, so nothing was created. Your work is still here — please try again.";
const CONFLICT_MESSAGE =
  "This analysis changed after you confirmed the save, so nothing was created. Reopen the save and try again.";

export async function migrateGuestWorkspaceHandler(
  deps: GuestMigrationDeps,
  input: { token: string | null; contractTitle: string; expectedLockVersion: number },
): Promise<GuestMigrationResult> {
  if (!input.token) return { ok: false, code: "expired", reason: EXPIRED_MESSAGE };
  if (!Number.isInteger(input.expectedLockVersion) || input.expectedLockVersion < 1) {
    return { ok: false, code: "conflict", reason: CONFLICT_MESSAGE };
  }

  const tokenHash = await hashGuestToken(input.token);
  const row = await deps.store.findByHash(tokenHash);

  // A already-migrated workspace is not "expired": the retry path below has to
  // reach the transaction so it can return the committed result.
  const recoverable = row?.status === "migrated";
  if (!recoverable) {
    if (!row || row.status !== "active" || isGuestExpired(row.expires_at, deps.now())) {
      return { ok: false, code: "expired", reason: EXPIRED_MESSAGE };
    }
    // The migration must describe exactly the canonical draft the expected
    // lock version protects.
    if (row.lock_version !== input.expectedLockVersion) {
      return { ok: false, code: "conflict", reason: CONFLICT_MESSAGE };
    }
  }

  // The saved customer and contract number come from the analysis itself; the
  // accountant supplies only the contract name.
  const parsed = parseCanonicalInputs(row!.draft_json, row!.schema_version);
  if (!parsed.ok) return { ok: false, code: "invalid", reason: parsed.reason };

  const checked = validateMigrationRequest({
    customerName: parsed.draft.contract.customerName,
    contractTitle: input.contractTitle,
    contractNumber: parsed.draft.contract.contractNumber,
  });
  if (!checked.ok) return { ok: false, code: "invalid", reason: checked.reason };

  // One trusted transaction: guest → customer → contract → analysis →
  // revision 1, under the guest row lock and the expected lock version. It is
  // keyed by the credential hash, never by a browser-supplied workspace id.
  const { data, error } = await deps.migrateTransaction({
    p_token_hash: tokenHash,
    p_owner_user_id: deps.userId,
    p_expected_lock_version: input.expectedLockVersion,
    p_customer_name: checked.customerName,
    p_contract_title: checked.contractTitle,
    p_contract_number: checked.contractNumber,
  });

  const created = (Array.isArray(data) ? data[0] : data) as
    | {
        customer_id: string;
        contract_id: string;
        analysis_id: string;
        revision_id: string;
        idempotent?: boolean;
      }
    | null
    | undefined;

  if (error) {
    return error.code === "40001"
      ? { ok: false, code: "conflict", reason: CONFLICT_MESSAGE }
      : { ok: false, code: "failed", reason: FAILED_MESSAGE };
  }
  if (!created) return { ok: false, code: "failed", reason: FAILED_MESSAGE };

  return {
    ok: true,
    customerId: created.customer_id,
    contractId: created.contract_id,
    analysisId: created.analysis_id,
    revisionId: created.revision_id,
    recovered: created.idempotent === true,
  };
}
