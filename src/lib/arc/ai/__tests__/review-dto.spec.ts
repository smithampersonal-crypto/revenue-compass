/**
 * Phase 9G — Task 7. The safe browser review/provenance read model.
 *
 * Everything here is a trust-boundary test: persisted JSON is data, and only
 * validated, presentation-shaped facts may cross to the browser. Merge
 * internals — value fingerprints, run ids, semantic keys, tombstones — must
 * never appear in the DTO, however they were persisted.
 */
import { describe, expect, it } from "vitest";

import {
  sanitizeFieldProvenance,
  sanitizeObjectProvenance,
  toAiReviewItemDto,
  toAiReviewItemDtos,
} from "../review-dto";
import type { AiReviewItem } from "../review-state";

function item(overrides: Partial<AiReviewItem> = {}): AiReviewItem {
  return {
    id: "rev-abc",
    targetKey: "po:po-saas.recognitionMethod",
    section: "step_5",
    state: "yellow",
    severity: "yellow",
    reasonCode: "accountant_affirmation_required",
    reason: "Confirm the recognition pattern for the platform subscription.",
    guidanceIds: [12, 3],
    citations: [
      {
        documentId: "11111111-1111-4111-8111-111111111111",
        pageStart: 4,
        pageEnd: 5,
        evidenceMode: "text",
        excerpt: "Subscription services are provided over the annual term.",
      },
    ],
    valueFingerprint: "value-fingerprint",
    reviewFingerprint: "review-fingerprint",
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
    ...overrides,
  };
}

describe("Task 7 safe review item DTO", () => {
  it("carries exactly the presentation facts the browser needs", () => {
    const dto = toAiReviewItemDto(item());
    expect(dto).toEqual({
      id: "rev-abc",
      targetKey: "po:po-saas.recognitionMethod",
      section: "step_5",
      state: "yellow",
      severity: "yellow",
      reasonCode: "accountant_affirmation_required",
      reason: "Confirm the recognition pattern for the platform subscription.",
      reviewFingerprint: "review-fingerprint",
      // Task 9B: only how many guidance references exist, never which.
      guidanceReferenceCount: 2,
      citations: [
        {
          pageStart: 4,
          pageEnd: 5,
          citationIndex: 0,
          evidenceModes: ["text"],
          excerpts: ["Subscription services are provided over the annual term."],
        },
      ],
      resolution: null,
    });
  });

  it("never exposes value fingerprints, run ids, guidance ids or document ids", () => {
    const serialized = JSON.stringify(toAiReviewItemDtos([item()]));
    expect(serialized).not.toContain("valueFingerprint");
    expect(serialized).not.toContain("value-fingerprint");
    expect(serialized).not.toContain("documentId");
    expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(serialized).not.toContain("guidanceIds");
  });

  it("carries an affirmation resolution without a review fingerprint echo", () => {
    const dto = toAiReviewItemDto(
      item({
        state: "resolved",
        resolution: {
          kind: "affirmed",
          at: "2026-09-17T10:00:00.000Z",
          method: "individual",
          reviewFingerprint: "review-fingerprint",
        },
      }),
    );
    expect(dto.resolution).toEqual({
      kind: "affirmed",
      at: "2026-09-17T10:00:00.000Z",
      method: "individual",
    });
  });

  it("carries a manual red resolution with its accepted reason and note", () => {
    const dto = toAiReviewItemDto(
      item({
        severity: "red",
        state: "resolved",
        resolution: {
          kind: "manual_red",
          at: "2026-09-17T11:00:00.000Z",
          reason: "outside_source_information",
          note: "Confirmed against the signed side letter.",
          reviewFingerprint: "review-fingerprint",
        },
      }),
    );
    expect(dto.resolution).toEqual({
      kind: "manual_red",
      at: "2026-09-17T11:00:00.000Z",
      reason: "outside_source_information",
      note: "Confirmed against the signed side letter.",
    });
  });

  it("keeps a visual citation with no excerpt", () => {
    const dto = toAiReviewItemDto(
      item({
        citations: [
          {
            documentId: "doc",
            pageStart: 7,
            pageEnd: 7,
            evidenceMode: "visual",
            excerpt: null,
          },
        ],
      }),
    );
    expect(dto.citations).toEqual([
      { pageStart: 7, pageEnd: 7, citationIndex: 0, evidenceModes: ["visual"], excerpts: [] },
    ]);
  });

  it("groups only the same trusted document and canonical page range", () => {
    const dto = toAiReviewItemDto(
      item({
        citations: [
          {
            documentId: "doc-a",
            pageStart: 3,
            pageEnd: 3,
            evidenceMode: "text",
            excerpt: "First distinct excerpt.",
          },
          {
            documentId: "doc-a",
            pageStart: 3,
            pageEnd: 3,
            evidenceMode: "visual",
            excerpt: "Second distinct excerpt.",
          },
          {
            documentId: "doc-a",
            pageStart: 3,
            pageEnd: 3,
            evidenceMode: "text",
            excerpt: "First distinct excerpt.",
          },
          {
            documentId: "doc-b",
            pageStart: 3,
            pageEnd: 3,
            evidenceMode: "text",
            excerpt: "A different document.",
          },
          {
            documentId: "doc-a",
            pageStart: 7,
            pageEnd: 9,
            evidenceMode: "text",
            excerpt: "Range one.",
          },
          {
            documentId: "doc-a",
            pageStart: 7,
            pageEnd: 9,
            evidenceMode: "text",
            excerpt: "Range two.",
          },
        ],
      }),
    );

    expect(dto.citations).toEqual([
      {
        pageStart: 3,
        pageEnd: 3,
        citationIndex: 0,
        evidenceModes: ["text", "visual"],
        excerpts: ["First distinct excerpt.", "Second distinct excerpt."],
      },
      {
        pageStart: 3,
        pageEnd: 3,
        citationIndex: 3,
        evidenceModes: ["text"],
        excerpts: ["A different document."],
      },
      {
        pageStart: 7,
        pageEnd: 9,
        citationIndex: 4,
        evidenceModes: ["text"],
        excerpts: ["Range one.", "Range two."],
      },
    ]);
    expect(JSON.stringify(dto.citations)).not.toContain("doc-a");
    expect(JSON.stringify(dto.citations)).not.toContain("doc-b");
  });
});

