import { createFileRoute, notFound } from "@tanstack/react-router";

import { Notice, Section } from "@/components/asc606-workflow/fields";
import { FEATURES } from "@/lib/arc/features";

export const Route = createFileRoute("/analysis/documents")({
  beforeLoad: () => {
    if (!FEATURES.SOURCE_DOCUMENTS) throw notFound();
  },
  component: SourceDocumentsArea,
});

function SourceDocumentsArea() {
  return (
    <Section title="Source documents" description="Supporting documentation for this analysis.">
      <Notice>
        This analysis was entered directly in the workspace, so there are no attached source
        documents. Document intake is not part of the current release and no accounting output
        depends on it.
      </Notice>
    </Section>
  );
}
