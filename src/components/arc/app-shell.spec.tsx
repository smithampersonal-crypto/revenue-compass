// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

async function renderAt(initialPath: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("ARC app shell (Phase 5)", () => {
  it.each(["/", "/analysis?sample=redwood"])("renders ARC chrome on %s", async (path) => {
    await renderAt(path);
    expect((await screen.findAllByText("Ayden's Revenue Compass")).length).toBeGreaterThan(0);
    expect(screen.getByText("ASC 606 Analysis Platform")).toBeInTheDocument();
    expect(screen.getByText("© 2026 Ayden's Revenue Compass (ARC)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /user login|sign up/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /user login|sign up/i })).not.toBeInTheDocument();
  });

  it("keeps the internal engine check outside recruiter-facing ARC chrome", async () => {
    await renderAt("/engine-check");
    expect(
      await screen.findByRole("heading", { name: "ASC 606 Engine Check" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ASC 606 Analysis Platform")).not.toBeInTheDocument();
    expect(screen.queryByText("© 2026 Ayden's Revenue Compass (ARC)")).not.toBeInTheDocument();
  });

  it("keeps the six-area analysis navigation horizontal and accessible", async () => {
    await renderAt("/analysis?sample=redwood");
    const nav = await screen.findByRole("navigation", { name: "Analysis areas" });
    expect(within(nav).getAllByRole("link")).toHaveLength(6);
    expect(within(nav).getByRole("link", { name: "ASC 606 Analysis" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.className).toContain("overflow-x-auto");
  });

  it("removes Lovable defaults from root metadata", () => {
    const source = readFileSync(path.join(process.cwd(), "src/routes/__root.tsx"), "utf8");
    expect(source).not.toMatch(/Lovable App|Lovable Generated Project|@Lovable|author.*Lovable/);
    expect(source).toContain("Ayden's Revenue Compass | ASC 606 Analysis Platform");
  });
});
