// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReadOnlyInputs } from "./ReadOnlyInputs";

describe("ReadOnlyInputs", () => {
  it("only re-enables controls it disabled itself", () => {
    const view = render(
      <ReadOnlyInputs active={false}>
        <select aria-label="Allocation treatment" disabled>
          <option>Usage as incurred</option>
        </select>
        <input aria-label="Customer" />
      </ReadOnlyInputs>,
    );

    const intrinsic = screen.getByLabelText("Allocation treatment") as HTMLSelectElement;
    const editable = screen.getByLabelText("Customer") as HTMLInputElement;
    expect(intrinsic.disabled).toBe(true);
    expect(editable.disabled).toBe(false);

    view.rerender(
      <ReadOnlyInputs active>
        <select aria-label="Allocation treatment" disabled>
          <option>Usage as incurred</option>
        </select>
        <input aria-label="Customer" />
      </ReadOnlyInputs>,
    );
    expect(intrinsic.disabled).toBe(true);
    expect(editable.disabled).toBe(true);

    view.rerender(
      <ReadOnlyInputs active={false}>
        <select aria-label="Allocation treatment" disabled>
          <option>Usage as incurred</option>
        </select>
        <input aria-label="Customer" />
      </ReadOnlyInputs>,
    );
    expect(intrinsic.disabled).toBe(true);
    expect(editable.disabled).toBe(false);
  });
});
