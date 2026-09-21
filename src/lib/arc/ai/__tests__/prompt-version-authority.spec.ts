/**
 * Package 2C-A acceptance patch — prompt provenance truthfulness.
 *
 * A live run must never record a prompt version different from the instruction
 * body it actually received. The version is a compiled constant with no
 * environment relabelling seam.
 */

import { describe, expect, it, vi } from "vitest";

import { buildGuidancePack } from "@/lib/arc/guidance/retrieval";

import { AI_LIMITS } from "../config.server";
import { AI_PROMPT_VERSION, buildAiInstructions } from "../prompt";

function liveInstructions(): string {
  return buildAiInstructions({
    guidance: buildGuidancePack({ normalizedEvidenceText: "saas subscription hosted platform" }),
    sources: [],
    arcContextFacts: {},
  });
}

describe("prompt version authority", () => {
  it("is the compiled 2C constant", () => {
    expect(AI_PROMPT_VERSION).toBe("arc.ai.prompt.v10");
  });

  it("records exactly the version the instruction body states", () => {
    expect(AI_LIMITS.promptVersion).toBe(AI_PROMPT_VERSION);
    expect(liveInstructions()).toContain(`promptVersion: ${AI_LIMITS.promptVersion}`);
  });

  it("cannot be relabelled through the environment", async () => {
    vi.resetModules();
    vi.stubEnv("ARC_AI_PROMPT_VERSION", "arc.ai.prompt.v9");
    try {
      const { AI_LIMITS: relabelled } = await import("../config.server");
      const { AI_PROMPT_VERSION: compiled } = await import("../prompt");
      expect(relabelled.promptVersion).toBe(compiled);
      expect(relabelled.promptVersion).not.toBe("arc.ai.prompt.v9");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("leaves no environment relabelling seam in the configuration source", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../config.server.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/process\.env\[["']ARC_AI_PROMPT_VERSION["']\]/);
  });
});
