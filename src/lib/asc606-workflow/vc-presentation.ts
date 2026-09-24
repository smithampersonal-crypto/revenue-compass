import type { VcComponentDraft } from "./types";

/** Accountant-facing label only; canonical component identity remains separate. */
export function variableConsiderationDisplayLabel(
  component: Pick<VcComponentDraft, "description" | "seq">,
): string {
  const description = component.description.trim();
  return description || `Variable consideration component ${component.seq}`;
}
