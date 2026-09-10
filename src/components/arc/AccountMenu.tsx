import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

import { useSupabaseSession } from "./use-supabase-session";

/**
 * Header identity affordance. Signed out it offers a single Sign in link;
 * signed in it exposes My Contracts plus a compact account menu. It reflects
 * session state only — it grants no access of its own.
 */
export function AccountMenu() {
  const session = useSupabaseSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (session.status !== "signed-in") {
    return (
      <Link
        to="/auth"
        className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Sign in
      </Link>
    );
  }

  const handleSignOut = async () => {
    setOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/workspace"
        className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        activeProps={{ className: "bg-accent text-foreground" }}
      >
        My Contracts
      </Link>

      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
          className="inline-flex min-h-9 max-w-[12rem] items-center gap-1.5 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{session.email ?? "Account"}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </button>

        {open ? (
          <div
            role="menu"
            aria-label="Account"
            className="absolute right-0 z-50 mt-2 w-60 rounded-md border border-border bg-card p-1 shadow-lg"
          >
            <p className="truncate px-3 py-2 text-xs text-muted-foreground" title={session.email ?? ""}>
              {session.email ?? "Signed in"}
            </p>
            <Link
              to="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-sm px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              Account settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="block w-full rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
