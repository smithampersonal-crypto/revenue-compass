import type { ReactNode } from "react";

import type { Judgment } from "@/lib/asc606-workflow";

export const inputClass =
  "w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground";
export const th = "border border-border px-2 py-1 text-left font-semibold";
export const td = "border border-border px-2 py-1 align-top tabular-nums";

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
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Notice({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warning" | "danger" }) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-border bg-accent text-accent-foreground"
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
      <div className="flex gap-4 text-sm">
        {[
          { label: "Yes", v: true as Judgment },
          { label: "No", v: false as Judgment },
          { label: "Unanswered", v: null as Judgment },
        ].map((option) => (
          <label key={option.label} className="flex items-center gap-1">
            <input
              type="radio"
              name={name}
              checked={value === option.v}
              onChange={() => onChange(option.v)}
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
