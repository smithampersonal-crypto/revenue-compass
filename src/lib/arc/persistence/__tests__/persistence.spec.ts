import { describe, expect, it } from "vitest";

import {
  ARC_WORKFLOW_SCHEMA_VERSION,
  parseCanonicalInputs,
  serializeDraft,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "@/lib/arc/persistence/schema";
import {
  describeSaveStatus,
  hasPendingWork,
  isSafelyPersisted,
} from "@/lib/arc/persistence/save-status";
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
    for (const bad of [
      null,
      {},
      { schemaVersion: "arc.workflow.v1" },
      { schemaVersion: "", draft: {} },
    ]) {
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

describe("runtime validation before persistence", () => {
  it("accepts a well-formed draft", () => {
    expect(validateDraftForPersistence(createDemoDraftIfKnown("meridian")).ok).toBe(true);
  });

  it("rejects malformed nested rows instead of handing them to the engine", () => {
    const promiseRow = () => {
      const draft = createDemoDraftIfKnown("redwood")!;
      (draft.promises[0] as unknown as Record<string, unknown>)["seq"] = "first";
      return draft;
    };
    const poRow = () => {
      const draft = createDemoDraftIfKnown("redwood")!;
      delete (draft.performanceObligations[0] as unknown as Record<string, unknown>)["sspInput"];
      return draft;
    };
    const vcRow = () => {
      const draft = createDemoDraftIfKnown("redwood")!;
      draft.hasVariableConsideration = true;
      draft.variableConsiderationComponents = [{ id: "vc-1" } as never];
      return draft;
    };
    const modificationRow = () => {
      const draft = createDemoDraftIfKnown("meridian")!;
      (draft.contractModifications[0] as unknown as Record<string, unknown>)[
        "modifiedPerformanceObligations"
      ] = [{ id: "mp-1" }];
      return draft;
    };
    const billingRow = () => {
      const draft = createDemoDraftIfKnown("redwood")!;
      draft.contractBalances.considerationEvents = [{ id: "ce-1", seq: 1 } as never];
      return draft;
    };

    for (const build of [promiseRow, poRow, vcRow, modificationRow, billingRow]) {
      expect(validateDraftForPersistence(build()).ok).toBe(false);
    }
  });

  it("rejects non-draft values", () => {
    for (const bad of [null, undefined, 42, "draft", {}, []]) {
      expect(validateDraftForPersistence(bad).ok).toBe(false);
    }
  });
});

describe("stored schema versions", () => {
  it("refuses a stored envelope written by a future version of ARC", () => {
    const stored = { ...toCanonicalInputs(createEmptyDraft()), schemaVersion: "arc.workflow.v2" };
    const parsed = parseCanonicalInputs(stored);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("cannot open");
  });

  it("refuses an envelope whose version disagrees with the revision row", () => {
    const stored = toCanonicalInputs(createEmptyDraft());
    expect(parseCanonicalInputs(stored, "arc.workflow.v0").ok).toBe(false);
    expect(parseCanonicalInputs(stored, ARC_WORKFLOW_SCHEMA_VERSION).ok).toBe(true);
  });
});

describe("save status wording", () => {
  it("describes every state in accountant-facing language", () => {
    expect(describeSaveStatus({ kind: "off" }).label).toBe("Not saved");
    expect(describeSaveStatus({ kind: "loading" }).tone).toBe("pending");
    expect(describeSaveStatus({ kind: "read-only" }).detail).toContain("finalized");
    expect(describeSaveStatus({ kind: "saved", at: null }).label).toBe("Saved");
    expect(describeSaveStatus({ kind: "unsaved" }).tone).toBe("pending");
    expect(describeSaveStatus({ kind: "saving" }).label).toBe("Saving\u2026");
    expect(describeSaveStatus({ kind: "load-error", message: "gone" }).label).toBe(
      "Could not open",
    );
  });

  it("offers retry for an ordinary save failure and reload only for a conflict", () => {
    const failed = describeSaveStatus({ kind: "error", message: "boom" });
    expect(failed.label).toBe("Save failed");
    expect(failed.detail).toContain("boom");
    expect(failed.action).toBe("retry");

    const conflict = describeSaveStatus({ kind: "conflict" });
    expect(conflict.action).toBe("reload");
    expect(conflict.tone).toBe("warning");
  });

  it("treats unsaved, saving, failed and conflicted states as not safely persisted", () => {
    for (const status of [
      { kind: "unsaved" },
      { kind: "saving" },
      { kind: "error", message: "boom" },
      { kind: "conflict" },
    ] as const) {
      expect(hasPendingWork(status)).toBe(true);
      expect(isSafelyPersisted(status)).toBe(false);
    }
    expect(hasPendingWork({ kind: "saved", at: null })).toBe(false);
    expect(hasPendingWork({ kind: "off" })).toBe(false);
    expect(isSafelyPersisted({ kind: "saved", at: null })).toBe(true);
    expect(isSafelyPersisted({ kind: "read-only" })).toBe(true);
  });
});
