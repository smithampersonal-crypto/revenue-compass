/**
 * Phase 8G — defence in depth for caller identity.
 *
 * Every document mutation is scoped by an identity the server derived itself:
 * the authenticated `userId` from the session middleware, or the hash of the
 * HttpOnly guest credential. The browser payload must never be able to supply
 * or overwrite that identity, even if a validator were later loosened to pass
 * unknown keys through.
 *
 * `scopedToCaller` removes every identity key from the request payload and
 * then applies the server-derived identity last, so the server value always
 * wins.
 */

export function scopedToCaller<
  Identity extends Record<string, unknown>,
  Data extends Record<string, unknown>,
>(identity: Identity, data: Data): Omit<Data, keyof Identity> & Identity {
  const scrubbed = { ...data } as Record<string, unknown>;
  for (const key of Object.keys(identity)) delete scrubbed[key];
  return { ...scrubbed, ...identity } as Omit<Data, keyof Identity> & Identity;
}
