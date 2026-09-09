// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

const AREAS = [
  "ASC 606 Analysis",
  "Revenue Schedule",
  "Contract Balances",
  "Journal Entries",
  "Source Documents",
  "Review & Finalize",
] as const;

async function renderAt(initialPath: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("navigation", { name: "Analysis areas" });
  return router;
}

describe("ARC analysis workspace (Phase 1)", () => {
  it("keeps ?sample=meridian across navigation to every parent area", async () => {
    const user = userEvent.setup();
    const router = await renderAt("/analysis?sample=meridian");

    expect(router.state.location.search).toEqual({ sample: "meridian" });

    for (const area of AREAS) {
      await user.click(screen.getByRole("link", { name: area }));
      await waitFor(() => {
        expect(router.state.location.search).toEqual({ sample: "meridian" });
      });
      expect(router.state.location.href).toContain("sample=meridian");
    }
  });

  it("preserves edits made in one area across navigation through all six areas", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");

    const customer = screen.getByLabelText(/customer/i) as HTMLInputElement;
    await user.clear(customer);
    await user.type(customer, "Edited Customer LLC");
    expect(customer).toHaveValue("Edited Customer LLC");

    for (const area of AREAS.slice(1)) {
      await user.click(screen.getByRole("link", { name: area }));
      await screen.findByRole("navigation", { name: "Analysis areas" });
    }
    await user.click(screen.getByRole("link", { name: "ASC 606 Analysis" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/customer/i)).toHaveValue("Edited Customer LLC");
    });
  });

  it("still suppresses financial output when the engine reports blocking failures", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis");

    await user.click(screen.getByRole("link", { name: "Journal Entries" }));
    expect(
      await screen.findByText(/Journal entries are not available until the Billing/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Debit/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Contract Balances" }));
    expect(
      await screen.findByText(
        /five-step draft analysis must be complete before the Billing & Contract Balances workpaper/i,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Review & Finalize" }));
    expect(await screen.findByText(/Workflow items requiring attention/i)).toBeInTheDocument();
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("single authoritative WorkflowDraft", () => {
  it("declares workflow draft state in exactly one place", () => {
    const owners = sourceFiles(path.resolve(import.meta.dirname, "../..")).filter((file) =>
      /useState<WorkflowDraft>/.test(readFileSync(file, "utf8")),
    );
    expect(owners.map((f) => path.basename(f))).toEqual(["analysis-context.tsx"]);
  });
});
