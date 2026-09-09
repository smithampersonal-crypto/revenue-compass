import { useId, type ReactNode } from "react";

/**
 * Accordion section used by the ASC 606 Analysis workspace.
 *
 * Children stay mounted while collapsed (they are hidden, not unmounted), so
 * collapsing and reopening a step can never discard an edit or any transient
 * UI state held inside an existing editor. All accounting state continues to
 * live in the single authoritative WorkflowDraft.
 */
export function AccordionSection({
  id,
  title,
  subtitle,
  status,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  /** Restrained textual status, e.g. "2 issues". */
  status?: string | null;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  const generated = useId();
  const contentId = `${id}-${generated}-content`;

  return (
    <section
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-background"
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onToggle(!open)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent"
        >
          <span
            aria-hidden="true"
            className="text-xs text-muted-foreground transition-transform"
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          >
            ▶
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold text-foreground">{title}</span>
            {subtitle ? (
              <span className="block text-sm text-muted-foreground">{subtitle}</span>
            ) : null}
          </span>
          {status ? (
            <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {status}
            </span>
          ) : null}
        </button>
      </h2>
      <div id={contentId} hidden={!open} className="border-t border-border p-4">
        {children}
      </div>
    </section>
  );
}

export function issueStatus(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "1 issue" : `${count} issues`;
}
