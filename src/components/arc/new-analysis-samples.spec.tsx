// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() =>
  vi.fn(async (_: { data: { origin: string } }) => ({
    analysisId: "11111111-1111-4111-8111-111111111111",
  })),
);
vi.mock("@/lib/arc/persistence/guest.functions", async (orig) => ({
  ...(await orig<object>()),
  createTemporaryAnalysis: createMock,
}));

import { routeTree } from "@/routeTree.gen";
import {
  DEMO_SCENARIOS,
  PUBLIC_SAMPLE_SCENARIOS,
  createDemoDraft,
  getDemoScenario,
} from "@/lib/demo-scenarios";
import { analyzeWorkflow } from "@/lib/asc606-workflow";

async function renderAt(initialPath: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("New Analysis sample curation (3D-T acceptance)", () => {
  it("public subset is Horizon only; full registry unchanged", () => {
    expect(PUBLIC_SAMPLE_SCENARIOS.map((s) => s.id)).toEqual(["horizon"]);
    expect(DEMO_SCENARIOS.map((s) => s.id)).toEqual([
      "redwood",
      "apex",
      "horizon",
      "stellar",
      "meridian",
    ]);
  });

  it("shows Horizon and hides the other fixtures; one click creates exactly one sample:horizon", async () => {
    await renderAt("/analysis/new");
    const section = await screen.findByRole("region", { name: /open a sample contract/i });
    const horizon = getDemoScenario("horizon");
    expect(within(section).getByText(horizon.customer)).toBeInTheDocument();
    for (const id of ["redwood", "apex", "stellar", "meridian"] as const) {
      expect(screen.queryByText(getDemoScenario(id).customer)).toBeNull();
    }
    const buttons = within(section).getAllByRole("button", { name: /open sample/i });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0]![0].data).toEqual({ origin: "sample:horizon" });
  });

  it("hidden fixtures remain available to the engine", () => {
    for (const id of ["redwood", "apex", "stellar", "meridian"] as const) {
      expect(analyzeWorkflow(createDemoDraft(id)).finalized).toBe(true);
    }
  });
});
