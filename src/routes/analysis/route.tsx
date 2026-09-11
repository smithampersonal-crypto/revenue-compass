import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

import { AnalysisNavigation } from "@/components/arc/AnalysisNavigation";
import { AnalysisProvider, useAnalysis } from "@/components/arc/analysis-context";
import { AnalysisSummary } from "@/components/arc/AnalysisSummary";
import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { ReadOnlyInputs } from "@/components/arc/ReadOnlyInputs";
import { SaveStatusIndicator } from "@/components/arc/SaveStatusIndicator";
import { Notice } from "@/components/asc606-workflow/fields";

const TITLE = "ASC 606 Analysis — Ayden's Revenue Compass";
const DESCRIPTION =
  "Work through the ASC 606 five-step revenue recognition model for a SaaS contract and review deterministic allocation, revenue, contract balance and journal output.";

export const Route = createFileRoute("/analysis")({
  // An ambiguous URL that names both an ephemeral sample and a saved contract
  // is normalized to the sample: samples are never saved, so the saved
  // contract is dropped rather than silently connected to sample data.
  validateSearch: (
    search: Record<string, unknown>,
  ): { sample?: string; contract?: string; revision?: string; save?: string } => ({
    ...(typeof search["sample"] === "string" ? { sample: search["sample"] } : {}),
    ...(typeof search["contract"] === "string" ? { contract: search["contract"] } : {}),
    ...(typeof search["revision"] === "string" ? { revision: search["revision"] } : {}),
    // Carries only the intent to save a temporary workspace after signing in.
    // The guest credential is never in the URL.
    ...(typeof search["save"] === "string" ? { save: search["save"] } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.sample && (search.contract || search.revision)) {
      throw redirect({ to: "/analysis", search: { sample: search.sample } });
    }
  },
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
  component: AnalysisLayout,
});

function AnalysisLayout() {
  const { sample, contract, revision, save } = Route.useSearch();

  // The analysis identity — sample, contract and revision — keys the provider,
  // so switching to a different analysis mounts a fresh persistence state with
  // isolated draft, lock and save refs. An in-flight save belonging to the
  // previous revision can therefore never read or write the new one's state.
  // Navigating between parent areas keeps the same identity and preserves the
  // draft.
  const identity = `sample:${sample ?? ""}|contract:${contract ?? ""}|revision:${revision ?? ""}`;

  return (
    <AnalysisProvider key={identity} sample={sample} contractId={contract} revisionId={revision}>
      <AnalysisWorkspace />
    </AnalysisProvider>
  );
}

function AnalysisWorkspace() {
  const { unknownSample, persistence, canEdit, historical } = useAnalysis();

  return (
    <PublicAppShell>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="space-y-2">
          <Link
            to="/"
            className="inline-flex min-h-9 items-center text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            ← Back to Home
          </Link>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">ASC 606 Analysis</h1>
          <p className="text-sm text-muted-foreground">
            Enter and review the accounting judgments. All accounting judgments are yours;
            allocation, revenue recognition and reconciliation amounts are produced by the
            deterministic ASC 606 engine and are read-only.
          </p>
          {persistence.enabled ? (
            <SaveStatusIndicator />
          ) : (
            <Notice>
              This workspace holds one in-memory analysis. Nothing is saved: refreshing the page
              clears all entered data.
            </Notice>
          )}
          {unknownSample ? (
            <Notice>That sample was not recognized, so a blank analysis was opened.</Notice>
          ) : null}
          {persistence.finalizing ? (
            <Notice>
              This revision is being finalized. The workspace is locked until the server answers, so
              nothing can change the analysis being recorded.
            </Notice>
          ) : null}
          {historical.active && !historical.error ? (
            <Notice>
              You are viewing the recorded results of a {historical.status} revision. Everything
              shown is exactly as recorded
              {historical.engineVersion ? ` by engine ${historical.engineVersion}` : ""}
              {historical.engineVersionMatchesCurrent
                ? ""
                : ", which is an earlier engine version than the one in use today"}
              . Nothing is recalculated.
            </Notice>
          ) : null}
        </header>

        {historical.error ? (
          // Fail closed: a missing or unusable recording is never replaced by a
          // fresh run of the current engine against the same inputs.
          <Notice tone="warning">{historical.error}</Notice>
        ) : (
          <>
            <AnalysisSummary />

            <AnalysisNavigation />

            <ReadOnlyInputs active={!canEdit}>
              <Outlet />
            </ReadOnlyInputs>
          </>
        )}
      </main>
    </PublicAppShell>
  );
}
