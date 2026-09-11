/**
 * Phase 7F — private RPC responses are never cached.
 *
 * Every server function in ARC carries or acts on private material: the
 * authenticated identity, customers, contracts, analyses and revisions,
 * temporary guest workspaces, finalization and revision history, and account
 * deletion. This is applied as request middleware so the policy is uniform
 * instead of repeated per function, and so nothing server-only is imported
 * into the client entry graph (`src/start.ts`): the response object itself is
 * the only thing touched.
 */

import { createMiddleware } from "@tanstack/react-start";

export const NO_STORE_VALUE = "no-store, no-cache, must-revalidate, private";

/** TanStack's RPC path prefix for server functions. */
const SERVER_FN_MARKER = "_serverFn";

/** Exported for direct testing: is this request a private server-function call? */
export function isPrivateRpcRequest(url: string): boolean {
  try {
    return new URL(url, "http://localhost").pathname.includes(SERVER_FN_MARKER);
  } catch {
    return false;
  }
}

/** Exported for direct testing; the middleware below is a thin wrapper. */
export function applyNoStore(response: Response): Response {
  response.headers.set("Cache-Control", NO_STORE_VALUE);
  return response;
}

export const noStoreMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next, request }) => {
    const result = await next();
    const response: Response | undefined = (result as { response?: Response }).response;
    if (response && isPrivateRpcRequest(request.url)) applyNoStore(response);
    return result;
  },
);
