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
  // Deterministic order: migration replay depends on the filename timestamp,
  // never on the order the filesystem happens to return entries in.
  for (const entry of [...readdirSync(absolute)].sort()) {
    const child = path.join(absolute, entry);
    if (statSync(child).isDirectory()) {
      out.push(...walk(path.join(relative, entry), match));
    } else if (match(entry)) {
      out.push(path.join(relative, entry));
    }
  }
  return out.sort();
}

// The five migration files generated when the reviewed Post-R2 autosave
// bounding and conflict-SQLSTATE changes were applied to Cloud. The conflict
// change was submitted in four parts at routine boundaries; together with the
// autosave file they are the accepted, frozen Post-R2 database state.
const POST_R2_APPLIED: ReadonlyArray<readonly [string, string]> = [
  [
    "20260919181822_09396f1f-a301-46cb-892f-11307c442134.sql",
    "873a59fe573c22d41ac06e199e66588e3f63cac8f7aee7c2c072800f367fb3ef",
  ],
  [
    "20260919182118_0f2b88d8-edf9-459f-bf74-6f62c6e32545.sql",
    "d28de23e70491040b6c4b573757b55cfbff3a7cdb51a1c7a157ccf1d31e40064",
  ],
  [
    "20260919182256_bc74f2ad-8bdb-4c2c-a80e-44cd413c933b.sql",
    "525c40f5be0690bb1c51221d658ca88951334245cf3294420b5f7dcfc384854e",
  ],
  [
    "20260919182452_33edf847-c3f2-4853-be19-334c3068831e.sql",
    "253c558c664ea6e127100ac1da0791677e6887d569eee9dd08efb93444727305",
  ],
  [
    "20260919182906_7d2f5f4a-90a4-446c-b848-b25c6d0ec34e.sql",
    "33e4bbda628d4d2df91a0b7e7f8a1e1fb8717d082fcae70ed2f7cf1df8839421",
  ],
];

// The four parts that carry the conflict-SQLSTATE change.
const CONFLICT_MIGRATIONS = POST_R2_APPLIED.slice(1).map(([file]) => file);
const CONFLICT_ROUTINE_COUNT = 20;

/**
 * Replays `supabase/migrations` in filename order and returns the LAST
 * definition of every routine — the only definition that describes the
 * deployed function. A body ends at its dollar-quote terminator, written
 * either as `$function$;` or as `$function$` on its own line followed by `;`.
 */
function effectiveRoutineBodies(): Map<string, string> {
  const latest = new Map<string, string>();
  for (const file of walk("supabase/migrations", (f) => f.endsWith(".sql"))) {
    const text = readFileSync(path.join(root, file), "utf8");
    let current: string | null = null;
    for (const line of text.split("\n")) {
      const dropped = /drop function (?:if exists )?public\.([a-z0-9_]+)/i.exec(line);
      if (dropped) latest.delete(dropped[1]!);
      const declared = /create or replace function\s+public\.([a-z0-9_]+)/i.exec(line);
      if (declared) {
        current = declared[1]!;
        latest.set(current, "");
      }
      if (current) latest.set(current, `${latest.get(current) ?? ""}\n${line}`);
      if (current && /^\s*\$[a-z_]*\$\s*;?\s*$/i.test(line) && !declared) current = null;
    }
  }
  return latest;
}

function routinesDeclaredIn(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const text = read(path.join("supabase/migrations", file));
    for (const match of text.matchAll(/create or replace function\s+public\.([a-z0-9_]+)/gi)) {
      names.add(match[1]!);
    }
  }
  return names;
}

describe("Phase 9G release gate — frozen Task 9 migration", () => {
  it("keeps the approved restore migration byte-identical", () => {
    const sha = createHash("sha256")
      .update(readFileSync(path.join(root, TASK9_MIGRATION)))
      .digest("hex");
    expect(sha).toBe(TASK9_SHA);
  });

  it("stages no pending SQL migration", () => {
    // Post-R2: both staged files were applied to Cloud and now live in
    // migration history. Nothing may remain in `supabase/pending`, or the SQL
    // runner would reapply it on top of history and could mask an incomplete
    // applied migration.
    let pending: string[] = [];
    try {
      pending = readdirSync(path.join(root, "supabase/pending"));
    } catch {
      pending = [];
    }
    expect(pending.filter((file) => file.endsWith(".sql")).sort()).toEqual([]);
  });

  it("keeps the five accepted Post-R2 migrations byte-identical", () => {
    const actual = POST_R2_APPLIED.map(([file]) => {
      const sha = createHash("sha256")
        .update(readFileSync(path.join(root, "supabase/migrations", file)))
        .digest("hex");
      return [file, sha] as const;
    });
    expect(actual).toEqual(POST_R2_APPLIED.map(([file, sha]) => [file, sha] as const));
  });

  it("leaves no ARC-authored 40001 in any effective routine definition", () => {
    // A PostgREST client retries SQLSTATE 40001, which saturated the database
    // when ARC raised it for its own permanent business conflicts. The accepted
    // conflict migration is the last definition of every affected routine, so
    // the effective catalog must now be free of both unsafe forms.
    const offenders = [...effectiveRoutineBodies().entries()]
      .filter(
        ([, body]) =>
          body.includes("errcode = '40001'") || /exception\s+when\s+sqlstate\s+'40001'/i.test(body),
      )
      .map(([name]) => name)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("keeps the conflict migration's 20 routines effectively on PT409", () => {
    const declared = [...routinesDeclaredIn(CONFLICT_MIGRATIONS)].sort();
    expect(declared).toHaveLength(CONFLICT_ROUTINE_COUNT);

    const effective = effectiveRoutineBodies();
    const missing = declared.filter((name) => !effective.has(name));
    expect(missing).toEqual([]);

    // Every redefined routine handles the conflict under the non-retryable
    // code — raising `errcode = 'PT409'` or catching `sqlstate 'PT409'` from a
    // nested trusted call.
    const withoutPt409 = declared.filter((name) => !(effective.get(name) ?? "").includes("PT409"));
    expect(withoutPt409).toEqual([]);

    const raising = declared.filter((name) =>
      (effective.get(name) ?? "").includes("errcode = 'PT409'"),
    );
    expect(raising.length).toBeGreaterThanOrEqual(CONFLICT_ROUTINE_COUNT - 1);
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
