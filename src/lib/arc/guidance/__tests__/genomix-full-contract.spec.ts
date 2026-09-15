/**
 * Phase 9B acceptance patch — Finding 5.
 *
 * Retrieval precision against the COMPLETE four-page Genomix contract. The
 * short Phase 9A fixture never contained the incidental corporate, usage-
 * restriction and product-tier wording that produced contextual false
 * positives, so these regressions run on the full corpus.
 *
 * The rules under test are general deterministic retrieval rules: an umbrella
 * label is contextual, and an accounting-specific curated phrase is what
 * selects a specialised card. Nothing here is keyed to this contract.
 */

import { describe, expect, it } from "vitest";

import { buildGuidancePack } from "../retrieval";
import { GENOMIX_FULL_CONTRACT_TEXT } from "./genomix-fixture";

const pack = buildGuidancePack({ normalizedEvidenceText: GENOMIX_FULL_CONTRACT_TEXT });
const included = new Map(pack.inclusions.map((inclusion) => [inclusion.cardId, inclusion]));

function reasonFor(cardId: number): string | undefined {
  return included.get(cardId)?.reason;
}

describe("full Genomix contract — expected guidance is present", () => {
  it("retrieves hosted-access / SaaS scope guidance", () => {
    expect(reasonFor(92)).toBe("retrieved");
    expect(included.get(92)!.matchedSignals).toContain("saas platform");
  });

  it("retrieves usage, per-sample and overage variable-consideration guidance", () => {
    expect(reasonFor(27)).toBe("retrieved");
    expect(included.get(27)!.matchedSignals).toEqual(
      expect.arrayContaining(["overage", "service credit"]),
    );
    expect(reasonFor(107)).toBe("retrieved");
    // The foundational VC package arrives through the gateway card.
    for (const dependent of [28, 29, 30, 32]) {
      expect(reasonFor(dependent)).toBe("dependency");
    }
  });

  it("retrieves Net 30 invoicing and advance-billing contract-balance guidance", () => {
    expect(reasonFor(101)).toBe("retrieved");
    expect(included.get(101)!.matchedSignals).toEqual(
      expect.arrayContaining(["net 30", "invoice date"]),
    );
    expect(reasonFor(115)).toBe("retrieved");
    expect(reasonFor(100)).toBe("core");
  });

  it("retrieves SLA / uptime / service-credit guidance", () => {
    expect(reasonFor(110)).toBe("retrieved");
    expect(included.get(110)!.matchedSignals).toEqual(
      expect.arrayContaining(["uptime", "service credit"]),
    );
  });
});

describe("full Genomix contract — contextual false positives stay out", () => {
  it("does not retrieve noncash consideration from an incidental equity interest", () => {
    expect(GENOMIX_FULL_CONTRACT_TEXT).toContain("equity interest");
    expect(included.has(40)).toBe(false);
  });

  it("does not retrieve repurchase guidance from incidental lease wording", () => {
    expect(GENOMIX_FULL_CONTRACT_TEXT).toContain("lease or white-label");
    expect(included.has(90)).toBe(false);
  });

  it("does not retrieve licence-transfer guidance without licence-transfer facts", () => {
    for (const cardId of [93, 94, 95]) expect(included.has(cardId)).toBe(false);
  });

  it("does not retrieve commitment/tier guidance from product tiers and per-unit overages", () => {
    expect(included.has(109)).toBe(false);
  });

  it("does not retrieve shipping guidance from this contract", () => {
    // Card 17 was flagged as possibly loose. On the full corpus it is absent:
    // its curated signals (freight, shipping and handling) are not present.
    expect(included.has(17)).toBe(false);
  });
});

describe("general retrieval rules, proven without this contract", () => {
  const only = (text: string) => new Set(buildGuidancePack({ normalizedEvidenceText: text })
    .inclusions.filter((i) => i.reason === "retrieved").map((i) => i.cardId));

  it("equity alone is contextual; equity paid as consideration is not", () => {
    expect(only("the affiliate holds a majority equity interest")).not.toContain(40);
    expect(only("customer pays part of the fee as equity consideration")).toContain(40);
  });

  it("lease alone is contextual; a repurchase construct is not", () => {
    expect(only("customer shall not lease the outputs")).not.toContain(90);
    expect(only("provider grants the customer a put option to repurchase the unit")).toContain(90);
  });

  it("per-unit overage alone is contextual; a committed volume is not", () => {
    expect(only("overage billed at $1.35 per sample")).not.toContain(109);
    expect(only("customer accepts a minimum commitment with tiered pricing")).toContain(109);
  });
});
