/**
 * Phase 9G-R Task R1. The accountant's own entries, as facts.
 *
 * Pure: no database, React, OpenAI, network, environment, clock or randomness.
 *
 * A structural flag that is still at its created-empty default is not an
 * accountant fact: reporting `hasVariableConsideration: false` for an untouched
 * workpaper tells the analysis the accountant concluded there is none, which is
 * a conclusion nobody made. Untouched false structural defaults are therefore
 * omitted; an affirmative structure is always reported.
 */

/** Structural flags whose pristine `false` state carries no accountant meaning. */
const STRUCTURAL_FLAGS: readonly string[] = [
  "hasVariableConsideration",
  "hasContractModifications",
  "hasMaterialRights",
  "hasFinancingComponent",
];

/** Deterministic, bounded snapshot of the accountant's own entries. */
export function manualAccountingFacts(
  draft: unknown,
): Record<string, string | number | boolean | null> {
  const facts: Record<string, string | number | boolean | null> = {};
  const visit = (value: unknown, prefix: string, depth: number): void => {
    if (depth > 2 || value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (Object.keys(facts).length >= 60) return;
      const path = prefix ? `${prefix}.${key}` : key;
      if (entry === null) continue;
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        if (typeof entry === "string" && entry.trim() === "") continue;
        if (entry === false && STRUCTURAL_FLAGS.includes(key)) continue;
        facts[path] = entry;
      } else if (!Array.isArray(entry)) {
        visit(entry, path, depth + 1);
      }
    }
  };
  visit(draft, "", 0);
  return facts;
}
