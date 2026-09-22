// @vitest-environment jsdom
/**
 * Package 2C-G. The reusable USD money input.
 *
 * Presentation only: thousands separators appear when the field loses focus
 * and never rewrite the canonical draft string. Typing is untouched — what the
 * accountant typed is exactly what they see and exactly what is emitted.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { UsdMoneyInput } from "./fields";

function Harness({ initial, onValueChange }: { initial: string; onValueChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <UsdMoneyInput
      aria-label="Amount (USD)"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

function field(): HTMLInputElement {
  return screen.getByLabelText("Amount (USD)") as HTMLInputElement;
}

describe("UsdMoneyInput", () => {
  it("never formats while the accountant is typing", () => {
    render(<Harness initial="" />);
    const input = field();
    fireEvent.focus(input);
    for (const typed of ["5", "50", "505001", "505001.", "505001.9", "505001.96"]) {
      fireEvent.change(input, { target: { value: typed } });
      expect(input.value).toBe(typed);
    }
  });

  it("formats with thousands separators only after blur", () => {
    render(<Harness initial="" />);
    const input = field();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "505001.96" } });
    expect(input.value).toBe("505001.96");
    fireEvent.blur(input);
    expect(input.value).toBe("505,001.96");
  });

  it("emits exactly what was typed and emits nothing on a formatting-only blur", () => {
    const onValueChange = vi.fn();
    render(<Harness initial="" onValueChange={onValueChange} />);
    const input = field();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "35100.5" } });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("35100.5");
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("35,100.50");

    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("leaves invalid or incomplete input exactly as entered after blur", () => {
    for (const bad of ["1.005", "500.", ".5", "abc", "-100", "12,34.00"]) {
      const { unmount } = render(<Harness initial="" />);
      const input = field();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.blur(input);
      expect(input.value).toBe(bad);
      unmount();
    }
  });

  it("formats a programmatic value without a focus/blur cycle", () => {
    function Programmatic() {
      const [value, setValue] = useState("");
      return (
        <>
          <UsdMoneyInput aria-label="Amount (USD)" value={value} onValueChange={setValue} />
          <button type="button" onClick={() => setValue("505001.96")}>
            Apply AI value
          </button>
        </>
      );
    }
    render(<Programmatic />);
    expect(field().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Apply AI value" }));
    expect(field().value).toBe("505,001.96");
  });

  it("preserves ordinary input behaviour, refs, disabled state and caller handlers", () => {
    const ref = { current: null as HTMLInputElement | null };
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(
      <UsdMoneyInput
        ref={ref}
        aria-label="Amount (USD)"
        placeholder="60,000.00"
        disabled
        value="120000"
        onValueChange={() => {}}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    const input = field();
    expect(ref.current).toBe(input);
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("60,000.00");
    expect(input.inputMode).toBe("decimal");
    expect(input.value).toBe("120,000.00");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
