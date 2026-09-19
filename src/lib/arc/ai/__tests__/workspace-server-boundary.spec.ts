/**
 * Phase 9G — Task 3 patch. The server-function error boundary.
 *
 * A TanStack server function serialises a thrown error back to the browser,
 * so validation and handler failures must be settled ARC copy before they
 * leave the function. Zod issues, SQLSTATEs, store text, provider names and
 * stack traces may never cross. These tests exercise the exact helpers every
 * Task 3 server function uses, and assert the functions use nothing else.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_REVIEW_ACTION_CONFLICT,
  AI_REVIEW_ACTION_UNAVAILABLE,
  AI_REVIEW_NOTE_TOO_LONG,
} from "../review-actions.handlers";
import { AI_WORKSPACE_NOT_EDITABLE } from "../runs.handlers";
import {
  AI_WORKSPACE_ACTION_FAILED,
  AI_WORKSPACE_REQUEST_INVALID,
  parseAffirmationMethod,
  parseManualRedReason,
  parseReviewItemTarget,
  parseReviewNote,
  parseSourceFingerprint,
  parseRevisionTarget,
  safeWorkspaceCall,
  sanitizeWorkspaceError,
} from "../workspace.boundary";

const HOSTILE = "service_role failed: SQLSTATE 40001 gpt-5.6-terra prompt-v4 <contract payload>";
const LEAKS = [
  "service_role",
  "SQLSTATE",
  "PT409",
  "40001",
  "gpt-5.6-terra",
  "prompt-v4",
  "contract payload",
  "ZodError",
  "invalid_string",
  "Invalid uuid",
  "expected",
];

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the boundary to refuse this input");
}

function expectNoLeak(message: string): void {
  for (const leak of LEAKS) expect(message).not.toContain(leak);
}

describe("Task 3 input validation never emits validator internals", () => {
  it("refuses a malformed revision target with settled copy", () => {
    const message = messageOf(() => parseRevisionTarget({ revisionId: "not-a-uuid" }));
    expect(message).toBe(AI_WORKSPACE_REQUEST_INVALID);
    expectNoLeak(message);
  });

  it("accepts an absent revision target as the guest workspace", () => {
    expect(parseRevisionTarget(undefined)).toBeNull();
    expect(parseRevisionTarget({ revisionId: null })).toBeNull();
  });

  it("refuses a malformed fingerprint with settled review copy", () => {
    const message = messageOf(() =>
      parseReviewItemTarget({ reviewItemId: "item-1", expectedReviewFingerprint: "   " }),
    );
    expect(message).toBe(AI_REVIEW_ACTION_UNAVAILABLE);
    expectNoLeak(message);
    expect(messageOf(() => parseSourceFingerprint({ expectedSourceSetFingerprint: 42 }))).toBe(
      AI_REVIEW_ACTION_UNAVAILABLE,
    );
  });

  it("refuses an unsupported red reason and affirmation method", () => {
    expect(messageOf(() => parseManualRedReason({ reason: "because_i_said_so" }))).toBe(
      AI_REVIEW_ACTION_UNAVAILABLE,
    );
    expect(messageOf(() => parseAffirmationMethod({ method: "everything" }))).toBe(
      AI_REVIEW_ACTION_UNAVAILABLE,
    );
    expect(parseAffirmationMethod({})).toBeUndefined();
    expect(parseManualRedReason({ reason: "not_applicable" })).toBe("not_applicable");
  });

  it("answers an oversized note with the settled note limit copy", () => {
    const message = messageOf(() => parseReviewNote({ note: "x".repeat(2001) }));
    expect(message).toBe(AI_REVIEW_NOTE_TOO_LONG);
    expectNoLeak(message);
    expect(parseReviewNote({ note: "  fine  " })).toBe("fine");
    expect(parseReviewNote({})).toBeNull();
  });
});

describe("Task 3 handler errors are allowlisted", () => {
  it("passes approved ARC copy through unchanged", () => {
    for (const approved of [
      AI_WORKSPACE_NOT_EDITABLE,
      AI_REVIEW_ACTION_CONFLICT,
      AI_REVIEW_ACTION_UNAVAILABLE,
      AI_REVIEW_NOTE_TOO_LONG,
      AI_WORKSPACE_REQUEST_INVALID,
    ]) {
      expect(sanitizeWorkspaceError(new Error(approved)).message).toBe(approved);
    }
  });

  it("collapses any unexpected error into one generic ARC message", () => {
    const raw = new Error(HOSTILE) as Error & { code?: string; cause?: unknown };
    raw.code = "PT409";
    raw.cause = new Error(HOSTILE);
    const sanitized = sanitizeWorkspaceError(raw);
    expect(sanitized.message).toBe(AI_WORKSPACE_ACTION_FAILED);
    expectNoLeak(JSON.stringify({ ...sanitized, message: sanitized.message }));
    expect((sanitized as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(sanitizeWorkspaceError("boom").message).toBe(AI_WORKSPACE_ACTION_FAILED);
    expect(sanitizeWorkspaceError(null).message).toBe(AI_WORKSPACE_ACTION_FAILED);
  });

  it("guards every wrapped operation", async () => {
    await expect(
      safeWorkspaceCall(async () => {
        throw new Error(HOSTILE);
      }),
    ).rejects.toThrow(AI_WORKSPACE_ACTION_FAILED);
    await expect(
      safeWorkspaceCall(async () => {
        throw new Error(AI_REVIEW_ACTION_CONFLICT);
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_CONFLICT);
    await expect(safeWorkspaceCall(async () => "ok")).resolves.toBe("ok");
  });
});

describe("every Task 3 server function uses the boundary", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/arc/ai/workspace.functions.ts"), "utf8");

  it("runs no raw validator inside a server function", () => {
    expect(source).not.toContain(".parse(");
    expect(source).not.toContain('from "zod"');
  });

  it("wraps all five handlers", () => {
    const wrapped = source.match(/safeWorkspaceCall\(/g) ?? [];
    expect(wrapped.length).toBe(5);
  });
});
