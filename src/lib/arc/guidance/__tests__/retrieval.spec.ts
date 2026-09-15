import { describe, expect, it } from "vitest";

import { CORE_GUIDANCE_IDS } from "../policy";
import { buildGuidancePack, normalizeSignalText } from "../retrieval";
import type { GuidancePack } from "../types";

function ids(pack: GuidancePack, reason?: "core" | "retrieved" | "dependency"): number[] {
  return pack.inclusions
    .filter((inclusion) => (reason ? inclusion.reason === reason : true))
    .map((inclusion) => inclusion.cardId);
}

/** Deterministic Genomix/Synthesis hosted-SaaS fixture (no PDF, no OpenAI). */
export const GENOMIX_FIXTURE = normalizeSignalText(`
  Synthesis Bio grants Genomix hosted access to the Synthesis sequencing platform
  for an initial 24-month subscription term. The annual platform fee of $245,000 is
  billed annually in advance, payment due Net 30 from the invoice date.
  Sequencing overages are billed quarterly in arrears at $1.35 per sample above the
  included volume. Synthesis commits to 99.95% uptime; if monthly uptime falls below
  the commitment, Genomix receives service credits of 15%, 30% or 50% of the monthly fee.
`);

describe("deterministic guidance pack retrieval", () => {
  it("includes the curated minimal core pack in every pack", () => {
    const pack = buildGuidancePack({ normalizedEvidenceText: "" });
    expect(ids(pack, "core")).toEqual([...CORE_GUIDANCE_IDS].sort((a, b) => a - b));
    expect(pack.registryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retrieves material-right guidance for a discounted renewal option", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "The customer has a renewal option to extend for 12 months at a discounted renewal rate of 20% below list price.",
      ),
    });
    expect(ids(pack)).toContain(78);
    for (const id of [79, 80, 81]) expect(ids(pack)).toContain(id);
  });

  it("does not retrieve the material-right package from the word discount alone", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText("A discount applies to the annual fee."),
    });
    for (const id of [78, 79, 80, 81]) expect(ids(pack)).not.toContain(id);
  });

  it("does not retrieve contract-cost amortization guidance from a renewal alone", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "The subscription renews for a further renewal term unless either party gives notice.",
      ),
    });
    expect(ids(pack)).not.toContain(104);
  });

  it("retrieves contract-cost guidance only with commission-asset context", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "The capitalized commission asset is amortized over the expected period and tested for impairment.",
      ),
    });
    expect(ids(pack)).toContain(104);
  });

  it("routes the umbrella label variable consideration through gateway Card 27", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "The arrangement includes variable consideration.",
      ),
    });
    const retrieved = ids(pack, "retrieved");
    expect(retrieved).toEqual([27]);
    for (const id of [28, 29, 30, 32, 34]) {
      expect(pack.inclusions.find((i) => i.cardId === id)?.reason).toBe("dependency");
    }
  });

  it("routes the umbrella label contract modification through gateway Card 96", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText("There was a contract modification."),
    });
    expect(ids(pack, "retrieved")).toEqual([96]);
    for (const id of [97, 98, 99]) {
      expect(pack.inclusions.find((i) => i.cardId === id)?.reason).toBe("dependency");
    }
  });

  it("routes the umbrella label material right through gateway Card 78", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText("The option conveys a material right."),
    });
    expect(ids(pack, "retrieved")).toEqual([78]);
    for (const id of [79, 80, 81]) {
      expect(pack.inclusions.find((i) => i.cardId === id)?.reason).toBe("dependency");
    }
  });

  it("does not retrieve Card 109 from simple per-unit overage pricing", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "Usage above the included volume is billed as overages at $1.35 per sample.",
      ),
    });
    expect(ids(pack)).not.toContain(109);
    expect(ids(pack)).toContain(27);
  });

  it("retrieves Card 109 for a minimum commitment with tiered overage structure", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "Customer has an annual minimum commitment with tiered pricing and a retrospective volume discount on overages.",
      ),
    });
    expect(ids(pack)).toContain(109);
  });

  it("retrieves modification guidance for an approved amendment or change order", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "The parties executed an amendment and change order adding additional goods or services after inception.",
      ),
    });
    expect(pack.inclusions.find((i) => i.cardId === 96)?.reason).toBe("retrieved");
    for (const id of [97, 98, 99]) {
      expect(pack.inclusions.find((i) => i.cardId === id)?.reason).toBe("dependency");
    }
  });

  it("retrieves variable consideration, the constraint and SLA guidance for SaaS service credits", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "The SaaS agreement provides service credits when monthly uptime falls below the 99.9% SLA.",
      ),
    });
    for (const id of [27, 32, 110]) expect(ids(pack)).toContain(id);
  });

  it("does not retrieve SLA guidance from the word SaaS alone", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText("This is a SaaS agreement."),
    });
    expect(ids(pack)).not.toContain(110);
  });

  it("retrieves contract-balance guidance for invoicing and payment terms", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "Fees are billed in advance by invoice with payment due Net 30.",
      ),
    });
    expect(ids(pack)).toContain(100);
    expect(ids(pack)).toContain(101);
  });

  it("treats Card 92 as hosted-scope disambiguation without pulling license-treatment cards", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: normalizeSignalText(
        "Customer receives hosted access to the platform. No software is delivered and no license rights transfer.",
      ),
    });
    expect(ids(pack)).toContain(92);
    for (const id of [93, 94, 95]) expect(ids(pack)).not.toContain(id);
  });

  it("produces a deterministic, duplicate-free, priority-ordered pack", () => {
    const first = buildGuidancePack({ normalizedEvidenceText: GENOMIX_FIXTURE });
    const second = buildGuidancePack({ normalizedEvidenceText: GENOMIX_FIXTURE });
    expect(ids(first)).toEqual(ids(second));
    expect(new Set(ids(first)).size).toBe(ids(first).length);
    const order = first.inclusions.map((inclusion) => inclusion.reason);
    const rank = { core: 0, retrieved: 1, dependency: 2 } as const;
    expect(order.map((reason) => rank[reason])).toEqual(
      [...order.map((reason) => rank[reason])].sort((a, b) => a - b),
    );
    expect(first.cards.map((card) => card.id)).toEqual(ids(first));
  });

  it("builds the expected Genomix hosted-SaaS pack", () => {
    const pack = buildGuidancePack({ normalizedEvidenceText: GENOMIX_FIXTURE });
    for (const id of [27, 32, 92, 100, 101, 110]) expect(ids(pack)).toContain(id);
    for (const id of [93, 94, 95]) expect(ids(pack)).not.toContain(id);
    expect(pack.inclusions.find((inclusion) => inclusion.cardId === 110)?.matchedSignals).toContain(
      "uptime",
    );
  });

  it("explains every inclusion without quoting the contract", () => {
    const pack = buildGuidancePack({ normalizedEvidenceText: GENOMIX_FIXTURE });
    for (const inclusion of pack.inclusions) {
      if (inclusion.reason === "core") expect(inclusion.matchedSignals).toEqual([]);
      if (inclusion.reason === "retrieved")
        expect(inclusion.matchedSignals.length).toBeGreaterThan(0);
      if (inclusion.reason === "dependency")
        expect(inclusion.matchedSignals[0]).toMatch(/^depends_on:\d+$/);
      for (const signal of inclusion.matchedSignals) expect(signal.length).toBeLessThan(60);
    }
  });

  it("accepts ARC fact signals alongside evidence text", () => {
    const pack = buildGuidancePack({
      normalizedEvidenceText: "",
      arcFactSignals: ["service credit", "uptime"],
    });
    expect(ids(pack)).toContain(110);
  });
});
