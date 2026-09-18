import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const routes = path.resolve(import.meta.dirname);

function source(file: string): string {
  return readFileSync(path.join(routes, file), "utf8");
}

describe("Task 9C restore placement", () => {
  it("mounts the single restore action only on Review & Finalize", () => {
    expect(source("review.tsx")).toContain("<AiRestoreAction ai={ai} />");

    for (const file of ["route.tsx", "index.tsx", "schedule.tsx", "balances.tsx", "journals.tsx", "documents.tsx"]) {
      expect(source(file), file).not.toContain("<AiRestoreAction");
    }
  });
});