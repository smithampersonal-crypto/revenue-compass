// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import { NARRATIVE_TEXTAREA_MAX_HEIGHT, NarrativeTextarea } from "./fields";

beforeAll(() => {
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return Number(this.dataset.mockScrollHeight ?? 0);
    },
  });
});

describe("NarrativeTextarea", () => {
  it("measures populated content on mount and hides overflow below the cap", () => {
    render(
      <NarrativeTextarea
        aria-label="Narrative"
        data-mock-scroll-height="148"
        value="A populated accounting conclusion"
        onChange={() => undefined}
      />,
    );

    const textarea = screen.getByLabelText("Narrative");
    expect(textarea).toHaveStyle({ height: "148px", overflowY: "hidden" });
    expect(textarea).toHaveValue("A populated accounting conclusion");
  });

  it("remeasures a programmatic controlled-value update", () => {
    function Harness() {
      const [value, setValue] = useState("Short");
      const height = value === "Short" ? 72 : 220;
      return (
        <>
          <NarrativeTextarea
            aria-label="Narrative"
            data-mock-scroll-height={height}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="button" onClick={() => setValue("Programmatically supplied long text")}>
            Fill
          </button>
        </>
      );
    }

    render(<Harness />);
    const textarea = screen.getByLabelText("Narrative");
    expect(textarea).toHaveStyle({ height: "72px" });
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    expect(textarea).toHaveValue("Programmatically supplied long text");
    expect(textarea).toHaveStyle({ height: "220px", overflowY: "hidden" });
  });

  it("caps pathological content and enables internal vertical scrolling", () => {
    render(
      <NarrativeTextarea
        aria-label="Narrative"
        data-mock-scroll-height="900"
        value="Very long narrative"
        onChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Narrative")).toHaveStyle({
      height: `${NARRATIVE_TEXTAREA_MAX_HEIGHT}px`,
      overflowY: "auto",
    });
  });

  it("emits the exact canonical string without normalization", () => {
    let emitted = "";
    render(
      <NarrativeTextarea
        aria-label="Narrative"
        value=""
        onChange={(event) => {
          emitted = event.target.value;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Narrative"), {
      target: { value: "  Exact\naccounting text  " },
    });
    expect(emitted).toBe("  Exact\naccounting text  ");
  });
});
