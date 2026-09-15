/**
 * Phase 9C acceptance patch — the source-set fingerprint is immutable run
 * provenance, so it must be deterministic and sensitive to identity only.
 */

import { describe, expect, it } from "vitest";

import { computeSourceSetFingerprint } from "../source-fingerprint";

const A = { documentId: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64) };
const B = { documentId: "22222222-2222-4222-8222-222222222222", sha256: "b".repeat(64) };

describe("source-set fingerprint", () => {
  it("is stable for the same selection", async () => {
    await expect(computeSourceSetFingerprint([A, B])).resolves.toBe(
      await computeSourceSetFingerprint([A, B]),
    );
  });

  it("ignores the order the documents arrive in", async () => {
    await expect(computeSourceSetFingerprint([B, A])).resolves.toBe(
      await computeSourceSetFingerprint([A, B]),
    );
  });

  it("changes when a selected document changes", async () => {
    const base = await computeSourceSetFingerprint([A, B]);
    await expect(computeSourceSetFingerprint([A])).resolves.not.toBe(base);
    await expect(
      computeSourceSetFingerprint([A, { ...B, sha256: "c".repeat(64) }]),
    ).resolves.not.toBe(base);
    await expect(
      computeSourceSetFingerprint([A, { ...B, documentId: "33333333-3333-4333-8333-333333333333" }]),
    ).resolves.not.toBe(base);
  });

  it("is a SHA-256 hex digest, and an empty selection still has one", async () => {
    const empty = await computeSourceSetFingerprint([]);
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
    expect(empty).not.toBe(await computeSourceSetFingerprint([A]));
  });
});
