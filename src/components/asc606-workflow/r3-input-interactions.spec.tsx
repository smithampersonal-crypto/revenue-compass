// @vitest-environment jsdom
/**
 * Phase 9G-R3, Section H/J. The R3 operational inputs are exercised through
 * the REAL production components and their real `onChange`, and the resulting
 * canonical `WorkflowDraft` is inspected fact by fact.
 *
 * Nothing here re-implements a control or a reducer: each test renders the
 * shipped step component, drives it the way an accountant does, and reads the
 * draft the component produced.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { nextId, nextSeq, type WorkflowDraft } from "@/lib/asc606-workflow";
import { genomixBenchmarkDraft } from "@/lib/asc606-workflow/__tests__/genomix-k-fixture";

import { Step3TransactionPrice } from "./Step3TransactionPrice";
import { Step5Recognition } from "./Step5Recognition";
import { Step5VariableConsideration } from "./Step5VariableConsideration";

/* ----------------------------------------------------------------- harness */

type Step = (props: { draft: WorkflowDraft; onChange: (draft: WorkflowDraft) => void }) => unknown;

/** Renders a real step component as the workspace does, and exposes the draft. */
function mount(StepComponent: Step, initial: WorkflowDraft) {
  const state: { draft: WorkflowDraft } = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    const Component = StepComponent as unknown as (props: {
      draft: WorkflowDraft;
      onChange: (next: WorkflowDraft) => void;
    }) => ReactElement;
    return <Component draft={draft} onChange={setDraft} />;
  }
  render(<Harness />);
  return state;
}

function onlyPo(id: string): WorkflowDraft {
  const draft = genomixBenchmarkDraft();
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.filter((po) => po.id === id),
    promises: draft.promises.filter((promise) => promise.performanceObligationId === id),
  };
}

function onlyVc(id: string): WorkflowDraft {
  const draft = genomixBenchmarkDraft();
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.filter(
      (component) => component.id === id,
    ),
  };
}

const support = (draft: WorkflowDraft) =>
  draft.performanceObligations.find((po) => po.id === "po-support")!;
const usage = (draft: WorkflowDraft) =>
  draft.variableConsiderationComponents.find((c) => c.id === "vc-usage")!;
const sla = (draft: WorkflowDraft) =>
  draft.variableConsiderationComponents.find((c) => c.id === "vc-sla")!;

/* ------------------------------------------- H — support progress (Step 5) */

