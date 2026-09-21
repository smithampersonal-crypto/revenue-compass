import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const workflowFields = readFileSync(
  new URL("../../components/asc606-workflow/fields.tsx", import.meta.url),
  "utf8",
);

describe("ARC visual system", () => {
  it("uses one light color scheme without a dark token override", () => {
    expect(styles).toContain("color-scheme: light");
    expect(styles).not.toContain("color-scheme: dark");
    expect(styles).not.toMatch(/\.dark\s*\{/);
  });

  it("keeps primary, warning, and destructive semantics distinct", () => {
    const token = (name: string) =>
      styles.match(new RegExp(`--${name}:\\s*(oklch\\([^;]+\\))`))?.[1];

    const primary = token("primary");
    const warning = token("warning");
    const destructive = token("destructive");

    expect(primary).toBeDefined();
    expect(warning).toBeDefined();
    expect(destructive).toBeDefined();
    expect(new Set([primary, warning, destructive]).size).toBe(3);
  });

  it("separates filled destructive controls from pale danger notices", () => {
    expect(styles).toContain("--destructive-foreground: oklch(1 0 0)");
    expect(workflowFields).toContain('border-destructive/40 bg-destructive/10 text-destructive"');
    expect(workflowFields).not.toContain(
      "border-destructive/40 bg-destructive/10 text-destructive-foreground",
    );
  });
});
