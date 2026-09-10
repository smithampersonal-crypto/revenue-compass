import { useEffect, useRef, type ReactNode } from "react";

/**
 * Presentation-only guard for a non-editable analysis (a finalized or
 * superseded revision, or a saved analysis that has not loaded yet).
 *
 * It disables every accounting input control inside its region while leaving
 * navigation, accordion triggers and all deterministic engine output fully
 * usable. It is a second boundary only: the authoritative one is `setDraft`,
 * which no-ops when the analysis cannot be edited.
 *
 * Only controls this wrapper itself disabled are re-enabled when it becomes
 * inactive: a control that is intrinsically disabled by its own accounting or
 * UI rule stays disabled across a read-only → editable transition.
 */
const EDIT_SELECTOR =
  "input, select, textarea, button:not([data-arc-accordion-trigger]):not([data-arc-chrome])";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;

export function ReadOnlyInputs({ active, children }: { active: boolean; children: ReactNode }) {
  const container = useRef<HTMLDivElement | null>(null);
  /** The controls this wrapper disabled, so only those are restored. */
  const owned = useRef<WeakSet<Control>>(new WeakSet());

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    const apply = () => {
      const controls = node.querySelectorAll<Control>(EDIT_SELECTOR);
      for (const control of controls) {
        if (active) {
          if (control.disabled) continue; // already disabled by its own rule
          owned.current.add(control);
          control.disabled = true;
          control.setAttribute("data-arc-read-only-disabled", "true");
          control.setAttribute("aria-disabled", "true");
        } else if (owned.current.has(control)) {
          owned.current.delete(control);
          control.disabled = false;
          control.removeAttribute("data-arc-read-only-disabled");
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
