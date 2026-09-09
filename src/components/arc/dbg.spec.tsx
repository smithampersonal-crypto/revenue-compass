// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { routeTree } from "@/routeTree.gen";
it("dbg", async () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() }, history: createMemoryHistory({ initialEntries: ["/analysis/balances?sample=horizon"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByRole("navigation", { name: "Analysis areas" });
  const els = await screen.findAllByText("Billing schedule (engine output)");
  console.log("COUNT", els.length, els.map(e => e.outerHTML.slice(0,80)));
  expect(1).toBe(1);
});
