import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SIGNED_IN_PATH, sanitizeLocalPath } from "@/lib/arc/redirect";

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] } : {},
  head: () => ({
    meta: [
      { title: "Completing sign in — Ayden's Revenue Compass" },
      { name: "description", content: "Finishing the Ayden's Revenue Compass sign-in." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallback,
});

async function waitForSession(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function AuthCallback() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const destination = sanitizeLocalPath(next, DEFAULT_SIGNED_IN_PATH);

    const finish = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const hasError = url.searchParams.get("error") ?? url.hash.includes("error");

        if (!hasError && code) {
          // detectSessionInUrl may already have consumed the code; ignore the
          // resulting "already used" error and fall through to the check below.
          await supabase.auth.exchangeCodeForSession(code).catch(() => undefined);
        }

        const hasSession = !hasError && (await waitForSession());
        if (!active) return;

        // Strip any auth material from the address bar before continuing.
        window.history.replaceState({}, "", "/auth/callback");

        if (!hasSession) {
          setFailed(true);
          return;
        }

        // Server-verified identity: the session is only accepted once Supabase
        // Auth itself confirms the user behind the token.
        const { data, error } = await supabase.auth.getUser();
        if (!active) return;
        if (error || !data.user) {
          setFailed(true);
          return;
        }

        await navigate({ to: destination, replace: true });
      } catch {
        if (active) setFailed(true);
      }
    };

    void finish();
    return () => {
      active = false;
    };
  }, [navigate, next]);

  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
        {failed ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h1 className="text-xl font-semibold text-foreground">That sign-in link didn't work</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The link may have expired or already been used. You can request a new one.
            </p>
            <Link
              to="/auth"
              className="mt-6 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Completing sign in…
          </p>
        )}
      </main>
    </PublicAppShell>
  );
}
