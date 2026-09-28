// @vitest-environment jsdom
/**
 * Horizon New Analysis source parity: the longer server-side seed cannot cause
 * duplicate analyses from a rapid double click, and a failed seed opens nothing.
 */
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/arc/persistence/guest.functions", async (orig) => ({
  ...(await orig<object>()),
  createTemporaryAnalysis: createMock,
}));

import { routeTree } from "@/routeTree.gen";

async function renderNew() {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/analysis/new"] }),
  });
  render(<RouterProvider router={router} />);
  const section = await screen.findByRole("region", { name: /open a sample contract/i });
  return { router, button: within(section).getByRole("button", { name: /open sample/i }) };
}

describe("Horizon Open sample with source seeding", () => {
  it("a rapid double click during a slow seed creates exactly one analysis", async () => {
    createMock.mockReset();
    let release!: (v: { analysisId: string }) => void;
    createMock.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const { button } = await renderNew();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(createMock).toHaveBeenCalledTimes(1);
    release({ analysisId: "11111111-1111-4111-8111-111111111111" });
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  it("a failed seed shows an error and opens no analysis", async () => {
    createMock.mockReset();
    createMock.mockRejectedValue(new Error("The Horizon sample couldn't be opened."));
    const { router, button } = await renderNew();
    fireEvent.click(button);
    expect(await screen.findByText(/couldn't be started/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/analysis/new");
  });
});
