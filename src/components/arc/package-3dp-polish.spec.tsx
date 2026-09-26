// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JournalEntryOutputs } from "@/components/asc606-workflow/JournalEntryOutputs";
import type { JournalAnalysis } from "@/lib/asc606-journals";
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

describe("Package 3D-P polish", () => {
  it("pairs the three feature icons with unchanged labels and drops the eyebrow", async () => {
    await renderAt("/");
    for (const label of [
      "Accountant-owned judgments",
      "Deterministic calculations",
      "Traceable review",
    ]) {
      const heading = await screen.findByRole("heading", { name: label });
      const svg = heading.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.queryByText(/ARC · ASC 606 Analysis Platform/i)).toBeNull();
  });

  it("uses the ARC logo in the home link and a single Sign in link with an icon", async () => {
    await renderAt("/");
    const home = await screen.findByRole("link", { name: "Ayden's Revenue Compass home" });
    expect(home.querySelector("img")).not.toBeNull();
    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute("href", "/auth");
    expect(signIn.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("renders footer links and Noun Project attribution", async () => {
    await renderAt("/");
    const footer = await screen.findByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(within(footer).getByRole("link", { name: "Sitemap" })).toHaveAttribute(
      "href",
      "/sitemap",
    );
    expect(
      within(footer).getByText(
        /Icons by Fajriah Robiatul Adawiah, Afqoh, rendicon, and Nur Khasan/,
      ),
    ).toBeInTheDocument();
  });

  it("serves /privacy with the privacy contact", async () => {
    await renderAt("/privacy");
    expect(await screen.findByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "arcompass.developer@gmail.com" })).toHaveAttribute(
      "href",
      "mailto:arcompass.developer@gmail.com",
    );
    expect(screen.queryByText(/SOC 2|HIPAA|bank-grade/i)).toBeNull();
  });

  it("serves /sitemap without internal routes", async () => {
    await renderAt("/sitemap");
    const main = await screen.findByRole("main");
    const hrefs = within(main)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/",
        "/analysis",
        "/auth",
        "/workspace",
        "/account",
        "/privacy",
        "/sitemap",
      ]),
    );
    for (const href of hrefs) {
      expect(href).not.toMatch(/callback|engine-check|\/api\//);
    }
  });

  it("shows Jump to top on workpapers without navigating", async () => {
    const router = await renderAt("/analysis/journals?sample=horizon");
    const button = await screen.findByRole("button", { name: /Jump to top of page/ });
    expect(button).not.toBeDisabled();
    const target = document.getElementById("analysis-top")!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    const before = router.state.location.href;
    fireEvent.click(button);
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    expect(router.state.location.href).toBe(before);
  });

  it("keeps Sample label while dropping fictional descriptors", async () => {
    await renderAt("/analysis?sample=horizon");
    expect(await screen.findByText("Sample — Horizon Logistics")).toBeInTheDocument();
    expect(screen.queryByText("Fictional sample contract")).toBeNull();
    expect(screen.queryByText(/Sample Analysis — Fictional Contract/i)).toBeNull();
  });

  it("replaces the reconciliation tile with a summary bar on journal output", () => {
    const analysis = {
      validation: { status: "passed", results: [], blockingFailures: [] },
      entries: [
        {
          id: "e1",
          date: "2026-01-31",
          month: "2026-01",
          eventType: "revenue_recognition",
          sourceId: null,
          description: "x",
          lines: [],
          totalDebitsCents: 12500,
          totalCreditsCents: 12500,
        },
      ],
      ledgerByMonth: [],
      reconciliation: {
        allEntriesBalanced: true,
        monthlyBalancesTie: true,
        revenueByPoTies: true,
        sourceEventsComplete: true,
        reconciled: true,
      },
    } as unknown as JournalAnalysis;
    render(<JournalEntryOutputs analysis={analysis} poNames={new Map()} />);
    const bar = screen.getByRole("region", { name: "Journal Entries summary" });
    expect(within(bar).getByText("✓ Reconciled")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Journal Entries — Reconciliation" })).toBeNull();
  });
});
