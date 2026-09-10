import { useEffect, useRef, type ReactNode } from "react";

/**
 * Presentation-only guard for a non-editable analysis (a finalized or
 * superseded revision, or a saved analysis that has not loaded yet).
 *
 * It disables every accounting input control inside its region while leaving
 * navigation, accordion triggers and all deterministic engine output fully
 * usable. It is a second boundary only: the authoritative one is `setDraft`,
 * which no-ops when the analysis cannot be edited.
 */
const EDIT_SELECTOR =
  "input, select, textarea, button:not([data-arc-accordion-trigger]):not([data-arc-chrome])";

export function ReadOnlyInputs({ active, children }: { active: boolean; children: ReactNode }) {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    const apply = () => {
      const controls = node.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
      >(EDIT_SELECTOR);
      for (const control of controls) {
        if (active) {
          control.disabled = true;
          control.setAttribute("aria-disabled", "true");
        } else if (control.getAttribute("aria-disabled") === "true") {
          control.disabled = false;
          control.removeAttribute("aria-disabled");
        }
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  });

  return (
    <div ref={container} data-arc-read-only={active ? "true" : "false"}>
      {children}
    </div>
  );
}
