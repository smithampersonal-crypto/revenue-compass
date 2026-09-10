import { describe, expect, it } from "vitest";

import {
  ARC_WORKFLOW_SCHEMA_VERSION,
  parseCanonicalInputs,
  serializeDraft,
  toCanonicalInputs,
} from "@/lib/arc/persistence/schema";
import { describeSaveStatus, hasPendingWork } from "@/lib/arc/persistence/save-status";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import { analyzeWorkflow, createEmptyDraft } from "@/lib/asc606-workflow";

describe("canonical persistence envelope", () => {
  it("round-trips an empty draft without loss", () => {
    const draft = createEmptyDraft();
    const parsed = parseCanonicalInputs(toCanonicalInputs(draft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schemaVersion).toBe(ARC_WORKFLOW_SCHEMA_VERSION);
    expect(parsed.draft).toEqual(draft);
  });

  it("round-trips a populated sample draft and reproduces identical engine output", () => {
    const draft = createDemoDraftIfKnown("meridian");
    expect(draft).not.toBeNull();
    if (!draft) return;

    const parsed = parseCanonicalInputs(toCanonicalInputs(draft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.draft).toEqual(draft);
    expect(analyzeWorkflow(parsed.draft)).toEqual(analyzeWorkflow(draft));
  });

  it("never persists engine output — only accountant inputs", () => {
    const draft = createDemoDraftIfKnown("redwood")!;
    const stored = toCanonicalInputs(draft);
    expect(Object.keys(stored).sort()).toEqual(["draft", "schemaVersion"]);
    expect(JSON.stringify(stored)).not.toContain("revenueSchedule");
  });

  it("rejects a malformed stored document instead of loading a partial draft", () => {
    for (const bad of [null, {}, { schemaVersion: "arc.workflow.v1" }, { schemaVersion: "", draft: {} }]) {
      expect(parseCanonicalInputs(bad).ok).toBe(false);
    }
  });

  it("fills missing optional collections from an empty draft", () => {
    const draft = createEmptyDraft();
    const stored = toCanonicalInputs(draft) as unknown as Record<string, unknown>;
    const parsed = parseCanonicalInputs(stored);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.contractModifications).toEqual([]);
  });

  it("produces a stable serialization for unchanged drafts", () => {
    const draft = createDemoDraftIfKnown("apex")!;
    expect(serializeDraft(draft)).toBe(serializeDraft(structuredClone(draft)));
  });
});

describe("save status wording", () => {
  it("describes every state in accountant-facing language", () => {
    expect(describeSaveStatus({ kind: "off" }).label).toBe("Not saved");
    expect(describeSaveStatus({ kind: "loading" }).tone).toBe("pending");
    expect(describeSaveStatus({ kind: "read-only" }).detail).toContain("finalized");
    expect(describeSaveStatus({ kind: "saved", at: null }).label).toBe("Saved");
    expect(describeSaveStatus({ kind: "unsaved" }).tone).toBe("pending");
    expect(describeSaveStatus({ kind: "saving" }).label).toBe("Saving…");
    expect(describeSaveStatus({ kind: "conflict" }).tone).toBe("warning");
    expect(describeSaveStatus({ kind: "error", message: "boom" }).detail).toBe("boom");
  });

  it("reports pending work only while edits are unsaved or in flight", () => {
    expect(hasPendingWork({ kind: "unsaved" })).toBe(true);
    expect(hasPendingWork({ kind: "saving" })).toBe(true);
    expect(hasPendingWork({ kind: "saved", at: null })).toBe(false);
    expect(hasPendingWork({ kind: "off" })).toBe(false);
  });
});