describe("Step 5 input-measure progress is entered through the real control", () => {
  it("records the measure, denominator, unit label and actual progress events", () => {
    const base = onlyPo("po-support");
    const state = mount(Step5Recognition, {
      ...base,
      performanceObligations: base.performanceObligations.map((po) => ({
        ...po,
        overTimeMeasure: "time_based" as const,
        totalExpectedUnitsInput: "",
        unitLabel: "",
        progressEvents: [],
      })),
    });

    fireEvent.change(screen.getByLabelText("Measure of progress"), {
      target: { value: "input_measure" },
    });
    expect(support(state.draft).overTimeMeasure).toBe("input_measure");

    fireEvent.change(screen.getByLabelText("Total contracted units (denominator)"), {
      target: { value: "300" },
    });
    expect(support(state.draft).totalExpectedUnitsInput).toBe("300");

    fireEvent.change(screen.getByLabelText("Unit label"), { target: { value: "hours" } });
    expect(support(state.draft).unitLabel).toBe("hours");

    fireEvent.click(screen.getByRole("button", { name: "Add actual progress" }));
    expect(support(state.draft).progressEvents).toEqual([
      { id: "po-support-pe-1", seq: 1, date: "", unitsInput: "" },
    ]);

    const group = within(screen.getByTestId("progress-events-po-support"));
    fireEvent.change(group.getByLabelText("Date incurred"), {
      target: { value: "2027-01-31" },
    });
    fireEvent.change(group.getByLabelText("Units incurred (hours)"), {
      target: { value: "150" },
    });
    expect(support(state.draft).progressEvents).toEqual([
      { id: "po-support-pe-1", seq: 1, date: "2027-01-31", unitsInput: "150" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add actual progress" }));
    expect(support(state.draft).progressEvents!.map((event) => [event.id, event.seq])).toEqual([
      ["po-support-pe-1", 1],
      ["po-support-pe-2", 2],
    ]);

    fireEvent.click(
      within(screen.getByTestId("progress-events-po-support")).getAllByRole("button", {
        name: "Remove entry",
      })[0]!,
    );
    expect(support(state.draft).progressEvents!.map((event) => event.id)).toEqual([
      "po-support-pe-2",
    ]);
  });

  it("never leaves a hidden transfer date behind a deliberate status change", () => {
    const state = mount(Step5Recognition, onlyPo("po-validation"));
    const validation = () => state.draft.performanceObligations[0]!;

    expect(validation().transferStatus).toBe("not_yet_transferred");
    expect(validation().recognitionDate ?? "").toBe("");

    fireEvent.change(screen.getByLabelText("Transfer of control"), {
      target: { value: "transferred" },
    });
    // The date is the accountant's to enter; it is never invented.
    expect(validation().recognitionDate ?? "").toBe("");

    fireEvent.change(screen.getByLabelText("Recognition date"), {
      target: { value: "2027-03-15" },
    });
    expect(validation().recognitionDate).toBe("2027-03-15");

    fireEvent.change(screen.getByLabelText("Transfer of control"), {
      target: { value: "not_yet_transferred" },
    });
    expect(validation().transferStatus).toBe("not_yet_transferred");
    expect(validation().recognitionDate).toBe("");
  });
});

/* ------------------- L Checkpoint 3 — recognition-method disclosure (Step 5) */

describe("Step 5 recognition method reaches the input measure", () => {
  function blankMethod() {
    const base = onlyPo("po-support");
    return mount(Step5Recognition, {
      ...base,
      performanceObligations: base.performanceObligations.map((po) => {
        const { overTimeMeasure: _measure, ...rest } = po;
        return {
          ...rest,
          recognitionMethod: null,
          totalExpectedUnitsInput: "",
          unitLabel: "",
          progressEvents: [],
        };
      }),
    });
  }

  it("offers the over-time classification, not one measurement convention", () => {
    blankMethod();
    const select = screen.getByLabelText("Recognition method") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "Select a method…",
      "Over time",
      "Point in time",
    ]);
  });

  it("exposes the measure of progress as soon as over time is selected", () => {
    const state = blankMethod();
    expect(screen.queryByLabelText("Measure of progress")).toBeNull();

    fireEvent.change(screen.getByLabelText("Recognition method"), {
      target: { value: "over_time_ratable" },
    });
    expect(support(state.draft).recognitionMethod).toBe("over_time_ratable");
    expect(screen.getByLabelText("Measure of progress")).toBeTruthy();
    expect(screen.queryByLabelText("Total contracted units (denominator)")).toBeNull();
  });

  it("reveals the denominator, unit label and progress events on an input measure", () => {
    const state = blankMethod();
    fireEvent.change(screen.getByLabelText("Recognition method"), {
      target: { value: "over_time_ratable" },
    });
    fireEvent.change(screen.getByLabelText("Measure of progress"), {
      target: { value: "input_measure" },
    });
    expect(support(state.draft).overTimeMeasure).toBe("input_measure");
    expect(screen.getByLabelText("Total contracted units (denominator)")).toBeTruthy();
    expect(screen.getByLabelText("Unit label")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add actual progress" })).toBeTruthy();
  });

  it("keeps point-in-time behaviour unchanged", () => {
    const state = blankMethod();
    fireEvent.change(screen.getByLabelText("Recognition method"), {
      target: { value: "point_in_time" },
    });
    expect(support(state.draft).recognitionMethod).toBe("point_in_time");
    expect(screen.queryByLabelText("Measure of progress")).toBeNull();
  });
});

/* ------------------------------------------------- J — usage meter (Step 3) */

describe("Step 3 usage meters are entered through the real control", () => {
  it("adds a meter and records its rate, quantity, unit and included threshold", () => {
    const state = mount(Step3TransactionPrice, onlyVc("vc-usage"));

    fireEvent.click(screen.getByRole("button", { name: "Add meter" }));
    const meters = usage(state.draft).meters;
    expect(meters).toHaveLength(2);
    expect(meters[1]!.id).toBe("vc-usage-m-2");
    expect(meters[1]!.seq).toBe(2);
    // The persisted meter is never rewritten by adding another one.
    expect(meters[0]!.id).toBe("m-samples");

    const rates = screen.getAllByLabelText("Rate amount (USD)");
    fireEvent.change(rates[1]!, { target: { value: "18.00" } });
    expect(usage(state.draft).meters[1]!.rateAmountInput).toBe("18.00");

    fireEvent.change(screen.getAllByLabelText("Per quantity")[1]!, { target: { value: "1000" } });
    expect(usage(state.draft).meters[1]!.rateQuantityInput).toBe("1000");

    fireEvent.change(screen.getAllByLabelText("Unit")[1]!, { target: { value: "reports" } });
    expect(usage(state.draft).meters[1]!.unit).toBe("reports");

    fireEvent.change(screen.getAllByLabelText(/^Included quantity/)[1]!, {
      target: { value: "25" },
    });
    expect(usage(state.draft).meters[1]!.includedQuantityInput).toBe("25");

    // Editing the contractual rate of the original meter.
    fireEvent.change(screen.getAllByLabelText("Rate amount (USD)")[0]!, {
      target: { value: "13.50" },
    });
    expect(usage(state.draft).meters[0]!.rateAmountInput).toBe("13.50");
  });

  it("cannot reuse the identity of a meter that was removed and replaced", () => {
    const state = mount(Step3TransactionPrice, onlyVc("vc-usage"));
    fireEvent.click(screen.getByRole("button", { name: "Add meter" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove meter" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Add meter" }));
    const ids = usage(state.draft).meters.map((meter) => meter.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["vc-usage-m-2", "vc-usage-m-3"]);
  });
});

/* ------------------------------------------------ J — usage actual (Step 5) */

describe("Step 5 usage actuals are entered through the real control", () => {
  it("adds a measured month, records the quantity and removes the month", () => {
    const state = mount(Step5VariableConsideration, onlyVc("vc-usage"));

    fireEvent.click(screen.getByRole("button", { name: "Add usage month" }));
    expect(usage(state.draft).usagePeriods).toEqual([
      { id: "vc-usage-p-1", month: "", quantities: {} },
    ]);

    fireEvent.change(screen.getByLabelText("Accounting month"), { target: { value: "2027-02" } });
    fireEvent.change(screen.getByLabelText("Tier 2 samples (samples)"), {
      target: { value: "500" },
    });
    expect(usage(state.draft).usagePeriods).toEqual([
      { id: "vc-usage-p-1", month: "2027-02", quantities: { "m-samples": "500" } },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove month" }));
    expect(usage(state.draft).usagePeriods).toEqual([]);
  });
});

/* ------------------------------ J — service periods and realized amounts */

describe("Step 5 service periods and realized amounts are entered through the real control", () => {
  it("declares a period, records a realized amount against it and removes both", () => {
    const state = mount(Step5VariableConsideration, onlyVc("vc-sla"));
    const group = () => within(screen.getByTestId("series-periods-vc-sla"));

    fireEvent.click(screen.getByRole("button", { name: "Add service period" }));
    const periods = sla(state.draft).seriesPeriods!;
    expect(periods).toHaveLength(3);
    expect(periods[2]).toEqual({
      id: "vc-sla-sp-3",
      seq: 3,
      label: "",
      startDate: "",
      endDate: "",
    });
    expect(periods.slice(0, 2).map((period) => period.id)).toEqual(["y1", "y2"]);

    fireEvent.change(group().getAllByLabelText("Label")[2]!, { target: { value: "Year 3" } });
    fireEvent.change(group().getAllByLabelText("Start date")[2]!, {
      target: { value: "2028-11-01" },
    });
    fireEvent.change(group().getAllByLabelText("End date")[2]!, {
      target: { value: "2029-10-31" },
    });
    expect(sla(state.draft).seriesPeriods![2]).toEqual({
      id: "vc-sla-sp-3",
      seq: 3,
      label: "Year 3",
      startDate: "2028-11-01",
      endDate: "2029-10-31",
    });

    fireEvent.click(screen.getByRole("button", { name: "Add realized amount" }));
    expect(sla(state.draft).realizedEvents).toEqual([
      {
        id: "vc-sla-re-1",
        seq: 1,
        date: "",
        amountInput: "",
        seriesPeriodId: null,
        description: "",
      },
    ]);

    fireEvent.change(group().getByLabelText("Date"), { target: { value: "2027-04-30" } });
    fireEvent.change(group().getByLabelText("Amount (USD)"), { target: { value: "1,500.00" } });
    // The period is chosen by its stable identity, never by its position.
    fireEvent.change(group().getByLabelText("Service period"), { target: { value: "y1" } });
    fireEvent.change(group().getByLabelText("Description"), {
      target: { value: "Service-level credit issued" },
    });
    expect(sla(state.draft).realizedEvents).toEqual([
      {
        id: "vc-sla-re-1",
        seq: 1,
        date: "2027-04-30",
        amountInput: "1,500.00",
        seriesPeriodId: "y1",
        description: "Service-level credit issued",
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove amount" }));
    expect(sla(state.draft).realizedEvents).toEqual([]);

    fireEvent.click(group().getAllByRole("button", { name: "Remove period" })[2]!);
    expect(sla(state.draft).seriesPeriods!.map((period) => period.id)).toEqual(["y1", "y2"]);
  });

  it("records the bill-on-realization judgment as the accountant sets it", () => {
    const state = mount(Step5VariableConsideration, onlyVc("vc-sla"));
    const checkbox = screen.getByRole("checkbox", {
      name: /bills a realized amount on the date it is realized/,
    });
    expect(sla(state.draft).billOnRealization).toBe(true);
    fireEvent.click(checkbox);
    expect(sla(state.draft).billOnRealization).toBe(false);
    fireEvent.click(checkbox);
    expect(sla(state.draft).billOnRealization).toBe(true);
  });

  it("gives every newly added row a deterministic identity and sequence", () => {
    const first = mount(Step5VariableConsideration, onlyVc("vc-sla"));
    fireEvent.click(screen.getByRole("button", { name: "Add realized amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Add realized amount" }));
    const firstIds = first.draft.variableConsiderationComponents[0]!.realizedEvents!.map(
      (event) => `${event.id}:${event.seq}`,
    );

    // A second, independent render of the same starting facts must produce
    // exactly the same identities: no timestamp, no random value, no index.
    screen.getByTestId("series-periods-vc-sla").remove();
    const second = mount(Step5VariableConsideration, onlyVc("vc-sla"));
    fireEvent.click(screen.getAllByRole("button", { name: "Add realized amount" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Add realized amount" })[0]!);
    const secondIds = second.draft.variableConsiderationComponents[0]!.realizedEvents!.map(
      (event) => `${event.id}:${event.seq}`,
    );

    expect(firstIds).toEqual(["vc-sla-re-1:1", "vc-sla-re-2:2"]);
    expect(secondIds).toEqual(firstIds);
  });
});

/* -------------------------------------------------- deterministic identity */

describe("nextId and nextSeq never collide with an existing row", () => {
  it("skips an identity a deletion left in use", () => {
    expect(nextId("pe", [])).toBe("pe-1");
    expect(nextId("pe", [{ id: "pe-1" }])).toBe("pe-2");
    // Row 1 deleted: the remaining row still owns "pe-2", so the next row
    // cannot be given that identity.
    expect(nextId("pe", [{ id: "pe-2" }])).toBe("pe-3");
    expect(nextId("pe", [{ id: "pe-2" }, { id: "pe-3" }])).toBe("pe-4");
  });

  it("advances the sequence beyond the highest one in use", () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([{ seq: 1 }, { seq: 2 }])).toBe(3);
    expect(nextSeq([{ seq: 7 }])).toBe(8);
    expect(nextSeq([{ seq: 3 }, { seq: 1 }])).toBe(4);
  });
});
