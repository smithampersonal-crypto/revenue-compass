import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import type { Judgment } from "@/lib/asc606-workflow";
import { formatUsdInputForBlur } from "@/lib/asc606-workflow/money-input";

export const inputClass =
  "min-h-10 w-full rounded-md border border-input bg-muted/45 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const th =
  "border-b border-border bg-muted/70 px-3 py-2 text-left text-xs font-semibold text-muted-foreground";
export const td = "border-b border-border/70 px-3 py-2 align-top tabular-nums";

export const NARRATIVE_TEXTAREA_MAX_HEIGHT = 304;
const NARRATIVE_TEXTAREA_MIN_HEIGHT = 72;

/** Controlled textarea for accounting narratives; display sizing never changes its value. */
export const NarrativeTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function NarrativeTextarea({ className, rows = 2, style, value, ...props }, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const measuredWidthRef = useRef<number | null>(null);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.max(
      NARRATIVE_TEXTAREA_MIN_HEIGHT,
      Math.min(textarea.scrollHeight, NARRATIVE_TEXTAREA_MAX_HEIGHT),
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > NARRATIVE_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;
    measuredWidthRef.current = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || width === measuredWidthRef.current) return;
      measuredWidthRef.current = width;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [resize]);

  return (
    <textarea
      {...props}
      ref={(node) => {
        textareaRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      rows={rows}
      value={value}
      className={`${inputClass} resize-none ${className ?? ""}`}
      style={{ ...style, minHeight: NARRATIVE_TEXTAREA_MIN_HEIGHT }}
    />
  );
});

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      {children}
    </label>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Notice({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning-foreground"
        : "border-border bg-muted text-muted-foreground";
  return <div className={`rounded-md border p-3 text-sm ${toneClass}`}>{children}</div>;
}

/** Yes / No / unanswered control. Unanswered stays null — never false. */
export function JudgmentControl({
  name,
  value,
  onChange,
  legend,
}: {
  name: string;
  value: Judgment;
  onChange: (value: Judgment) => void;
  legend: string;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {[
          { label: "Yes", v: true as Judgment },
          { label: "No", v: false as Judgment },
          { label: "Unanswered", v: null as Judgment },
        ].map((option) => (
          <label key={option.label} className="flex min-h-9 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={name}
              checked={value === option.v}
              onChange={() => onChange(option.v)}
              className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function judgmentLabel(value: Judgment): string {
  return value === null ? "Unanswered" : value ? "Yes" : "No";
}

export function IssueList({
  issues,
  title,
  tone = "danger",
}: {
  issues: { id: string; message: string }[];
  title: string;
  tone?: "danger" | "warning";
}) {
  if (issues.length === 0) return null;
  return (
    <Notice tone={tone}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {issues.map((issue, index) => (
          <li key={`${issue.id}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    </Notice>
  );
}

/**
 * Controlled USD amount input.
 *
 * While the accountant is editing, the field shows exactly what they typed.
 * Once it loses focus the value is displayed with thousands separators, using
 * the shared exact parser. That formatting is presentation state only: the
 * canonical draft string is never rewritten just to show commas, so focusing
 * and blurring an untouched AI-populated amount is not an accountant edit.
 */
export const UsdMoneyInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  }
>(function UsdMoneyInput(
  { value, onValueChange, className, onFocus, onBlur, inputMode = "decimal", ...props },
  ref,
) {
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <input
      {...props}
      ref={ref}
      inputMode={inputMode}
      className={className ?? inputClass}
      value={typed ?? formatUsdInputForBlur(value)}
      onFocus={(event) => {
        setTyped(value);
        onFocus?.(event);
      }}
      onChange={(event) => {
        setTyped(event.target.value);
        onValueChange(event.target.value);
      }}
      onBlur={(event) => {
        setTyped(null);
        onBlur?.(event);
      }}
    />
  );
});
