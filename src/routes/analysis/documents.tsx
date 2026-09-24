import { createFileRoute, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { Notice, Section } from "@/components/asc606-workflow/fields";
import { useAnalysis } from "@/components/arc/analysis-context";
import { GuestSourceDocumentsWorkspace } from "@/components/arc/documents/GuestSourceDocumentsWorkspace";
import { SourceDocumentsWorkspace } from "@/components/arc/documents/SourceDocumentsWorkspace";
import { Button } from "@/components/ui/button";
import { FEATURES } from "@/lib/arc/features";

const HORIZON_SAMPLE_PDF = "/samples/horizon-logistics-saas-order-form.pdf";

export const Route = createFileRoute("/analysis/documents")({
  head: () => ({
    meta: [
      { title: "Source Documents — Ayden's Revenue Compass" },
      {
        name: "description",
        content: "Manage the contract PDFs supporting an ASC 606 analysis revision.",
      },
      { property: "og:title", content: "Source Documents — Ayden's Revenue Compass" },
      {
        property: "og:description",
        content: "Manage the contract PDFs supporting an ASC 606 analysis revision.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/analysis/documents" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/analysis/documents" }],
  }),
  beforeLoad: () => {
    if (!FEATURES.SOURCE_DOCUMENTS) throw notFound();
  },
  component: SourceDocumentsArea,
});

function SourceDocumentsArea() {
  const { persistence, sample } = useAnalysis();
  const navigate = useNavigate();
  // `upload=1` is an intent to open the existing upload step exactly once —
  // whether it arrives from Home, or from Analyze Contract while the visitor is
  // already on this page. It is never persistent dialog state.
  const search = useSearch({ from: "/analysis" }) as { upload?: unknown };
  const wantsUpload = String(search.upload ?? "").replace(/^"|"$/g, "") === "1";

  // Consuming the intent removes only `upload`: the contract, revision,
  // customer/save hints and the temporary-workspace identity are untouched, and
  // the replace keeps a useless history entry out of the Back button.
  const consumeUploadIntent = useCallback(() => {
    void navigate({
      to: "/analysis/documents",
      replace: true,
      search: (previous: Record<string, unknown>) => {
        const next = { ...previous };
        delete next["upload"];
        return next;
      },
    });
  }, [navigate]);

  // A temporary workspace keeps its own uploaded PDFs, which move with the
  // analysis when it is saved to My Contracts.
  if (persistence.mode === "guest") {
    return (
      <GuestSourceDocumentsWorkspace
        autoOpenUpload={wantsUpload}
        onAutoOpenUploadConsumed={consumeUploadIntent}
      />
    );
  }

  // Horizon has one curated public reference document. It is static sample
  // content only: it never enters ARC's uploaded-document architecture.
  if (persistence.mode === "sample" && sample === "horizon") {
    return (
      <Section title="Source documents" description="Supporting documentation for this analysis.">
        <article className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <p className="text-xs font-semibold uppercase text-primary">
                Sample source document · Synthetic
              </p>
              <h2 className="mt-2 text-base font-semibold text-foreground">
                Horizon Logistics — SaaS Order Form &amp; Billing Schedule
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                This fictional order form supports the pre-populated Horizon case study and lets you
                trace the contract terms behind the sample accounting.
              </p>
              <p className="mt-3 text-sm leading-6 text-foreground">
                The Horizon analysis is pre-populated for demonstration. This synthetic source
                document is provided so you can trace the underlying contract terms.
              </p>
            </div>
            <Button asChild>
              <a href={HORIZON_SAMPLE_PDF} target="_blank" rel="noreferrer">
                View PDF
              </a>
            </Button>
          </div>
        </article>
      </Section>
    );
  }

  // Other samples and in-memory analyses never own source documents.
  if (persistence.mode !== "contract") {
    return (
      <Section title="Source documents" description="Supporting documentation for this analysis.">
        <Notice>Source Documents are available for saved analyses.</Notice>
      </Section>
    );
  }

  return (
    <SourceDocumentsWorkspace
      autoOpenUpload={wantsUpload}
      onAutoOpenUploadConsumed={consumeUploadIntent}
    />
  );
}
