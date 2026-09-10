import { createMiddleware } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side function middleware: attaches the Supabase access token as a
 * bearer header on every server-function call so `requireSupabaseAuth` can
 * independently verify the caller. The server always re-validates the token;
 * the browser never asserts identity on its own.
 */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token: string | undefined;
    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    } catch {
      token = undefined;
    }

    return next(token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  },
);
