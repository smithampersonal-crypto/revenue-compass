import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type SessionState =
  | { status: "loading"; email: null; userId: null }
  | { status: "signed-out"; email: null; userId: null }
  | { status: "signed-in"; email: string | null; userId: string };

const LOADING: SessionState = { status: "loading", email: null, userId: null };
const SIGNED_OUT: SessionState = { status: "signed-out", email: null, userId: null };

/**
 * Presentation-only session state for ARC chrome. Rendering a signed-in header
 * is not authorization: every private server function verifies the Supabase
 * identity independently.
 */
export function useSupabaseSession(): SessionState {
  const [state, setState] = useState<SessionState>(LOADING);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const apply = (session: { user: { id: string; email?: string | undefined } } | null) => {
      if (!active) return;
      setState(
        session?.user
          ? { status: "signed-in", userId: session.user.id, email: session.user.email ?? null }
          : SIGNED_OUT,
      );
    };

    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
      unsubscribe = () => data.subscription.unsubscribe();
      void supabase.auth
        .getSession()
        .then(({ data: sessionData }) => apply(sessionData.session))
        .catch(() => active && setState(SIGNED_OUT));
    } catch {
      setState(SIGNED_OUT);
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return state;
}
