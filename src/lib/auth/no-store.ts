/**
 * Phase 7F — private RPC responses are never cached.
 *
 * Every server function in ARC carries or acts on private material: the
 * authenticated identity, customers, contracts, analyses and revisions,
 * temporary guest workspaces, finalization and revision history, and account
 * deletion. A shared response header keeps that policy uniform instead of
 * repeating it per function, and it does not touch the CSRF or auth
 * middleware chain.
 */

import { createMiddleware } from "@tanstack/react-start";

export const NO_STORE_VALUE = "no-store, no-cache, must-revalidate, private";

/** Exported for direct testing; the middleware below is a thin wrapper. */
export async function applyNoStore<T>(next: () => Promise<T>): Promise<T> {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Cache-Control", NO_STORE_VALUE);
  return next();
}

export const noStoreMiddleware = createMiddleware({ type: "function" }).server(({ next }) =>
  applyNoStore(() => next()),
);
