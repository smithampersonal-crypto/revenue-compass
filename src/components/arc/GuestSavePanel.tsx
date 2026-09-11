import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";

import { migrateGuestWorkspace } from "@/lib/arc/persistence/guest.functions";
import { suggestedContractTitle, validateMigrationRequest } from "@/lib/arc/persistence/guest";
import { Notice } from "@/components/asc606-workflow/fields";

import { useAnalysis } from "./analysis-context";
import { useSupabaseSession } from "./use-supabase-session";

const BUTTON =
  "min-h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
const PRIMARY =
  "min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** What the accountant asked for, once the visible draft is safely saved. */
type PendingIntent = "sign-in" | "open" | "migrate";

/**
 * Phase 7E — explicit "Save this analysis" for a temporary guest workspace.
 *
 * Saving is always a deliberate act: signing in never converts a temporary
 * workspace on its own. The guest credential lives only in an HttpOnly cookie,
 * so nothing here handles or forwards a token — not through the sign-in round
 * trip, and not in the URL.
 *
 * Nothing leaves this workspace, and no migration starts, until the exact
 * visible draft is server-accepted: a debounced or in-flight edit is flushed
 * first, so the analysis that is saved to the account is the analysis on
 * screen.
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
  const [intent, setIntent] = useState<PendingIntent | null>(null);
  /**
   * The save was sent but its answer never arrived, so the outcome is unknown:
   * it may well have committed. ARC never claims a rollback here.
   */
  const [unknownOutcome, setUnknownOutcome] = useState(false);

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

  const status = persistence.status.kind;
  const lockVersion = persistence.lockVersion;
  /** The one condition under which the account save may proceed. */
  const exactlySaved = status === "saved" && lockVersion !== null;
  const setFinalizing = persistence.setFinalizing;

  const titleRef = useRef(title);
  titleRef.current = title;

  const runMigration = useCallback(async () => {
    if (lockVersion === null) return;
    const request = validateMigrationRequest({
      customerName,
      contractTitle: titleRef.current,
    });
    if (!request.ok) {
      setError(request.reason);
      return;
    }
    setPending(true);
    setError(null);
    let unknown = false;
    // Lock the whole workspace until the outcome is known, so the visible
    // draft cannot change underneath the transaction in this tab. Another
    // tab is still defended by the expected lock version in the database.
    setFinalizing(true);
    try {
      const result = await migrate({
        data: { contractTitle: request.contractTitle, expectedLockVersion: lockVersion },
      });
      if (!result.ok) {
        // A confirmed answer from the server: nothing partial was created and
        // the temporary workspace is still complete and authoritative.
        setUnknownOutcome(false);
        setError(result.reason);
        return;
      }
      // Reached only with a committed (or idempotently recovered) result, so
      // the credential is retired and the exact saved revision opens.
      setUnknownOutcome(false);
      await navigate({
        to: "/analysis",
        search: { contract: result.contractId, revision: result.revisionId },
      });
    } catch {
      // No answer arrived. The save may already have completed, so ARC keeps
      // this analysis locked and offers a retry that either finishes the save
      // or reopens the one it already created — never a duplicate.
      unknown = true;
      setUnknownOutcome(true);
      setError(
        "We did not hear back, so we cannot tell whether this analysis was saved. Nothing here has been changed and it cannot be edited until we know. Try again to finish the save or open the saved copy.",
      );
    } finally {
      setPending(false);
      // An unknown outcome keeps the analysis locked against edits.
      setFinalizing(unknown);
    }
  }, [customerName, lockVersion, migrate, navigate, setFinalizing]);

  const goToSignIn = useCallback(() => {
    // Preserve the intent to save across the magic-link round trip, using
    // only a local path — never the guest credential.
    void navigate({ to: "/auth", search: { next: "/analysis?save=1" } });
  }, [navigate]);

  // A queued intent runs only once the server has accepted the visible draft.
  // A failed or conflicted save keeps the existing Retry / Reload flows and
  // never silently proceeds.
  useEffect(() => {
    if (intent === null) return;
    if (status === "saving" || status === "unsaved") return;
    if (!exactlySaved) {
      setIntent(null);
      return;
    }
    setIntent(null);
    if (intent === "sign-in") goToSignIn();
    else if (intent === "open") setOpen(true);
    else void runMigration();
  }, [intent, status, exactlySaved, goToSignIn, runMigration]);

  if (persistence.mode !== "guest") return null;

  const check = validateMigrationRequest({ customerName, contractTitle: title });
  const expired = persistence.status.kind === "guest-expired";
  const waiting = intent !== null;

  /** Flushes a debounced or in-flight edit, then continues with `next`. */
  const withSavedDraft = (next: PendingIntent) => {
    setError(null);
    if (exactlySaved) {
      if (next === "sign-in") goToSignIn();
      else if (next === "open") setOpen(true);
      else void runMigration();
      return;
    }
    setIntent(next);
    // Skips the remaining debounce: the visible draft is written now.
    persistence.retrySave();
  };

  const startSave = () => {
    withSavedDraft(session.status !== "signed-in" ? "sign-in" : "open");
  };

  const submit = () => {
    if (!check.ok || pending || waiting) return;
    withSavedDraft("migrate");
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
          <button
            type="button"
            className={PRIMARY}
            onClick={startSave}
            disabled={expired || waiting || pending}
          >
            {waiting ? "Saving your latest edits…" : "Save this analysis"}
          </button>
        )}
      </div>

      {open ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
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
              disabled={pending}
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
          {waiting ? (
            <Notice>Saving your latest edits before this analysis is saved.</Notice>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {unknownOutcome ? (
              // The same analysis, the same expected version, the same intent:
              // this either finishes the save or reopens the saved copy.
              <button
                type="button"
                className={PRIMARY}
                onClick={() => void runMigration()}
                disabled={pending}
              >
                {pending ? "Checking…" : "Try again"}
              </button>
            ) : (
              <>
                <button
                  type="submit"
                  className={PRIMARY}
                  disabled={!check.ok || pending || waiting || expired}
                >
                  {pending ? "Saving…" : "Save to my account"}
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => setOpen(false)}
                  disabled={pending || waiting}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </form>
      ) : null}
    </section>
  );
}
