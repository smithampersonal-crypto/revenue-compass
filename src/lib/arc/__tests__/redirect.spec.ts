import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, sanitizeLocalPath } from "../redirect";

describe("sanitizeLocalPath", () => {
  it("accepts ARC-local paths", () => {
    expect(sanitizeLocalPath("/workspace")).toBe("/workspace");
    expect(sanitizeLocalPath("/analysis")).toBe("/analysis");
    expect(sanitizeLocalPath("/analysis?contract=8f14e45f-ceea-4d3c-8b5a-1f4d2a3b4c5d")).toBe(
      "/analysis?contract=8f14e45f-ceea-4d3c-8b5a-1f4d2a3b4c5d",
    );
    expect(sanitizeLocalPath("/analysis?sample=redwood")).toBe("/analysis?sample=redwood");
  });

  it("rejects off-site and scheme payloads", () => {
    for (const hostile of [
      "https://evil.example",
      "http://evil.example/analysis",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/javascript:alert(1)",
      "data:text/html,<script>",
      "analysis",
      "",
      "   ",
      "/analysis\n/evil",
      null,
      undefined,
      42,
      { toString: () => "/analysis" },
    ]) {
      expect(sanitizeLocalPath(hostile)).toBe(DEFAULT_SIGNED_IN_PATH);
    }
  });

  it("honours an explicit safe fallback", () => {
    expect(sanitizeLocalPath("https://evil.example", "/analysis")).toBe("/analysis");
  });
});
