import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { createContract, createCustomer, listWorkspace } from "@/lib/arc/persistence/workspace.functions";
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

const INPUT_CLASS =
  "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring";
const BUTTON_CLASS =
  "inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

function WorkspacePage() {
  const queryClient = useQueryClient();
  const verifyIdentity = useServerFn(getVerifiedIdentity);
  const fetchWorkspace = useServerFn(listWorkspace);
  const addCustomer = useServerFn(createCustomer);
  const addContract = useServerFn(createContract);

  const identity = useQuery({
    queryKey: ["verified-identity"],
    queryFn: () => verifyIdentity({ data: undefined }),
  });

  const workspace = useQuery({
    queryKey: ["arc-workspace"],
    queryFn: () => fetchWorkspace({ data: undefined }),
  });

  const [customerName, setCustomerName] = useState("");
  const [contractCustomerId, setContractCustomerId] = useState("");
  const [contractTitle, setContractTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");

  const customerMutation = useMutation({
    mutationFn: (name: string) => addCustomer({ data: { name } }),
    onSuccess: async () => {
      setCustomerName("");
      await queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
    },
  });

  const contractMutation = useMutation({
    mutationFn: (input: { customerId: string; title: string; contractNumber?: string }) =>
      addContract({ data: input }),
    onSuccess: async () => {
      setContractTitle("");
      setContractNumber("");
      await queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
    },
  });

  const customers = workspace.data?.customers ?? [];

  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-10 sm:px-6">
        <header>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">My Contracts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {identity.data
              ? `Signed in as ${identity.data.email ?? identity.data.userId}, verified by Supabase on the server.`
              : identity.isError
                ? "Your session could not be verified. Please sign in again."
                : "Verifying your session…"}
          </p>
        </header>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Add a customer</h2>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (customerName.trim().length === 0) return;
              customerMutation.mutate(customerName.trim());
            }}
          >
            <label className="flex-1 text-sm text-foreground">
              <span className="mb-1 block">Customer name</span>
              <input
                className={INPUT_CLASS}
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </label>
            <button type="submit" className={BUTTON_CLASS} disabled={customerMutation.isPending}>
              {customerMutation.isPending ? "Saving…" : "Add customer"}
            </button>
          </form>
          {customerMutation.isError ? (
            <p className="mt-2 text-sm text-destructive">That customer could not be saved.</p>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Add a contract</h2>
          {customers.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Add a customer first.</p>
          ) : (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const customerId = contractCustomerId || customers[0]?.id;
                if (!customerId || contractTitle.trim().length === 0) return;
                contractMutation.mutate({
                  customerId,
                  title: contractTitle.trim(),
                  ...(contractNumber.trim() ? { contractNumber: contractNumber.trim() } : {}),
                });
              }}
            >
              <label className="text-sm text-foreground">
                <span className="mb-1 block">Customer</span>
                <select
                  className={INPUT_CLASS}
                  value={contractCustomerId || (customers[0]?.id ?? "")}
                  onChange={(event) => setContractCustomerId(event.target.value)}
                >
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-foreground">
                <span className="mb-1 block">Contract title</span>
                <input
                  className={INPUT_CLASS}
                  value={contractTitle}
                  onChange={(event) => setContractTitle(event.target.value)}
                />
              </label>
              <label className="text-sm text-foreground">
                <span className="mb-1 block">Contract number (optional)</span>
                <input
                  className={INPUT_CLASS}
                  value={contractNumber}
                  onChange={(event) => setContractNumber(event.target.value)}
                />
              </label>
              <div className="flex items-end">
                <button type="submit" className={BUTTON_CLASS} disabled={contractMutation.isPending}>
                  {contractMutation.isPending ? "Creating…" : "Create contract"}
                </button>
              </div>
            </form>
          )}
          {contractMutation.isError ? (
            <p className="mt-2 text-sm text-destructive">That contract could not be saved.</p>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Saved analyses</h2>
          {workspace.isPending ? (
            <p className="mt-2 text-sm text-muted-foreground">Loading your saved contracts…</p>
          ) : workspace.isError ? (
            <p className="mt-2 text-sm text-destructive">
              Your saved contracts could not be loaded.
            </p>
          ) : customers.every((customer) => customer.contracts.length === 0) ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No saved contracts yet. Create one above, or open the workspace to try an analysis
              without saving.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {customers
                .filter((customer) => customer.contracts.length > 0)
                .map((customer) => (
                  <li key={customer.id}>
                    <h3 className="text-sm font-semibold text-foreground">{customer.name}</h3>
                    <ul className="mt-2 space-y-2">
                      {customer.contracts.map((contract) => (
                        <li key={contract.id}>
                          <Link
                            to="/analysis"
                            search={{ contract: contract.id }}
                            className="flex min-h-10 items-center justify-between rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span>{contract.title}</span>
                            <span className="text-muted-foreground">
                              {contract.contractNumber ?? "—"}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
          <Link
            to="/analysis"
            className="mt-6 inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open analysis workspace
          </Link>
        </section>
      </main>
    </PublicAppShell>
  );
}
