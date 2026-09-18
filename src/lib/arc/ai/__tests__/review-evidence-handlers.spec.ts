/**
 * Phase 9G — Task 9A/9B. Deliberate review evidence and Guidance.
 *
 * The browser names a review item, echoes the fingerprint it displayed and —
 * for evidence — the ordinal it clicked. Everything authoritative (scope, the
 * review payload, the document behind a citation, the Guidance behind an item)
 * is re-derived server-side, and every refusal is the same neutral copy.
 */

import { describe, expect, it } from "vitest";

import type { AiGuidanceCardDto } from "../guidance-dto";
import {
  AI_EVIDENCE_UNAVAILABLE,
  AI_GUIDANCE_UNAVAILABLE,
  aiReviewEvidenceLinkHandler,
  aiReviewGuidanceHandler,
  type AiReviewEvidenceDeps,
  type AiReviewGuidanceDeps,
} from "../review-evidence.handlers";
import type { AiReviewItem } from "../review-state";
import { AI_WORKSPACE_NOT_EDITABLE, type AiCallerScope } from "../runs.handlers";
import type { AiWorkspaceStore } from "../workspace.handlers";

const REVISION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const HASH = "9".repeat(64);

const caller: AiCallerScope = {
  kind: "revision",
  userId: USER,
  revisionId: REVISION,
  contractId: "44444444-4444-4444-8444-444444444444",
};

const guestCaller: AiCallerScope = {
  kind: "guest",
  guestTokenHash: HASH,
  guestWorkspaceId: "33333333-3333-4333-8333-333333333333",
  authenticatedUserId: null,
};

