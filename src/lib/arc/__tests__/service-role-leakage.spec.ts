import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("service-role secret leakage guardrail", () => {
  it("keeps the service-role key out of .env and .env.example", () => {
    for (const file of [".env", ".env.example", ".env.local"]) {
      const contents = readIfPresent(join(ROOT, file));
      expect(contents).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S/);
      expect(contents).not.toMatch(/\bsb_secret_/);
      expect(contents).not.toMatch(/"role"\s*:\s*"service_role"/);
    }
  });

  it("never references the service-role key from browser-reachable modules", () => {
    const offenders: string[] = [];
    for (const file of collectFiles(join(ROOT, "src"))) {
      // *.server.ts / client.server.ts are blocked from client bundles by name.
      if (/\.server\.tsx?$/.test(file)) continue;
      if (file === __filename) continue;
      const contents = readFileSync(file, "utf8");
      if (contents.includes("SUPABASE_SERVICE_ROLE_KEY") || contents.includes("supabaseAdmin")) {
        // A dynamic import inside a server handler is the approved pattern.
        if (!/await import\(/.test(contents)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
