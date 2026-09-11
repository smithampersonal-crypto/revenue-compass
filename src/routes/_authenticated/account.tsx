import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { supabase } from "@/integrations/supabase/client";
import { deleteAccount, DELETE_CONFIRMATION } from "@/lib/auth/account.functions";
import { messageForRequestFailure } from "@/lib/auth/account.handlers";
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
  const requestDeletion = useServerFn(deleteAccount);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identity = useQuery({
    queryKey: ["verified-identity"],
    queryFn: () => verifyIdentity({ data: undefined }),
  });

  const canDelete = confirmation.trim() === DELETE_CONFIRMATION && !pending;

  const handleDelete = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await requestDeletion({ data: { confirmation: confirmation.trim() } });
      if (!result.ok) {
        setError(result.reason);
        setPending(false);
        return;
      }
      // Nothing of the deleted identity may survive in this browser.
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      await navigate({ to: "/", replace: true });
    } catch {
      // The request already left this browser: a transport or serialization
      // failure is an unknown outcome, not proof that nothing was removed.
      setError(messageForRequestFailure());
      setPending(false);
    }
  };

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

        <section
          aria-labelledby="delete-account-heading"
          className="mt-10 rounded-lg border border-destructive/50 bg-card p-6"
        >
          <h2 id="delete-account-heading" className="text-lg font-semibold text-foreground">
            Delete this account
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This cannot be undone. Deleting your account permanently removes your sign-in, every
            customer, contract and analysis you have saved — including finalized and superseded
            versions — and any temporary workspace still holding a copy of your work.
          </p>

          <label
            htmlFor="delete-confirmation"
            className="mt-6 block text-sm font-medium text-foreground"
          >
            Type {DELETE_CONFIRMATION} to confirm
          </label>
          <input
            id="delete-confirmation"
            type="text"
            autoComplete="off"
            value={confirmation}
            disabled={pending}
            onChange={(event) => setConfirmation(event.target.value)}
            className="mt-2 w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />

          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            className="mt-4 inline-flex min-h-9 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Deleting account…" : "Delete my account"}
          </button>
        </section>
      </main>
    </PublicAppShell>
  );
}
