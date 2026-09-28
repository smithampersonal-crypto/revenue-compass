import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { useSupabaseSession } from "@/components/arc/use-supabase-session";
import {
  listRecentAnalyses,
  saveRecentAnalysis,
  type RecentSaveResult,
} from "@/lib/arc/persistence/guest.functions";

type RowNotice = { kind: "incomplete"; reason: string } | { kind: "error"; reason: string };

type SavedNotice = { label: string; contractId: string; revisionId: string };

const TITLE = "Recent Analyses — Ayden's Revenue Compass";
const DESCRIPTION =
  "Resume the temporary ASC 606 analyses from this browser session, newest first, before they expire.";

export const Route = createFileRoute("/recent")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecentAnalysesPage,
});

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function RecentAnalysesPage() {
  const list = useServerFn(listRecentAnalyses);
  const session = useSupabaseSession();
  const signedIn = session.status === "signed-in";
  const save = useServerFn(saveRecentAnalysis);
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const [notices, setNotices] = useState<Record<string, RowNotice>>({});
  const [saved, setSaved] = useState<SavedNotice | null>(null);

  const saveDirect = async (analysisId: string, label: string) => {
    // One save per analysis at a time; the database also returns the same
    // committed rows to any repeat, so a retry never files a second contract.
    if (inFlight.current.has(analysisId)) return;
    inFlight.current.add(analysisId);
    setSavingId(analysisId);
    setNotices(({ [analysisId]: _drop, ...rest }) => rest);
    let result: RecentSaveResult;
    try {
      result = await save({ data: { analysisId } });
    } catch {
      result = {
        ok: false,
        code: "invalid",
        reason:
          "We did not hear back, so we cannot tell whether this analysis was saved. Try again to finish the save or open the saved copy.",
      } as RecentSaveResult;
    } finally {
      inFlight.current.delete(analysisId);
      setSavingId(null);
    }
    if (result.ok) {
      setSaved({ label, contractId: result.contractId, revisionId: result.revisionId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["arc-recent-analyses"] }),
        queryClient.invalidateQueries({ queryKey: ["arc-customer-choices"] }),
      ]);
      return;
    }
    setNotices((current) => ({
      ...current,
      [analysisId]:
        result.ok === false && result.code === "incomplete"
          ? { kind: "incomplete", reason: result.reason }
          : { kind: "error", reason: result.reason },
    }));
  };

  const query = useQuery({
    queryKey: ["arc-recent-analyses"],
    queryFn: () => list(),
    staleTime: 0,
    refetchOnMount: "always",
  });

  return (
    <PublicAppShell>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Recent Analyses</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Temporary analyses from this browser session. Each one is kept for 9 hours unless you
              save it to My Contracts.
            </p>
          </div>
          <Link
            to="/analysis/new"
            className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            New Analysis
          </Link>
        </div>

        {saved ? (
          <div
            role="status"
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm"
          >
            <span className="text-foreground">
              <span className="font-semibold">{saved.label}</span> was saved to My Contracts.
            </span>
            <span className="flex gap-3">
              <Link
                to="/analysis"
                search={{ contract: saved.contractId, revision: saved.revisionId }}
                className="underline hover:text-foreground"
              >
                Open saved contract
              </Link>
              <Link to="/workspace" className="underline hover:text-foreground">
                My Contracts
              </Link>
            </span>
          </div>
        ) : null}

        {query.isPending ? (
          <p className="mt-8 text-sm text-muted-foreground" role="status">
            Loading your analyses…
          </p>
        ) : query.isError ? (
          <p className="mt-8 text-sm text-destructive" role="alert">
            Your recent analyses couldn&apos;t be loaded. Please try again.
          </p>
        ) : query.data.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            No recent analyses in this browser session.{" "}
            <Link to="/analysis/new" className="underline hover:text-foreground">
              Start a new analysis
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-card">
            {query.data.map((item) => (
              <li
                key={item.analysisId}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{item.label}</p>
                  <p className="truncate text-sm text-muted-foreground">{item.source}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{item.status}</span> · Updated{" "}
                    {formatTime(item.updatedAt)} · Expires {formatTime(item.expiresAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/analysis"
                    search={{ a: item.analysisId }}
                    className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Resume Analysis
                  </Link>
                  {signedIn ? (
                    <button
                      type="button"
                      onClick={() => void saveDirect(item.analysisId, item.label)}
                      disabled={savingId === item.analysisId}
                      aria-busy={savingId === item.analysisId}
                      className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {savingId === item.analysisId ? "Saving…" : "Save to My Contracts"}
                    </button>
                  ) : null}
                </div>
                {notices[item.analysisId] ? (
                  <p role="alert" className="text-sm text-destructive sm:basis-full">
                    {notices[item.analysisId]!.kind === "incomplete" ? "Not saved yet. " : ""}
                    {notices[item.analysisId]!.reason}{" "}
                    {notices[item.analysisId]!.kind === "incomplete" ? (
                      <Link
                        to="/analysis"
                        search={{ a: item.analysisId }}
                        className="font-medium underline"
                      >
                        Complete Step 1 — Identify the Contract
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </PublicAppShell>
  );
}
