import { createFileRoute, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { Notice, Section } from "@/components/asc606-workflow/fields";
import { useAnalysis } from "@/components/arc/analysis-context";
import { GuestSourceDocumentsWorkspace } from "@/components/arc/documents/GuestSourceDocumentsWorkspace";
import { SourceDocumentsWorkspace } from "@/components/arc/documents/SourceDocumentsWorkspace";
import { FEATURES } from "@/lib/arc/features";

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
  const { persistence } = useAnalysis();
  const navigate = useNavigate();
  // `upload=1` is an intent to open the existing upload step exactly once —
  // whether it arrives from Home, or from Analyze Contract while the visitor is
  // already on this page. It is never persistent dialog state.
  const search = useSearch({ from: "/analysis" }) as { upload?: string };
  const wantsUpload = (search.upload ?? "").replace(/^"|"$/g, "") === "1";

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

  // Samples and in-memory analyses never own source documents.
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
