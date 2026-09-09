// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";
describe("m", () => { it("x", async () => {
  const user = userEvent.setup();
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() }, history: createMemoryHistory({ initialEntries: ["/analysis?sample=meridian"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByRole("navigation", { name: "Analysis areas" });
  await user.click(screen.getByRole("link", { name: "Revenue Schedule" }));
  await new Promise((r) => setTimeout(r, 300));
  const t = document.body.textContent ?? "";
  console.log("HAS_HIST", t.includes("Historical cutoff"), "HAS_NUM", t.includes("59,425.44"), t.slice(0, 300));
  expect(1).toBe(1);
});});
