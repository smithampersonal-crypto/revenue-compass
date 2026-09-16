import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  deriveCanonicalId,
  fieldKeys,
  resolveUniqueId,
  slugify,
  stableHash,
  valueFingerprint,
} from "../identity";

describe("deterministic identity primitives", () => {
  it("hashes deterministically and differentiates inputs", () => {
    expect(stableHash("alpha")).toBe(stableHash("alpha"));
    expect(stableHash("alpha")).not.toBe(stableHash("alphb"));
  });

  it("serializes objects by sorted key, so key order cannot change identity", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(
      canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }),
    );
    expect(valueFingerprint({ b: 1, a: 2 })).toBe(valueFingerprint({ a: 2, b: 1 }));
    expect(valueFingerprint("120000")).not.toBe(valueFingerprint(120000));
  });

  it("derives readable, stable, kind-scoped canonical IDs", () => {
    const id = deriveCanonicalId("promise", "promise:saas");
    expect(id).toBe(deriveCanonicalId("promise", "promise:saas"));
    expect(id).toContain("promise");
    expect(id).not.toBe(deriveCanonicalId("performance_obligation", "promise:saas"));
    expect(id).not.toBe(deriveCanonicalId("promise", "promise:support"));
  });

  it("slugs unicode and punctuation without ever producing an empty slug", () => {
    expect(slugify("  SaaS  Subscription — Tier 1 ")).toBe("saas-subscription-tier-1");
    expect(slugify("—")).not.toBe("");
  });

  it("resolves collisions deterministically instead of overwriting", () => {
    const taken = new Set(["po-saas"]);
    const resolved = resolveUniqueId("po-saas", taken);
    expect(resolved).not.toBe("po-saas");
    expect(resolveUniqueId("po-saas", taken)).toBe(resolved);
    expect(resolveUniqueId("po-support", taken)).toBe("po-support");
  });

  it("builds field keys from identity, never from array position", () => {
    expect(fieldKeys.promise("promise-a", "description")).not.toContain("0");
    expect(fieldKeys.promise("promise-a", "description")).not.toBe(
      fieldKeys.promise("promise-b", "description"),
    );
  });
});
