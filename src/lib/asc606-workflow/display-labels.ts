/** Deterministic, presentation-only labels for canonical promises and obligations. */

import { isValidIsoDate, parseIsoDate, type RecognitionMethod } from "@/lib/asc606";

import type { PoDraft, PromiseDraft } from "./types";

type RecognitionFields = {
  recognitionMethod: RecognitionMethod | null;
  serviceStart: string;
  serviceEnd: string;
  recognitionDate: string;
};

function formatCalendarDate(value: string): string | null {
  if (!isValidIsoDate(value)) return null;
  const { year, month, day } = parseIsoDate(value);
  return `${month}/${day}/${year}`;
}

function recognitionSuffix(fields: RecognitionFields): string | null {
  if (fields.recognitionMethod === "over_time_ratable") {
    const start = formatCalendarDate(fields.serviceStart);
    const end = formatCalendarDate(fields.serviceEnd);
    return start && end ? `${start}–${end}` : null;
  }
  if (fields.recognitionMethod === "point_in_time") {
    return formatCalendarDate(fields.recognitionDate);
  }
  return null;
}

export function promiseBaseLabel(promise: Pick<PromiseDraft, "displayName" | "seq">): string {
  return promise.displayName?.trim() || `Promise ${promise.seq}`;
}

export function performanceObligationBaseLabel(po: Pick<PoDraft, "name" | "seq">): string {
  return po.name.trim() || `Performance obligation ${po.seq}`;
}

export function performanceObligationDisplayLabel(
  po: Pick<
    PoDraft,
    "name" | "seq" | "recognitionMethod" | "serviceStart" | "serviceEnd" | "recognitionDate"
  >,
): string {
  const base = performanceObligationBaseLabel(po);
  const suffix = recognitionSuffix(po);
  return suffix ? `${base} · ${suffix}` : base;
}

export function promiseDisplayLabel(
  promise: Pick<PromiseDraft, "displayName" | "seq" | "performanceObligationId">,
  performanceObligations: readonly Pick<
    PoDraft,
    "id" | "recognitionMethod" | "serviceStart" | "serviceEnd" | "recognitionDate"
  >[],
): string {
  const base = promiseBaseLabel(promise);
  const assigned = performanceObligations.find((po) => po.id === promise.performanceObligationId);
  const suffix = assigned ? recognitionSuffix(assigned) : null;
  return suffix ? `${base} · ${suffix}` : base;
}
