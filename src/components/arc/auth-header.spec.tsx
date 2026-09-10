// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";

const authState: {
  user: { id: string; email: string } | null;
} = { user: null };

const listeners = new Set<(event: string, session: unknown) => void>();
const otpCalls: Array<{ email: string }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: authState.user ? { user: authState.user } : null },
        error: null,
      }),
      getUser: async () => ({
        data: { user: authState.user },
        error: authState.user ? null : new Error("no user"),
      }),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      },
      signInWithOtp: async ({ email }: { email: string }) => {
        otpCalls.push({ email });
        return { error: null };
      },
      exchangeCodeForSession: async () => ({ error: new Error("invalid code") }),
      signOut: async () => {
        authState.user = null;
        for (const listener of listeners) listener("SIGNED_OUT", null);
        return { error: null };
      },
    },
  },
}));

vi.mock("@/lib/auth/session.functions", () => ({
  buildAuthCallbackUrl: async ({ data }: { data: { next: string } }) => ({
    callbackUrl: `http://localhost:8080/auth/callback?next=${encodeURIComponent(data.next)}`,
    next: data.next,
  }),
  getVerifiedIdentity: Object.assign(async () => ({ userId: "u", email: null }), {
    url: "/_serverFn/getVerifiedIdentity",
  }),
}));

async function renderAt(initialPath: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  authState.user = null;
  listeners.clear();
});

describe("ARC identity header (Phase 7B)", () => {
  it("offers a single Sign in affordance when signed out", async () => {
    await renderAt("/");
    const header = (
      await screen.findByRole("link", { name: "Ayden's Revenue Compass home" })
    ).closest("header") as HTMLElement;
    expect(await within(header).findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(within(header).queryByText("My Contracts")).not.toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    // The primary navigation itself stays unchanged.
    const nav = within(header).getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
  });

  it("shows My Contracts and an account menu with email, settings and sign out", async () => {
    authState.user = { id: "11111111-1111-4111-8111-111111111111", email: "ayden@example.test" };
    await renderAt("/");
    const header = (
      await screen.findByRole("link", { name: "Ayden's Revenue Compass home" })
    ).closest("header") as HTMLElement;

    expect(await within(header).findByRole("link", { name: "My Contracts" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(within(header).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    const trigger = within(header).getByRole("button", { name: "Account menu" });
    trigger.click();

    const menu = await within(header).findByRole("menu", { name: "Account" });
    expect(within(menu).getAllByText("ayden@example.test").length).toBeGreaterThan(0);
    expect(within(menu).getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor from a protected route to sign in with a local next path", async () => {
    const router = await renderAt("/workspace");
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
    expect(String((router.state.location.search as { next?: string }).next ?? "")).toMatch(
      /^\/workspace/,
    );
  });

  it("offers magic-link sign-in only — no password, no Google", async () => {
    await renderAt("/auth");
    expect(await screen.findByLabelText("Email address")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Send magic link" })).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create an account|sign up/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue without signing in" })).toHaveAttribute(
      "href",
      "/analysis",
    );
  });

  it("confirms a magic-link request neutrally", async () => {
    otpCalls.length = 0;
    await renderAt("/auth");
    const input = (await screen.findByLabelText("Email address")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "someone@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    expect(await screen.findByText("Check your email for a sign-in link.")).toBeInTheDocument();
    expect(otpCalls).toEqual([{ email: "someone@example.test" }]);
    expect(screen.queryByText(/already (has|have) an account|no account found/i)).toBeNull();
  });

  it("shows a friendly ARC error when the callback cannot complete", async () => {
    await renderAt("/auth/callback");
    expect(
      await screen.findByText("That sign-in link didn't work", undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth");
  }, 15000);

  it("keeps the authenticated header across a remount (session survives refresh)", async () => {
    authState.user = { id: "11111111-1111-4111-8111-111111111111", email: "ayden@example.test" };
    const first = await renderAt("/");
    expect(await screen.findByRole("button", { name: "Account menu" })).toBeInTheDocument();
    cleanup();
    void first;

    await renderAt("/");
    expect(await screen.findByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("drops the authenticated header after sign out", async () => {
    authState.user = { id: "11111111-1111-4111-8111-111111111111", email: "ayden@example.test" };
    await renderAt("/");
    const trigger = await screen.findByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});
