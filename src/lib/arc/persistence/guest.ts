/**
 * Phase 7E — guest workspace credential and cookie rules.
 *
 * Pure and dependency-light (Web Crypto only): no React, no Supabase, no
 * database. The guest credential is an opaque random token that exists in
 * exactly two places — the visitor's HttpOnly cookie and, as a SHA-256 hash,
 * the `guest_workspaces` row. The raw token is never stored in a database
 * column, returned in a DTO, written to localStorage/sessionStorage, put in a
 * URL, or logged.
 */

/** Exactly nine hours, in seconds. */
export const GUEST_LIFETIME_SECONDS = 32400;
export const GUEST_LIFETIME_MS = GUEST_LIFETIME_SECONDS * 1000;

/** Production cookie name; `__Host-` requires Secure + Path=/ + no Domain. */
export const GUEST_COOKIE_SECURE_NAME = "__Host-arc_guest";
/** Development-only name, used when local HTTP makes `__Host-` unusable. */
export const GUEST_COOKIE_DEV_NAME = "arc_guest_dev";

/** Bytes of entropy in the guest credential (well above the 32-byte floor). */
export const GUEST_TOKEN_BYTES = 48;

export function guestCookieName(secure: boolean): string {
  return secure ? GUEST_COOKIE_SECURE_NAME : GUEST_COOKIE_DEV_NAME;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh opaque credential. Never persisted anywhere but the cookie. */
export function createGuestToken(): string {
  const bytes = new Uint8Array(GUEST_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** SHA-256 of the credential, lowercase hex. This is what the database holds. */
export async function hashGuestToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Expiry stamp for a workspace created at `now`: exactly nine hours later. */
export function guestExpiresAt(now: Date): string {
  return new Date(now.getTime() + GUEST_LIFETIME_MS).toISOString();
}

/**
 * Authorization-time expiry check. Cleanup timing is irrelevant: a workspace
 * whose `expires_at` has passed is unauthorized even if the row still exists.
 */
export function isGuestExpired(expiresAt: string, now: Date): boolean {
  const stamp = Date.parse(expiresAt);
  if (Number.isNaN(stamp)) return true;
  return stamp <= now.getTime();
}

/** Reads the guest credential out of a raw `Cookie` header. */
export function readGuestCookie(header: string | null | undefined, secure: boolean): string | null {
  if (!header) return null;
  const name = guestCookieName(secure);
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * The `Set-Cookie` value that carries the credential: HttpOnly always, and in
 * production Secure, SameSite=Lax, Path=/, Max-Age=32400.
 */
export function buildGuestCookie(token: string, secure: boolean): string {
  const attributes = [
    `${guestCookieName(secure)}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${GUEST_LIFETIME_SECONDS}`,
  ];
  if (secure) attributes.splice(1, 0, "Secure");
  return attributes.join("; ");
}

/** Retires the credential. Only ever sent after a successful migration. */
export function clearGuestCookie(secure: boolean): string {
  const attributes = [`${guestCookieName(secure)}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) attributes.splice(1, 0, "Secure");
  return attributes.join("; ");
}

export interface MigrationRequestFields {
  /** Taken from the Step 1 draft, never typed into the save dialog. */
  customerName: string;
  /** Supplied or confirmed by the accountant; required. */
  contractTitle: string;
  /** Taken from the Step 1 draft; optional. */
  contractNumber?: string;
}

export type MigrationRequestCheck =
  | { ok: true; customerName: string; contractTitle: string; contractNumber: string }
  | { ok: false; reason: string };

/**
 * Validates what a guest → account migration needs before anything is created.
 * A blank customer name is an analysis gap, so it points back at Step 1.
 */
export function validateMigrationRequest(fields: MigrationRequestFields): MigrationRequestCheck {
  const customerName = (fields.customerName ?? "").trim();
  const contractTitle = (fields.contractTitle ?? "").trim();
  const contractNumber = (fields.contractNumber ?? "").trim();

  if (customerName === "") {
    return {
      ok: false,
      reason:
        "Add the customer name in Step 1 — Identify the Contract before saving this analysis to your account.",
    };
  }
  if (contractTitle === "") {
    return { ok: false, reason: "Enter a name for this contract before saving it." };
  }
  if (contractTitle.length > 200) {
    return { ok: false, reason: "That contract name is too long (200 characters maximum)." };
  }
  return { ok: true, customerName, contractTitle, contractNumber };
}

/**
 * A sensible starting contract name for the save dialog: the contract number
 * from Step 1 when there is one, otherwise the customer name.
 */
export function suggestedContractTitle(fields: {
  customerName: string;
  contractNumber: string;
}): string {
  const number = (fields.contractNumber ?? "").trim();
  const customer = (fields.customerName ?? "").trim();
  if (number !== "" && customer !== "") return `${customer} — ${number}`;
  return number !== "" ? number : customer;
}
