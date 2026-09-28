import { createMiddleware } from "@tanstack/react-start";

import { getActiveGuestAnalysisId } from "./active-guest-analysis";
import { GUEST_ANALYSIS_HEADER, isAnalysisId } from "./guest";

/**
 * Package 3D-T — client function middleware: names the active temporary
 * analysis on each server-function call. A resource target only; the server
 * proves ownership from the HttpOnly session cookie.
 */
export const attachGuestAnalysis = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const id = getActiveGuestAnalysisId();
    return next(isAnalysisId(id) ? { headers: { [GUEST_ANALYSIS_HEADER]: id } } : {});
  },
);
