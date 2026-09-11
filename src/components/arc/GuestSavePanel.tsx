import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { migrateGuestWorkspace } from "@/lib/arc/persistence/guest.functions";
import { suggestedContractTitle, validateMigrationRequest } from "@/lib/arc/persistence/guest";
import { Notice } from "@/components/asc606-workflow/fields";

import { useAnalysis } from "./analysis-context";
import { useSupabaseSession } from "./use-supabase-session";

const BUTTON =
  "min-h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
const PRIMARY =
  "min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/**
 * Phase 7E — explicit "Save this analysis" for a temporary guest workspace.
 *
 * Saving is always a deliberate act: signing in never converts a temporary
 * workspace on its own. The guest credential lives only in an HttpOnly cookie,
 * so nothing here handles or forwards a token — not through the sign-in round
 * trip, and not in the URL.
 */
export function GuestSavePanel({ autoOpen = false }: { autoOpen?: boolean }) {
  const { persistence, draft } = useAnalysis();
  const session = useSupabaseSession();
  const navigate = useNavigate();
  const migrate = useServerFn(migrateGuestWorkspace);

  const [open, setOpen] = useState(autoOpen);
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerName = draft.contract.customerName.trim();
  const suggestion = suggestedContractTitle({
    customerName,
    contractNumber: draft.contract.contractNumber,
  });

  // Only ever a starting point: once the accountant edits the name, ARC keeps
  // exactly what they typed.
  useEffect(() => {
    if (!touched) setTitle(suggestion);
  }, [suggestion, touched]);

  if (persistence.mode !== "guest") return null;

  const check = validateMigrationRequest({ customerName, contractTitle: title });
  const expired = persistence.status.kind === "guest-expired";

  const startSave = () => {
    if (session.status !== "signed-in") {
      // Preserve the intent to save across the magic-link round trip, using
      // only a local path — never the guest credential.
      void navigate({ to: "/auth", search: { next: "/analysis?save=1" } });
      return;
    }
    setOpen(true);
  };

  const submit = async () => {
    if (!check.ok || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await migrate({ data: { contractTitle: title } });
      if (!result.ok) {
        // Nothing partial was created: the temporary workspace is still
        // complete and authoritative.
        setError(result.reason);
        return;
      }
      await navigate({
        to: "/analysis",
        search: { contract: result.contractId, revision: result.revisionId },
      });
    } catch {
      setError(
        "This analysis could not be saved to your account, so nothing was created. Your work is still here — please try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="guest-save-heading"
      className="space-y-3 rounded-md border border-border bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="guest-save-heading" className="text-sm font-semibold text-foreground">
            Temporary workspace
          </h2>
          <p className="text-sm text-muted-foreground">
            Your work is kept for nine hours in this browser session. Save it to your account to
            keep it permanently.
          </p>
        </div>
        {open ? null : (
          <button type="button" className={PRIMARY} onClick={startSave} disabled={expired}>
            Save this analysis
          </button>
        )}
      </div>

      {open ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1">
            <label htmlFor="guest-contract-title" className="text-sm font-medium text-foreground">
              Contract name
            </label>
            <input
              id="guest-contract-title"
              value={title}
              onChange={(event) => {
                setTouched(true);
                setTitle(event.target.value);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-sm text-muted-foreground">
              Saved for {customerName === "" ? "the customer named in Step 1" : customerName}
              {draft.contract.contractNumber.trim() === ""
                ? ""
                : ` · ${draft.contract.contractNumber.trim()}`}
              .
            </p>
          </div>

          {check.ok ? null : <Notice tone="warning">{check.reason}</Notice>}
          {error ? <Notice tone="warning">{error}</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className={PRIMARY} disabled={!check.ok || pending}>
              {pending ? "Saving…" : "Save to my account"}
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
