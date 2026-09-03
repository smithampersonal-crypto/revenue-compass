export type StepKey = "1" | "2a" | "2b" | "3" | "4" | "5" | "balances" | "results";

export const STEPS: { key: StepKey; label: string; group: string }[] = [
  { key: "1", label: "1 Contract", group: "1" },
  { key: "2a", label: "2A Promises", group: "2" },
  { key: "2b", label: "2B Performance Obligations", group: "2" },
  { key: "3", label: "3 Transaction Price", group: "3" },
  { key: "4", label: "4 Allocation", group: "4" },
  { key: "5", label: "5 Recognition", group: "5" },
  { key: "balances", label: "Billing & Contract Balances", group: "balances" },
  { key: "results", label: "Results", group: "results" },
];


export function WorkflowStepper({
  current,
  onSelect,
}: {
  current: StepKey;
  onSelect: (step: StepKey) => void;
}) {
  return (
    <nav aria-label="Workflow steps" className="flex flex-wrap gap-2">
      {STEPS.map((step) => (
        <button
          key={step.key}
          type="button"
          onClick={() => onSelect(step.key)}
          aria-current={current === step.key ? "step" : undefined}
          className={`rounded-md border px-3 py-1 text-sm ${
            current === step.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground hover:bg-accent"
          }`}
        >
          {step.label}
        </button>
      ))}
    </nav>
  );
}
