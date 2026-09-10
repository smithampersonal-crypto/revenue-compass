import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { getVerifiedIdentity } from "@/lib/auth/session.functions";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "My Contracts — Ayden's Revenue Compass" },
      {
        name: "description",
        content: "Your saved ASC 606 contract analyses in Ayden's Revenue Compass.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const verifyIdentity = useServerFn(getVerifiedIdentity);
  const identity = useQuery({
    queryKey: ["verified-identity"],
    queryFn: () => verifyIdentity({ data: undefined }),
  });

  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">My Contracts</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {identity.data
            ? `Signed in as ${identity.data.email ?? identity.data.userId}, verified by Supabase on the server.`
            : identity.isError
              ? "Your session could not be verified. Please sign in again."
              : "Verifying your session…"}
        </p>

        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Saved analyses</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Saving contracts to your account is being built. For now, open the analysis workspace to
            work through a contract.
          </p>
          <Link
            to="/analysis"
            className="mt-6 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open analysis workspace
          </Link>
        </div>
      </main>
    </PublicAppShell>
  );
}
