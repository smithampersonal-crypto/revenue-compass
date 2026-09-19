import { it } from "vitest";
import { fixtureAAnalysis } from "@/lib/arc/ai/__tests__/merge-fixtures";
import { mergeAnalysisIntoDraft } from "@/lib/arc/ai/merge";
import { createEmptyDraft } from "@/lib/asc606-workflow";
it("dbg", () => {
  const r = mergeAnalysisIntoDraft({
    analysis: fixtureAAnalysis(),
    draft: createEmptyDraft(),
    runId: "run-1",
    completedAt: "2027-01-01T00:00:00.000Z",
  } as never) as never as { issues: { targetKey: string; state: string }[] };
  console.log(r.issues.map((i) => `${i.state} ${i.targetKey}`).join("\n"));
});