function item(overrides: Partial<AiReviewItem> = {}): AiReviewItem {
  return {
    id: "rev-1",
    targetKey: "po:po-saas.recognitionMethod",
    section: "step_5",
    state: "yellow",
    severity: "yellow",
    reasonCode: "accountant_affirmation_required",
    reason: "Confirm the recognition pattern.",
    guidanceIds: [12, 30],
    citations: [
      {
        documentId: "doc-owned",
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

interface Options {
  items?: AiReviewItem[];
  malformed?: boolean;
  editable?: boolean;
  ownedDocuments?: string[];
  cards?: AiGuidanceCardDto[];
}

function card(topic: string): AiGuidanceCardDto {
  return {
    topic,
    subtopic: "Term subscriptions",
    primaryAscReference: "ASC 606-10-25-27",
    relatedAscReferences: "ASC 606-10-55-5",
    ruleSummary: "Recognize over time when the customer simultaneously receives and consumes.",
    decisionCriteria: "Assess the transfer pattern.",
    factsRequired: "Service term and access terms.",
    importantNuances: "Set-up activities are not a performance obligation.",
    whenRelevant: "SaaS subscriptions.",
    accountantMustApprove: "The recognition pattern conclusion.",
    interpretiveSource: "ARC interpretive note",
    sourceUrls: ["https://asc.fasb.org/606"],
    lastReviewed: "2026-01-31",
  };
}

function fixture(options: Options = {}): {
  evidence: AiReviewEvidenceDeps;
  guidance: AiReviewGuidanceDeps;
  requestedDocumentIds: string[];
  requestedGuidanceIds: number[][];
} {
  const requestedDocumentIds: string[] = [];
  const requestedGuidanceIds: number[][] = [];
  const owned = options.ownedDocuments ?? ["doc-owned"];

  const store = {
    findEditableRevision: async (revisionId: string, userId: string) =>
      options.editable === false || revisionId !== REVISION || userId !== USER
        ? null
        : { id: REVISION, contractId: "c", lockVersion: 7 },
    findActiveGuestWorkspace: async (tokenHash: string) =>
      options.editable === false || tokenHash !== HASH
        ? null
        : { id: "33333333-3333-4333-8333-333333333333", lockVersion: 4 },
    loadWorkspaceSnapshot: async () => ({
      reviewItems: options.items ?? [item()],
      reviewPayloadMalformed: options.malformed === true,
    }),
  } as unknown as AiWorkspaceStore;

  return {
    requestedDocumentIds,
    requestedGuidanceIds,
    evidence: {
      store,
      documents: {
        createReviewReadUrl: async ({ documentId }) => {
          requestedDocumentIds.push(documentId);
          return owned.includes(documentId)
            ? { url: `https://signed.example/${documentId}`, expiresInSeconds: 900 }
            : null;
        },
      },
    },
    guidance: {
      store,
      guidance: {
        findApprovedCards: async (ids) => {
          requestedGuidanceIds.push([...ids]);
          return options.cards ?? [card("Over-time recognition")];
        },
      },
    },
  };
}

const VALID = {
  reviewItemId: "rev-1",
  expectedReviewFingerprint: "review-fingerprint",
  citationIndex: 0,
};

describe("aiReviewEvidenceLinkHandler", () => {
  it("returns only an ephemeral signed url and the authoritative page facts", async () => {
    const f = fixture();
    const link = await aiReviewEvidenceLinkHandler(f.evidence, caller, VALID);
    expect(link).toEqual({
      url: "https://signed.example/doc-owned",
      expiresInSeconds: 900,
      pageStart: 4,
      pageEnd: 5,
    });
    // The document identity came from the validated citation, never the request.
    expect(f.requestedDocumentIds).toEqual(["doc-owned"]);
  });

  it("refuses a scope that is no longer editable", async () => {
    const f = fixture({ editable: false });
    await expect(aiReviewEvidenceLinkHandler(f.evidence, caller, VALID)).rejects.toThrow(
      AI_WORKSPACE_NOT_EDITABLE,
    );
    expect(f.requestedDocumentIds).toEqual([]);
  });

  it("fails neutrally for a stale fingerprint, an unknown item and a malformed payload", async () => {
    for (const [reason, f, input] of [
      ["stale fingerprint", fixture(), { ...VALID, expectedReviewFingerprint: "moved" }],
      ["unknown item", fixture(), { ...VALID, reviewItemId: "rev-other" }],
      ["malformed payload", fixture({ malformed: true }), VALID],
    ] as const) {
      await expect(
        aiReviewEvidenceLinkHandler(f.evidence, caller, input),
        reason,
      ).rejects.toThrow(AI_EVIDENCE_UNAVAILABLE);
      expect(f.requestedDocumentIds, reason).toEqual([]);
    }
  });

  it("bounds-checks the citation ordinal", async () => {
    for (const citationIndex of [-1, 1, 1.5, Number.NaN]) {
      const f = fixture();
      await expect(
        aiReviewEvidenceLinkHandler(f.evidence, caller, { ...VALID, citationIndex }),
        String(citationIndex),
      ).rejects.toThrow(AI_EVIDENCE_UNAVAILABLE);
      expect(f.requestedDocumentIds).toEqual([]);
    }
  });

  it("fails neutrally when the cited document is not reachable from this scope", async () => {
    const f = fixture({ ownedDocuments: [] });
    await expect(aiReviewEvidenceLinkHandler(f.evidence, caller, VALID)).rejects.toThrow(
      AI_EVIDENCE_UNAVAILABLE,
    );
  });

  it("authorizes guest evidence through the same guest scope", async () => {
    const f = fixture();
    const link = await aiReviewEvidenceLinkHandler(f.evidence, guestCaller, VALID);
    expect(link.url).toBe("https://signed.example/doc-owned");
  });
});

describe("aiReviewGuidanceHandler", () => {
  it("resolves the server-trusted guidance ids of the validated item", async () => {
    const f = fixture();
    const result = await aiReviewGuidanceHandler(f.guidance, caller, {
      reviewItemId: "rev-1",
      expectedReviewFingerprint: "review-fingerprint",
    });
    expect(f.requestedGuidanceIds).toEqual([[12, 30]]);
    expect(result.cards).toHaveLength(1);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["contentHash", "retrievalTags", "guidanceIds", "registryHash", "12"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("fails neutrally for a stale fingerprint and never asks for cards", async () => {
    const f = fixture();
    await expect(
      aiReviewGuidanceHandler(f.guidance, caller, {
        reviewItemId: "rev-1",
        expectedReviewFingerprint: "moved",
      }),
    ).rejects.toThrow(AI_GUIDANCE_UNAVAILABLE);
    expect(f.requestedGuidanceIds).toEqual([]);
  });

  it("fails neutrally when no approved card resolves", async () => {
    const f = fixture({ cards: [] });
    await expect(
      aiReviewGuidanceHandler(f.guidance, caller, {
        reviewItemId: "rev-1",
        expectedReviewFingerprint: "review-fingerprint",
      }),
    ).rejects.toThrow(AI_GUIDANCE_UNAVAILABLE);
  });

  it("refuses a scope that is no longer editable", async () => {
    const f = fixture({ editable: false });
    await expect(
      aiReviewGuidanceHandler(f.guidance, caller, {
        reviewItemId: "rev-1",
        expectedReviewFingerprint: "review-fingerprint",
      }),
    ).rejects.toThrow(AI_WORKSPACE_NOT_EDITABLE);
  });
});
