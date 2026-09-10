import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeLocalPath } from "@/lib/arc/redirect";

export type VerifiedIdentity = {
  /** Supabase `auth.users.id` — the only stable owner identity in ARC. */
  userId: string;
  email: string | null;
};

/**
 * Server-side identity verification. The bearer token is validated by
 * `requireSupabaseAuth`; nothing from localStorage, the URL or a browser
 * supplied email is trusted.
 */
export const getVerifiedIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VerifiedIdentity> => {
    const { data, error } = await context.supabase.auth.getUser();
    if (error || !data.user || data.user.id !== context.userId) {
      throw new Error("Unauthorized: identity could not be verified");
    }
    return { userId: data.user.id, email: data.user.email ?? null };
  });

/**
 * Builds the magic-link callback URL on the server from trusted ARC
 * configuration. The browser only contributes a `next` hint, which is reduced
 * to an ARC-local path before use.
 */
export const buildAuthCallbackUrl = createServerFn({ method: "POST" })
  .inputValidator((input: { next?: string }) => ({ next: input?.next }))
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const configured = process.env["ARC_SITE_URL"];
    const origin = (configured ?? new URL(getRequest().url).origin).replace(/\/+$/, "");
    const next = sanitizeLocalPath(data.next);
    return {
      callbackUrl: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      next,
    };
  });