describe("Task 7 safe provenance DTO", () => {
  it("keeps known field provenance states and drops merge internals", () => {
    const safe = sanitizeFieldProvenance({
      "contract.customerName": {
        state: "ai_generated_untouched",
        semanticKey: "customer",
        lastAiRunId: "run-1",
        valueFingerprint: "fp",
      },
      "transactionPrice.input": {
        state: "ai_difference_preserved_user_override",
        semanticKey: null,
        lastAiRunId: "run-1",
        valueFingerprint: "fp",
      },
    });
    expect(safe).toEqual({
      "contract.customerName": { state: "ai_generated_untouched" },
      "transactionPrice.input": { state: "ai_difference_preserved_user_override" },
    });
  });

  it("omits unknown, malformed or non-object provenance entries", () => {
    const safe = sanitizeFieldProvenance({
      good: { state: "manual_from_start" },
      unknownState: { state: "ai_hallucinated" },
      notAnObject: "manual_from_start",
      nullEntry: null,
    });
    expect(Object.keys(safe)).toEqual(["good"]);
  });

  it("returns an empty map for a payload that is not an object", () => {
    expect(sanitizeFieldProvenance(null)).toEqual({});
    expect(sanitizeFieldProvenance("[]")).toEqual({});
    expect(sanitizeObjectProvenance(42)).toEqual({});
  });

  it("binds object provenance by canonical id, never by position", () => {
    const safe = sanitizeObjectProvenance({
      "po:po-saas": {
        state: "ai_generated_user_edited",
        canonicalId: "po-saas",
        userModified: true,
        semanticKey: "saas",
        lastAiRunId: "run-1",
        valueFingerprint: "fp",
      },
      broken: { state: "ai_generated_untouched", userModified: true },
      badFlag: { state: "ai_generated_untouched", canonicalId: "x", userModified: "yes" },
    });
    expect(safe).toEqual({
      "po-saas": {
        canonicalId: "po-saas",
        state: "ai_generated_user_edited",
        userModified: true,
      },
    });
  });
});

describe("object provenance never leaks the persisted semantic key", () => {
  it("re-keys the browser-safe map by the validated canonical id", () => {
    const safe = sanitizeObjectProvenance({
      "promise:semantic-ai-key": {
        canonicalId: "promise-17",
        state: "ai_generated_untouched",
        userModified: false,
        semanticKey: "promise:semantic-ai-key",
        valueFingerprint: "fp",
        lastAiRunId: "run-1",
      },
    });
    expect(Object.keys(safe)).toEqual(["promise-17"]);
    expect(JSON.stringify(safe)).not.toContain("promise:semantic-ai-key");
    expect(JSON.stringify(safe)).not.toContain("run-1");
  });

  it("fails closed when two persisted records claim the same canonical id", () => {
    const safe = sanitizeObjectProvenance({
      "a:one": { canonicalId: "po-1", state: "ai_generated_untouched", userModified: false },
      "b:two": { canonicalId: "po-1", state: "manual_from_start", userModified: true },
    });
    // Neither record may masquerade as the other.
    expect(safe).toEqual({});
  });
});
