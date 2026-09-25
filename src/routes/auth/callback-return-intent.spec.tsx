// @vitest-environment jsdom
/**
 * Package 3B-2 — the sanitized return intent must survive the whole callback
 * lifecycle, including a re-execution/remount after auth material has been
 * removed from the address bar. `useSearch` here re-reads the live address
 * bar, like a router refresh would.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cleanedCallbackUrl } from "@/lib/arc/auth-callback-url";

const navigate = vi.fn(async (_: { to: string; replace?: boolean }) => undefined);
const getSession = vi.fn();
const getUser = vi.fn();
const exchangeCodeForSession = vi.fn(async () => ({ data: {}, error: null }));

function liveSearch(): { next?: string } {
  const next = new URL(window.location.href).searchParams.get("next");
  return next === null ? {} : { next };
}

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({ options, useSearch: liveSearch }),
    useNavigate: () => navigate,
    Link: ({ children }: { children: unknown }) => <a>{children as string}</a>,
  };
});

vi.mock("@/components/arc/PublicAppShell", () => ({
  PublicAppShell: ({ children }: { children: unknown }) => <div>{children as string}</div>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession, getUser, exchangeCodeForSession } },
}));

const Page = (
  (await import("@/routes/auth/callback")).Route as unknown as {
    options: { component: ComponentType };
  }
).options.component;

const user = { id: "00000000-0000-4000-8000-000000000001" };
const UNSAFE = ["//evil.example", "https://evil.example", "/javascript:alert(1)"];

function openCallback(query: string) {
  window.history.replaceState({}, "", `/auth/callback${query}`);
}

beforeEach(() => {
  navigate.mockClear();
  exchangeCodeForSession.mockClear();
  getSession.mockReset().mockResolvedValue({ data: { session: { user } } });
  getUser.mockReset().mockResolvedValue({ data: { user }, error: null });
});

describe("auth callback return intent", () => {
  it("keeps /analysis?save=1 through a remount after the URL is cleaned", async () => {
    openCallback("?next=%2Fanalysis%3Fsave%3D1&code=SYNTHETIC");
    let view: ReturnType<typeof render> | undefined;
    let remounted = false;
    getUser.mockImplementation(async () => {
      if (!remounted) {
        remounted = true;
        // The first execution is torn down after the address bar was cleaned.
        act(() => {
          view!.unmount();
          view = render(<Page />);
        });
      }
      return { data: { user }, error: null };
    });
    view = render(<Page />);

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(remounted).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/analysis?save=1", replace: true });
  });

  it("removes the auth code while temporarily keeping only the safe next", async () => {
    openCallback("?next=%2Fanalysis%3Fsave%3D1&code=SYNTHETIC&error_description=x");
    const seen: string[] = [];
    getUser.mockImplementation(async () => {
      seen.push(window.location.pathname + window.location.search + window.location.hash);
      return { data: { user }, error: null };
    });
    render(<Page />);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(seen[0]).toBe("/auth/callback?next=%2Fanalysis%3Fsave%3D1");
    expect(seen[0]).not.toMatch(/code|token|error/);
  });

  it("navigates to /workspace without next and leaves a bare callback URL", async () => {
    openCallback("?code=SYNTHETIC");
    render(<Page />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/workspace", replace: true }));
    expect(cleanedCallbackUrl(undefined)).toBe("/auth/callback");
  });

  it.each(UNSAFE)("falls back to /workspace and never retains unsafe next %s", async (bad) => {
    openCallback(`?next=${encodeURIComponent(bad)}&code=SYNTHETIC`);
    const seen: string[] = [];
    getUser.mockImplementation(async () => {
      seen.push(window.location.pathname + window.location.search);
      return { data: { user }, error: null };
    });
    render(<Page />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/workspace", replace: true }));
    expect(seen[0]).toBe("/auth/callback");
    expect(cleanedCallbackUrl(bad)).toBe("/auth/callback");
  });

  it("shows the failure message and does not navigate when no session is established", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getSession.mockResolvedValue({ data: { session: null } });
    openCallback("?next=%2Fanalysis%3Fsave%3D1&code=SYNTHETIC");
    render(<Page />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    vi.useRealTimers();
    expect(await screen.findByText("That sign-in link didn't work")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(window.location.search).not.toMatch(/code/);
  });

  it("keeps getUser() authoritative: a rejected user blocks navigation", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    openCallback("?next=%2Fanalysis%3Fsave%3D1&code=SYNTHETIC");
    render(<Page />);
    expect(await screen.findByText("That sign-in link didn't work")).toBeInTheDocument();
    expect(getUser).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
