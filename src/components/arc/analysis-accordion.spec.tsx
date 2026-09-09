// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

const STEP_HEADERS = [
  /Step 1 — Identify the Contract/,
  /Step 2 — Identify Performance Obligations/,
  /Step 3 — Determine the Transaction Price/,
  /Step 4 — Allocate the Transaction Price/,
  /Step 5 — Recognize Revenue/,
];

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

function section(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing section ${id}`);
  return element as HTMLElement;
}

describe("ASC 606 Analysis accordion (Phase 2)", () => {
  it("renders all five ASC 606 step accordions plus Additional Topics", async () => {
    await renderAt("/analysis?sample=meridian");
    for (const header of STEP_HEADERS) {
      expect(screen.getByRole("button", { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText("Additional Topics Applied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Contract Modifications/ })).toBeInTheDocument();
  });

  it("allows multiple steps to be open at the same time", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");

    const step1 = screen.getByRole("button", { name: STEP_HEADERS[0] });
    const step3 = screen.getByRole("button", { name: STEP_HEADERS[2] });
    expect(step1).toHaveAttribute("aria-expanded", "true");

    await user.click(step3);
    expect(step3).toHaveAttribute("aria-expanded", "true");
    expect(step1).toHaveAttribute("aria-expanded", "true");
  });

  it("preserves edited values when a step is collapsed and reopened", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");

    const customer = screen.getByLabelText(/customer name/i) as HTMLInputElement;
    await user.clear(customer);
    await user.type(customer, "Collapse Test Inc.");

    const step1 = screen.getByRole("button", { name: STEP_HEADERS[0] });
    await user.click(step1);
    expect(step1).toHaveAttribute("aria-expanded", "false");
    await user.click(step1);
    expect(step1).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByLabelText(/customer name/i)).toHaveValue("Collapse Test Inc.");
  });

  it("presents both Promises and Performance Obligations inside Step 2", async () => {
    await renderAt("/analysis?sample=meridian");
    const step2 = section("step-2");
    expect(within(step2).getByText("Promised Goods and Services")).toBeInTheDocument();
    expect(within(step2).getByText("Performance Obligations")).toBeInTheDocument();
  });

  it("maps existing 2a and 2b blocking issues onto the single Step 2 section", async () => {
    await renderAt("/analysis");
    const step2 = section("step-2");
    expect(within(step2).getByText(/Items requiring attention in Step 2/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: STEP_HEADERS[1] })).getByText(/issue/),
    ).toBeInTheDocument();
  });

  it("keeps Yes / No / Unanswered as three distinct judgment states", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis");
    const step1 = section("step-1");
    const yes = within(step1).getAllByRole("radio", { name: "Yes" })[0]!;
    const no = within(step1).getAllByRole("radio", { name: "No" })[0]!;
    const unanswered = within(step1).getAllByRole("radio", { name: "Unanswered" })[0]!;

    expect(unanswered).toBeChecked();
    await user.click(no);
    expect(no).toBeChecked();
    expect(yes).not.toBeChecked();
    await user.click(unanswered);
    expect(unanswered).toBeChecked();
  });

  it("exposes no editable Variable Consideration or Material Right controls in Additional Topics", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=cloudai");

    const vc = document.getElementById("topic-variable-consideration");
    if (vc) {
      await user.click(within(vc as HTMLElement).getByRole("button", { name: /Variable/ }));
      expect((vc as HTMLElement).querySelectorAll("input, select, textarea")).toHaveLength(0);
    }
    const mr = document.getElementById("topic-material-rights");
    if (mr) {
      expect((mr as HTMLElement).querySelectorAll("input, select, textarea")).toHaveLength(0);
    }
  });

  it("keeps Contract Modifications editable in exactly one location", async () => {
    await renderAt("/analysis?sample=meridian");
    const editors = document.querySelectorAll('[id="topic-modifications"]');
    expect(editors).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Contract Modifications/ })).toHaveLength(1);
  });

  it("writes edits made through the accordion into the one authoritative draft", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");

    const customer = screen.getByLabelText(/customer name/i) as HTMLInputElement;
    await user.clear(customer);
    await user.type(customer, "Authoritative Draft Co.");

    await user.click(screen.getByRole("link", { name: "Revenue Schedule" }));
    await waitFor(() =>
      expect(screen.getByText(/Authoritative Draft Co\./)).toBeInTheDocument(),
    );
  });

  it("still suppresses downstream output for a blocked draft", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis");
    await user.click(screen.getByRole("link", { name: "Journal Entries" }));
    expect(
      await screen.findByText(/Journal entries are not available until the Billing/i),
    ).toBeInTheDocument();
  });

  it("retains the approved Meridian modification results", async () => {
    const user = userEvent.setup();
    await renderAt("/analysis?sample=meridian");
    await user.click(screen.getByRole("link", { name: "Revenue Schedule" }));
    expect(await screen.findByText("2027-06-30")).toBeInTheDocument();
    expect(screen.getAllByText("$59,425.44").length).toBeGreaterThan(0);
  });
});
