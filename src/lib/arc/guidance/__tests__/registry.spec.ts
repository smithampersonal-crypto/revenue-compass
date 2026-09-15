import { describe, expect, it } from "vitest";

import { getGuidancePolicy, POLICY_CARD_ID_COUNT } from "../policy";
import {
  assertGuidanceRegistryCurrent,
  GUIDANCE_CARDS,
  GUIDANCE_REGISTRY_HASH,
  GUIDANCE_REGISTRY_VERSION,
  getGuidanceCard,
} from "../registry";

describe("compiled guidance registry", () => {
  it("imports every approved workbook card", () => {
    expect(GUIDANCE_CARDS.length).toBe(116);
    expect(GUIDANCE_CARDS.every((card) => card.status === "Approved")).toBe(true);
    expect(new Set(GUIDANCE_CARDS.map((card) => card.id)).size).toBe(116);
  });

  it("carries the workbook version, hash and review date", () => {
    expect(GUIDANCE_REGISTRY_VERSION).toBe("arc.guidance.v1");
    expect(GUIDANCE_REGISTRY_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(GUIDANCE_CARDS.every((card) => card.lastReviewed === "2026-09-05")).toBe(true);
  });

  it("keeps the accounting subtopics verbatim", () => {
    expect(getGuidanceCard(18).subtopic).toContain("Two-Prong");
    expect(getGuidanceCard(96).subtopic).toContain("Contract Modification");
    expect(getGuidanceCard(110).subtopic).toContain("SLA Credits");
  });

  it("matches the current workbook topic counts", () => {
    const counts = new Map<string, number>();
    for (const card of GUIDANCE_CARDS) {
      counts.set(card.topic, (counts.get(card.topic) ?? 0) + 1);
    }
    expect(counts.get("Step 1")).toBe(10);
    expect(counts.get("Step 2")).toBe(14);
    expect(counts.get("Step 3")).toBe(19);
    expect(counts.get("Step 4")).toBe(14);
    expect(counts.get("Step 5")).toBe(20);
    expect(counts.get("Special Topics / Industry Applications")).toBe(39);
  });

  it("normalizes retrieval tags and source URLs", () => {
    for (const card of GUIDANCE_CARDS) {
      expect(card.retrievalTags.length).toBeGreaterThan(0);
      expect(new Set(card.retrievalTags).size).toBe(card.retrievalTags.length);
      for (const tag of card.retrievalTags) expect(tag).toBe(tag.toLowerCase().trim());
      for (const url of card.sourceUrls) expect(url.length).toBeGreaterThan(0);
    }
  });

  it("resolves reviewed machine policy for every card and fails closed otherwise", () => {
    expect(POLICY_CARD_ID_COUNT).toBe(116);
    for (const card of GUIDANCE_CARDS) {
      const policy = getGuidancePolicy(card.id);
      expect(policy.reviewSection).toBeTruthy();
      expect(policy.proposalDomains.length).toBeGreaterThan(0);
    }
    expect(() => getGuidancePolicy(117)).toThrow(/No ARC machine policy/);
    expect(() => getGuidanceCard(117)).toThrow(/Unknown guidance card/);
  });

  it("stays current", () => {
    expect(() => assertGuidanceRegistryCurrent()).not.toThrow();
  });
});
