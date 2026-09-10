import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { useSupabaseSession } from "@/components/arc/use-supabase-session";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SIGNED_IN_PATH, sanitizeLocalPath } from "@/lib/arc/redirect";
import { buildAuthCallbackUrl } from "@/lib/auth/session.functions";

const TITLE = "Sign in — Ayden's Revenue Compass";
const DESCRIPTION =
  "Sign in to Ayden's Revenue Compass with Google or an email magic link to keep your ASC 606 contract analyses.";

export const Route = createFileRoute("/auth/")({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] } : {},
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignInPage,
});

function SignInPage() {
  const { next } = Route.useSearch();
  const session = useSupabaseSession();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destination = sanitizeLocalPath(next, DEFAULT_SIGNED_IN_PATH);

  useEffect(() => {
    if (session.status === "signed-in" && typeof window !== "undefined") {
      window.location.replace(destination);
    }
  }, [session.status, destination]);

  const startGoogle = async () => {
    setError(null);
    setNotice(null);
    setPending("google");
    try {
      const { callbackUrl } = await buildAuthCallbackUrl({ data: { next: destination } });
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl },
      });
      if (oauthError) throw oauthError;
    } catch {
      setError("Google sign-in couldn't be started. Please try again.");
      setPending(null);
    }
  };

  const sendMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending("email");
    try {
      const { callbackUrl } = await buildAuthCallbackUrl({ data: { next: destination } });
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: callbackUrl },
      });
      if (otpError) throw otpError;
      // Neutral copy: never discloses whether an account already existed.
      setNotice("If that email address can receive mail, a sign-in link is on its way.");
    } catch {
      setError("That sign-in link couldn't be sent. Please check the address and try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-md px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Sign in to ARC</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to keep your ASC 606 analyses. No password required.
        </p>

        <div className="mt-8 space-y-6 rounded-lg border border-border bg-card p-6">
          <button
            type="button"
            onClick={startGoogle}
            disabled={pending !== null}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {pending === "google" ? "Opening Google…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-3" onSubmit={sendMagicLink}>
            <label htmlFor="auth-email" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={pending !== null}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {pending === "email" ? "Sending…" : "Send magic link"}
            </button>
          </form>

          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          <Link to="/analysis" className="underline hover:text-foreground">
            Continue without signing in
          </Link>
        </p>
      </main>
    </PublicAppShell>
  );
}
