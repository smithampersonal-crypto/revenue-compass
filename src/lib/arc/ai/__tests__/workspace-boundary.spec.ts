/**
 * Phase 9G — Task 3. The new browser boundary must stay server-safe.
 *
 * The workspace handlers and the failure registry are browser-reachable, so
 * they may not name service-role code, the provider SDK, prompts or the raw
 * persistence store. The server functions accept only resource targets and
 * displayed fingerprints — never owner identity, quota or provider settings.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const BROWSER_REACHABLE = [
  "src/lib/arc/ai/workspace.handlers.ts",
  "src/lib/arc/ai/failure-presentation.ts",
];

describe("Task 3 browser boundary", () => {
  it("keeps server-only material out of browser-reachable modules", () => {
    for (const file of BROWSER_REACHABLE) {
      const contents = read(file);
      for (const forbidden of [
        ["supabase", "Admin"].join(""),
        ["client", "server"].join("."),
        ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_"),
        ["OPENAI", "API", "KEY"].join("_"),
        ["workspace", "store", "server"].join("."),
        ["runs", "store", "server"].join("."),
        ["terra", "server"].join("."),
        ["openai", "server"].join("."),
        "responses.create",
        "arc_create_ai_run",
        "arc_affirm_ai_review_item",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  it("loads server-only modules inside handlers only", () => {
    const functions = read("src/lib/arc/ai/workspace.functions.ts");
    for (const serverOnly of ["./workspace.store.server", "./config.server", "./caller.server"]) {
      expect(functions).toContain(`import("${serverOnly}")`);
      expect(functions).not.toContain(`from "${serverOnly}"`);
    }
  });

  it("exposes exactly the five Task 3 server functions", () => {
    const functions = read("src/lib/arc/ai/workspace.functions.ts");
    const exported = [...functions.matchAll(/export const (\w+) = createServerFn/g)].map(
      (match) => match[1],
    );
    expect(exported.sort()).toEqual([
      "acknowledgeAiStaleSources",
      "affirmAiReviewItem",
      "getAiWorkspaceState",
      "requestAiAnalysis",
      "resolveAiReviewIssue",
    ]);
  });

  it("accepts no browser-authored authority", () => {
    const functions = read("src/lib/arc/ai/workspace.functions.ts");
    for (const forbidden of [
      "ownerUserId",
      "actorUserId",
      "guestTokenHash",
      "guestWorkspaceId",
      "quotaScope",
      "expectedLockVersion",
      "userMonthlyRunLimit",
      "guestRunLimit",
      "model:",
      "reasoningEffort",
      "promptVersion",
    ]) {
      expect(functions).not.toContain(forbidden);
    }
  });

  it("keeps one shared caller-resolution implementation", () => {
    const runs = read("src/lib/arc/ai/runs.functions.ts");
    expect(runs).toContain('import("./caller.server")');
    // The duplicated bearer-verification body must be gone from the run layer.
    expect(runs).not.toContain("auth.getClaims");
    expect(runs).not.toContain("hashGuestToken");
  });

  it("reads AI state through the frozen Phase 9F run surface only", () => {
    const handlers = read("src/lib/arc/ai/workspace.handlers.ts");
    // Task 3 wraps the accepted handlers; it does not re-implement them.
    expect(handlers).toContain('from "./runs.handlers"');
    expect(handlers).toContain('from "./review-actions.handlers"');
  });
});
