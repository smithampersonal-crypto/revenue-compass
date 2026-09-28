// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("Package 3D-S — About ARC", () => {
  it("A: /about renders inside ARC chrome with one h1", async () => {
    await renderAt("/about");
    expect(await screen.findByRole("heading", { level: 1, name: "About ARC" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("B/F: footer lists About, Privacy, Sitemap in order; About navigates", async () => {
    const router = await renderAt("/");
    const footer = await screen.findByRole("contentinfo");
    const nav = within(footer).getByRole("navigation", { name: "Footer" });
    const names = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(names).toEqual(["About", "Privacy", "Sitemap"]);
    expect(within(nav).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(nav).getByRole("link", { name: "Sitemap" })).toHaveAttribute("href", "/sitemap");
    fireEvent.click(within(nav).getByRole("link", { name: "About" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/about"));
    expect(await screen.findByRole("heading", { level: 1, name: "About ARC" })).toBeInTheDocument();
  });

  it("C: sitemap lists About directly before Privacy", async () => {
    await renderAt("/sitemap");
    const main = await screen.findByRole("main");
    const links = within(main)
      .getAllByRole("link")
      .map((l) => l.textContent);
    const i = links.indexOf("About");
    expect(i).toBeGreaterThan(-1);
    expect(links[i + 1]).toBe("Privacy");
    expect(within(main).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  });

  it("D: communicates the core framing", async () => {
    await renderAt("/about");
    const main = await screen.findByRole("main");
    const text = main.textContent ?? "";
    expect(text).toMatch(/Ayden's Revenue Compass/);
    expect(text).toMatch(/ASC 606/);
    expect(text).toMatch(/AI interprets contract evidence/);
    expect(text).toMatch(/Deterministic accounting engines calculate results/);
    expect(text).toMatch(/accountant owns the judgment/i);
    expect(text).toMatch(/portfolio project/i);
    expect(text).toMatch(/not a substitute for professional accounting judgment/);
    expect(text).toMatch(/not a commercial accounting system/);
    expect(text).toMatch(/does not post entries to a general ledger/);
  });

  it("E: About page has no GitHub or external source link", async () => {
    await renderAt("/about");
    const main = await screen.findByRole("main");
    for (const a of within(main).queryAllByRole("link")) {
      const href = a.getAttribute("href") ?? "";
      expect(href).not.toMatch(/github|^https?:/i);
    }
    expect(main.textContent ?? "").not.toMatch(/github|view source|repository/i);
  });
});
