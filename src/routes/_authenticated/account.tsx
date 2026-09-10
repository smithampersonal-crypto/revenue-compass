import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { getVerifiedIdentity } from "@/lib/auth/session.functions";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Account settings — Ayden's Revenue Compass" },
      { name: "description", content: "Your Ayden's Revenue Compass account details." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const verifyIdentity = useServerFn(getVerifiedIdentity);
  const identity = useQuery({
    queryKey: ["verified-identity"],
    queryFn: () => verifyIdentity({ data: undefined }),
  });

  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Account settings</h1>
        <dl className="mt-8 space-y-4 rounded-lg border border-border bg-card p-6 text-sm">
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="text-foreground">{identity.data?.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sign-in method</dt>
            <dd className="text-foreground">Email sign-in link — ARC never stores a password.</dd>
          </div>
        </dl>
      </main>
    </PublicAppShell>
  );
}
