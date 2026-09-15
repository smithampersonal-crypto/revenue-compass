import { describe, expect, it } from "vitest";

import {
  assertPolicyClassificationsTotal,
  CORE_GUIDANCE_IDS,
  getGuidancePolicy,
  POLICY_CARD_ID_COUNT,
  POLICY_CARD_IDS,
} from "../policy";
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

  it("classifies engine support exactly once for every approved card", () => {
    expect(() => assertPolicyClassificationsTotal()).not.toThrow();
    const tiers = new Set(["full", "partial", "advisory_only", "not_supported"]);
    expect(POLICY_CARD_IDS.length).toBe(116);
    for (const id of POLICY_CARD_IDS) {
      expect(tiers.has(getGuidancePolicy(id).engineSupport)).toBe(true);
    }
  });

  it("applies the reviewed engine-support corrections", () => {
    const expected: Record<number, string> = {
      3: "partial",
      25: "partial",
      33: "partial",
      58: "partial",
      59: "partial",
      62: "partial",
      69: "partial",
      70: "partial",
      71: "partial",
      80: "not_supported",
      105: "partial",
      108: "full",
      109: "not_supported",
      113: "partial",
    };
    for (const [id, support] of Object.entries(expected)) {
      expect(getGuidancePolicy(Number(id)).engineSupport).toBe(support);
    }
  });

  it("uses explicitly reviewed finalization impact", () => {
    expect(CORE_GUIDANCE_IDS).toEqual([1, 11, 18, 25, 44, 45, 46, 58, 59, 69, 100]);
    for (const id of CORE_GUIDANCE_IDS) {
      expect(getGuidancePolicy(id).finalizationImpact).toBe("block");
    }
    // Contract-cost and portfolio-expedient topics sit outside the revenue engine.
    for (const id of [102, 103, 104, 116]) {
      expect(getGuidancePolicy(id).finalizationImpact).toBe("warn");
    }
    // Unsupported revenue matters must be able to block, not merely warn.
    for (const id of [80, 83, 85, 109, 112]) {
      expect(getGuidancePolicy(id).finalizationImpact).toBe("block");
    }
  });
});
