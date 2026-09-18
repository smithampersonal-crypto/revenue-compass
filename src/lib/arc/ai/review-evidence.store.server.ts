/**
 * Phase 9G — Task 9A/9B. Server-only access for review evidence and Guidance.
 *
 * Blocked from client bundles by its `.server` name. Two deliberately thin
 * adapters:
 *
 *   - documents: the accepted Phase 8 ownership lookups plus the same signed
 *     read-url helper the document surface uses, at the same TTL. No second
 *     authorization model, no direct storage path handling in AI code, and no
 *     document id ever accepted from the browser.
 *   - Guidance: the compiled registry, resolved by trusted ids only. The
 *     registry itself never enters the browser graph.
 */

import { SIGNED_READ_TTL_SECONDS } from "@/lib/arc/documents/types";
import { GUIDANCE_CARDS_BY_ID } from "@/lib/arc/guidance/registry";

import { toAiGuidanceCardDto } from "./guidance-dto";
import type { AiEvidenceDocumentAccess, AiGuidanceAccess } from "./review-evidence.handlers";

export async function createAiEvidenceDocumentAccess(): Promise<AiEvidenceDocumentAccess> {
  const { documentStore, documentStorage } =
    await import("@/lib/arc/documents/documents.store.server");
  const store = await documentStore();

  return {
    createReviewReadUrl: async ({ caller, documentId }) => {
      // Ownership is proved by the same query the document surface uses: a
      // document from another analysis is simply not found.
      const document =
        caller.kind === "revision"
          ? await store.findOwnedDocument(documentId, caller.userId)
          : await store.findGuestDocument(documentId, caller.guestWorkspaceId);
      if (!document) return null;

      // Ephemeral by construction: the url is returned and never written down.
      const url = await documentStorage.createReadUrl({
        objectPath: document.storageObjectPath,
        originalFilename: document.originalFilename,
        disposition: "view",
      });
      return { url, expiresInSeconds: SIGNED_READ_TTL_SECONDS };
    },
  };
}

export function createAiGuidanceAccess(): AiGuidanceAccess {
  return {
    findApprovedCards: async (ids) => {
      const seen = new Set<number>();
      const cards = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const card = GUIDANCE_CARDS_BY_ID.get(id);
        // Only Approved compiled cards exist in the registry at all; anything
        // else is simply absent rather than degraded into partial content.
        if (card) cards.push(toAiGuidanceCardDto(card));
      }
      return cards;
    },
  };
}
