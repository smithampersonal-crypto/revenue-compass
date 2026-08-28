import type { ContractPromise, PerformanceObligationInput } from "../types";

/** All companies, customers and amounts are fictional. */
export const DOLLARS = (whole: number, cents = 0) => whole * 100 + cents;

export function overTimePo(
  overrides: Partial<PerformanceObligationInput> & Pick<PerformanceObligationInput, "id" | "seq" | "sspCents">,
): PerformanceObligationInput {
  return {
    name: overrides.name ?? `PO ${overrides.seq}`,
    recognitionMethod: "over_time_ratable",
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    ...overrides,
  };
}

export function pointInTimePo(
  overrides: Partial<PerformanceObligationInput> & Pick<PerformanceObligationInput, "id" | "seq" | "sspCents">,
): PerformanceObligationInput {
  return {
    name: overrides.name ?? `PO ${overrides.seq}`,
    recognitionMethod: "point_in_time",
    recognitionDate: "2027-01-15",
    ...overrides,
  };
}

export function promise(
  id: string,
  seq: number,
  description: string,
  capable: boolean,
  inContext: boolean,
  performanceObligationId: string | null,
): ContractPromise {
  return {
    id,
    seq,
    description,
    capableOfBeingDistinct: capable,
    distinctWithinContractContext: inContext,
    distinctRationale: "Fictional demonstration data.",
    performanceObligationId,
  };
}
