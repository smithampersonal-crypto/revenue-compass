import { createFileRoute, notFound } from "@tanstack/react-router";

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
  // Arriving from "Upload a Contract PDF" on the landing page opens the
  // upload step straight away.
  const wantsUpload =
    (new URLSearchParams(globalThis.location?.search ?? "").get("upload") ?? "").replace(
      /^"|"$/g,
      "",
    ) === "1";

  // A temporary workspace keeps its own uploaded PDFs, which move with the
  // analysis when it is saved to My Contracts.
  if (persistence.mode === "guest") {
    return <GuestSourceDocumentsWorkspace autoOpenUpload={wantsUpload} />;
  }

  // Samples and in-memory analyses never own source documents.
  if (persistence.mode !== "contract") {
    return (
      <Section title="Source documents" description="Supporting documentation for this analysis.">
        <Notice>Source Documents are available for saved analyses.</Notice>
      </Section>
    );
  }

  return <SourceDocumentsWorkspace />;
}
