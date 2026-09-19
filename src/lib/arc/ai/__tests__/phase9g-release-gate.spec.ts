/**
 * Phase 9G — Task 10. Release-gate regressions over the repository itself.
 *
 * These assertions are cheap, deterministic and exist so a future change
 * cannot quietly reopen a security or hygiene decision that Phase 9G was
 * accepted on. Nothing here contacts a database, a provider or the network.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../..");

const TASK9_MIGRATION = "supabase/migrations/20260918120000_phase9g_task9_restore_exactness.sql";
const TASK9_SHA = "3013e5370b7a12e8d266ddf4332034968bc5cc3cefb66dcb307ac04db261c251";

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function walk(relative: string, match: (file: string) => boolean): string[] {
  const absolute = path.join(root, relative);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = path.join(absolute, entry);
    if (statSync(child).isDirectory()) {
      out.push(...walk(path.join(relative, entry), match));
    } else if (match(entry)) {
      out.push(path.join(relative, entry));
    }
  }
  return out;
}

describe("Phase 9G release gate — frozen Task 9 migration", () => {
  it("keeps the approved restore migration byte-identical", () => {
    const sha = createHash("sha256")
      .update(readFileSync(path.join(root, TASK9_MIGRATION)))
      .digest("hex");
    expect(sha).toBe(TASK9_SHA);
  });

  it("carries only the one staged migration awaiting acceptance, never duplicated", () => {
    const STAGED = "20260919043000_post_r2_autosave_lock_timeout.sql";
    let pending: string[] = [];
    try {
      pending = readdirSync(path.join(root, "supabase/pending"));
    } catch {
      pending = [];
    }
    const staged = pending.filter((file) => file.endsWith(".sql"));
    // Post-R2 defect 4: exactly one staged migration, held for byte-level
    // review before any Cloud apply. It must not also exist as an applied
    // migration, and nothing else may accumulate here.
    expect(staged).toEqual([STAGED]);
    const applied = readdirSync(path.join(root, "supabase/migrations"));
    expect(applied).not.toContain(STAGED);
  });

});

describe("Phase 9G release gate — database security invariants", () => {
  const migrations = walk("supabase/migrations", (file) => file.endsWith(".sql"));

  it("gives every SECURITY DEFINER routine, as currently defined, a fixed search_path", () => {
    // Migration history is replayed in filename order, so only the LAST
    // definition of a routine describes the deployed function.
    const current = new Map<string, { file: string; header: string }>();
    for (const file of [...migrations].sort()) {
      const sql = read(file);
      const blocks = sql.split(/create\s+(?:or\s+replace\s+)?function/i).slice(1);
      for (const block of blocks) {
        const header = block.slice(0, Math.max(block.search(/\$\w*\$/), 0) + 1);
        const name = (header.split("(")[0] ?? "").trim();
        if (name) current.set(name, { file, header });
      }
    }
    const offenders = [...current.entries()]
      .filter(
        ([, definition]) =>
          /security\s+definer/i.test(definition.header) &&
          !/set\s+search_path\s*(=|to)/i.test(definition.header),
      )
      .map(([name, definition]) => `${definition.file}: ${name}`);
    expect(offenders).toEqual([]);
  });

  it("keeps the Task 9 restore routine definer-scoped and service-role only", () => {
    const sql = read(TASK9_MIGRATION);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, public");
    expect(sql).toContain(
      "grant execute on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer)\n  to service_role;",
    );
    expect(sql).toContain(
      "revoke all on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer)\n  from public, anon, authenticated;",
    );
  });

  it("never grants a browser role execute on a Phase 9 trusted routine", () => {
    const trusted = [
      "arc_create_ai_run",
      "arc_reserve_ai_allowance",
      "arc_apply_ai_run",
      "arc_restore_pre_ai_run",
      "arc_affirm_ai_review_item",
      "arc_resolve_ai_review_issue",
      "arc_acknowledge_ai_stale_sources",
      "arc_save_draft_with_ai_reconciliation",
    ];
    const offenders: string[] = [];
    for (const file of migrations) {
      for (const line of read(file).split("\n")) {
        const lowered = line.toLowerCase();
        if (!lowered.includes("grant execute")) continue;
        if (!trusted.some((name) => lowered.includes(name))) continue;
        if (/\b(anon|authenticated|public)\b/.test(lowered.split(" to ")[1] ?? "")) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Phase 9G release gate — browser boundary", () => {
  const clientModules = walk("src/lib/arc/ai", (file) => file.endsWith(".ts")).filter(
    (file) => !file.includes(".server.") && !file.includes("__tests__"),
  );

  // `orchestrator.ts` is pure but server-executed: it types the server-only
  // provider boundaries it is handed. Client reachability itself is proven by
  // `audit:bundle`, which scans the built browser assets.
  const browserSafeModules = clientModules.filter((file) => !file.endsWith("orchestrator.ts"));

  it("persists no AI lifecycle state in browser storage", () => {
    const offenders = clientModules.filter((file) =>
      /localStorage|sessionStorage|indexedDB/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("logs nothing from the browser-safe AI modules", () => {
    const offenders = clientModules.filter((file) =>
      /console\.(log|info|warn|error)/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("imports no server-only AI module from a browser-safe one", () => {
    const offenders: string[] = [];
    for (const file of browserSafeModules) {
      for (const line of read(file).split("\n")) {
        if (/^\s*import\s[^;]*from\s+["'][^"']*\.server["']/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Phase 9G release gate — suite hygiene", () => {
  const specs = walk("src", (file) => file.endsWith(".spec.ts") || file.endsWith(".spec.tsx"));

  it("contains no focused or skipped acceptance test", () => {
    const offenders = specs.filter((file) =>
      /(describe|it|test)\.(only|skip)\s*\(|\bit\.todo\s*\(/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});
