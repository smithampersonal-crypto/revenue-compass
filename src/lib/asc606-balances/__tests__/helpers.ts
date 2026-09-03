import { analyzePhase1, type RevenueSchedule } from "@/lib/asc606";

/** Fictional single-PO annual SaaS revenue schedule used by engine-level tests. */
export function saasRevenueSchedule(
  amountCents: number,
  start = "2027-01-01",
  end = "2027-12-31",
): RevenueSchedule {
  const analysis = analyzePhase1({
    transactionPriceCents: amountCents,
    performanceObligations: [
      {
        id: "po-1",
        seq: 1,
        name: "SaaS subscription",
        sspCents: amountCents,
        recognitionMethod: "over_time_ratable",
        serviceStart: start,
        serviceEnd: end,
      },
    ],
  });
  if (!analysis.revenueSchedule) throw new Error("fixture revenue schedule failed to build");
  return analysis.revenueSchedule;
}
