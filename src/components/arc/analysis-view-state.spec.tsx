// @vitest-environment jsdom
/**
 * Package 3D-R — accordion view state survives workpaper navigation within one
 * analysis identity, is isolated per identity, and never mutates accounting
 * state. Exercised through the real route tree and router.
 */
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { createDefaultAccordionState } from "@/components/arc/analysis-view-state";
import { routeTree } from "@/routeTree.gen";

const STEP = {
  1: /Step 1 — Identify the Contract/,
  2: /Step 2 — Identify Performance Obligations/,
  3: /Step 3 — Determine the Transaction Price/,
  4: /Step 4 — Allocate the Transaction Price/,
  5: /Step 5 — Recognize Revenue/,
} as const;

const AREAS = [
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

function nav(name: string) {
  return within(screen.getByRole("navigation", { name: "Analysis areas" })).getByRole("link", {
    name,
  });
}

function step(n: keyof typeof STEP) {
  return screen.getByRole("button", { name: STEP[n] });
}

async function roundTrip(user: ReturnType<typeof userEvent.setup>, areas: readonly string[]) {
  for (const area of areas) {
    await user.click(nav(area));
    await waitFor(() => expect(screen.queryByRole("button", { name: STEP[1] })).toBeNull());
  }
  await user.click(nav("ASC 606 Analysis"));
  await screen.findByRole("button", { name: STEP[1] });
}

function expanded(n: keyof typeof STEP) {
  return step(n).getAttribute("aria-expanded") === "true";
}

describe("Package 3D-R — accordion view state", () => {
  it("defaults are fresh objects with Step 1 open", () => {
    const a = createDefaultAccordionState();
    const b = createDefaultAccordionState();
    expect(a).toEqual({ "step-1": true });
    expect(a).not.toBe(b);
  });

  it("A: Steps 2, 3 and 4 stay open after a Journal Entries round trip", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");
    await user.click(step(2));
    await user.click(step(3));
    await user.click(step(4));
    await roundTrip(user, ["Journal Entries"]);
    expect([expanded(2), expanded(3), expanded(4)]).toEqual([true, true, true]);
  });

  it("B: a deliberately closed Step 3 stays closed", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");
    await user.click(step(3));
    await user.click(step(3));
    expect(expanded(3)).toBe(false);
    await roundTrip(user, ["Revenue Schedule"]);
    expect(expanded(3)).toBe(false);
  });

  it("C: a mixed open/closed combination survives every workpaper", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");
    await user.click(step(1)); // close
    await user.click(step(2));
    await user.click(step(5));
    await roundTrip(user, AREAS);
    expect([1, 2, 3, 4, 5].map((n) => expanded(n as keyof typeof STEP))).toEqual([
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it("D: Additional Topics state survives navigation", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");
    const mods = () => screen.getByRole("button", { name: /Contract Modifications/ });
    const initial = mods().getAttribute("aria-expanded");
    await user.click(mods());
    const toggled = initial === "true" ? "false" : "true";
    expect(mods()).toHaveAttribute("aria-expanded", toggled);
    await roundTrip(user, ["Journal Entries", "Contract Balances"]);
    expect(mods()).toHaveAttribute("aria-expanded", toggled);
  });

  it("F: Meridian → Apex starts fresh; Apex → Meridian restores Meridian", async () => {
    const user = userEvent.setup();
    const router = await renderAt("/analysis?sample=meridian");
    await user.click(step(1));
    await user.click(step(3));
    await user.click(step(4));

    await router.navigate({ to: "/analysis", search: { sample: "apex" } });
    await waitFor(() => expect(router.state.location.search).toEqual({ sample: "apex" }));
    await screen.findByRole("button", { name: STEP[1] });
    await waitFor(() => expect(expanded(1)).toBe(true));
    expect([expanded(2), expanded(3), expanded(4), expanded(5)]).toEqual([
      false,
      false,
      false,
      false,
    ]);

    await router.navigate({ to: "/analysis", search: { sample: "meridian" } });
    await waitFor(() => expect(router.state.location.search).toEqual({ sample: "meridian" }));
    await waitFor(() => expect(expanded(1)).toBe(false));
    expect([expanded(2), expanded(3), expanded(4), expanded(5)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("G: accordion activity and navigation leave the draft untouched", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");
    const before = (screen.getByLabelText(/customer name/i) as HTMLInputElement).value;
    const summaryBefore = document.querySelector("header")?.textContent ?? "";
    for (const n of [2, 3, 4, 5, 3, 1] as const) await user.click(step(n));
    await roundTrip(user, AREAS);
    await user.click(step(1));
    expect(screen.getByLabelText(/customer name/i)).toHaveValue(before);
    expect(document.querySelector("header")?.textContent ?? "").toBe(summaryBefore);
  });
});
