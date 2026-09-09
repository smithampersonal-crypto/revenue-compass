// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("renders the compact recruiter-facing landing hierarchy", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "ASC 606 analysis, from contract judgment to journal entry.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analyze Your Contract" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Try a Sample Contract" })).toBeInTheDocument();
    expect(screen.getByText("Accountant-owned judgments")).toBeInTheDocument();
    expect(screen.getByText("Deterministic calculations")).toBeInTheDocument();
    expect(screen.getByText("Traceable workpaper")).toBeInTheDocument();
    expect(screen.queryByText("Demo mode")).not.toBeInTheDocument();

    for (const output of [
      "ASC 606 Analysis",
      "Revenue Schedule",
      "Contract Balances",
      "Journal Entries",
      "Review & Finalize",
    ]) {
      expect(screen.getByText(output)).toBeInTheDocument();
    }
    expect(screen.queryByText("Source Documents")).not.toBeInTheDocument();
  });

  it("offers one Redwood sample path and no legacy sample grid", async () => {
    await renderAt("/");

    const sampleLinks = screen.getAllByRole("link").filter((link) =>
      link.getAttribute("href")?.includes("sample="),
    );
    expect(sampleLinks).toHaveLength(1);
    expect(sampleLinks[0]).toHaveAttribute("href", "/analysis?sample=redwood");
    for (const hiddenSample of ["Apex Manufacturing", "Horizon Logistics", "Stellar", "Meridian Health"]) {
      expect(screen.queryByText(hiddenSample)).not.toBeInTheDocument();
    }
  });

  it("routes Start Analysis to a blank workspace and Try the Sample to Redwood", async () => {
    const user = userEvent.setup();
    const router = await renderAt("/");

    await user.click(screen.getByRole("link", { name: "Start Analysis" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/analysis"));
    expect(router.state.location.search).toEqual({});

    await user.click(screen.getByRole("link", { name: "Ayden's Revenue Compass home" }));
    await user.click(await screen.findByRole("link", { name: "Try the Sample" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/analysis");
      expect(router.state.location.search).toEqual({ sample: "redwood" });
    });
  });

  it("shows only enabled global navigation and exposes no unfinished controls", async () => {
    const user = userEvent.setup();
    const router = await renderAt("/");
    const primaryNav = screen.getByRole("navigation", { name: "Primary navigation" });

    expect(within(primaryNav).getAllByRole("link")).toHaveLength(1);
    expect(within(primaryNav).getByRole("link", { name: "Analyze" })).toBeInTheDocument();
    expect(within(primaryNav).queryByText("Case Studies")).not.toBeInTheDocument();
    expect(within(primaryNav).queryByText("Guidance Library")).not.toBeInTheDocument();

    for (const label of [/login/i, /sign up/i, /upload contract/i, /^ai$/i, /coming soon/i]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }

    await user.click(within(primaryNav).getByRole("link", { name: "Analyze" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/analysis"));
    expect(router.state.location.search).toEqual({});
  });
});
