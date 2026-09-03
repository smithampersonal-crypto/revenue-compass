/**
 * Validation engine — Phase 1 subset.
 *
 * Only the checks needed to prevent invalid Step 4 / Step 5 calculations live
 * here. Step 1 criteria, billing reconciliation, contract-balance and journal
 * entry checks arrive with their own phases.
 */

import { isValidIsoDate } from "./dates";
import { isValidCents, MAX_CENTS } from "./money";
import type { CheckResult, Phase1ContractInput, ValidationOutcome } from "./types";

function check(
  passed: boolean,
  id: string,
  category: CheckResult["category"],
  message: string,
  severity: CheckResult["severity"] = "blocking",
  detail?: CheckResult["detail"],
): CheckResult {
  return detail === undefined
    ? { id, category, severity, message, passed }
    : { id, category, severity, message, passed, detail };
}

export function validatePhase1(input: Phase1ContractInput): ValidationOutcome {
  const results: CheckResult[] = [];
  const pos = input.performanceObligations ?? [];

  results.push(
    check(
      isValidCents(input.transactionPriceCents) && input.transactionPriceCents >= 0,
      "contract.transaction_price.valid",
      "contract",
      "Transaction price must be a whole number of cents and cannot be negative.",
    ),
  );

  results.push(
    check(
      pos.length > 0,
      "po.exists",
      "performance_obligations",
      "The contract must have at least one performance obligation.",
    ),
  );

  const seqs = pos.map((po) => po.seq);
  results.push(
    check(
      new Set(seqs).size === seqs.length && seqs.every((seq) => Number.isInteger(seq)),
      "po.sequence.unique",
      "performance_obligations",
      "Each performance obligation must have a unique whole-number sequence.",
    ),
  );

  const sspValid = pos.every((po) => isValidCents(po.sspCents) && po.sspCents > 0);
  results.push(
    check(
      pos.length > 0 && sspValid,
      "po.ssp.positive",
      "performance_obligations",
      "Every performance obligation must have a standalone selling price greater than zero.",
      "blocking",
      {
        missing: pos
          .filter((po) => !isValidCents(po.sspCents) || po.sspCents <= 0)
          .map((po) => po.name)
          .join(", "),
      },
    ),
  );

  const ids = pos.map((po) => po.id);
  const idsNonEmpty = ids.every((id) => typeof id === "string" && id.trim() !== "");
  results.push(
    check(
      pos.length > 0 && idsNonEmpty && new Set(ids).size === ids.length,
      "po.id.unique",
      "performance_obligations",
      "Each performance obligation must have a non-empty, unique identifier.",
      "blocking",
      { duplicates: ids.filter((id, i) => ids.indexOf(id) !== i).join(", ") },
    ),
  );

  // Exact BigInt aggregation: individual SSPs can each be valid while their
  // total exceeds the engine's supported exact integer range.
  const totalSspBig = pos.reduce(
    (total, po) => total + (isValidCents(po.sspCents) ? BigInt(po.sspCents) : 0n),
    0n,
  );
  const totalSspSupported = totalSspBig <= BigInt(MAX_CENTS) && totalSspBig >= -BigInt(MAX_CENTS);
  results.push(
    check(
      totalSspBig > 0n,
      "allocation.total_ssp.positive",
      "allocation",
      "Total standalone selling price must be greater than zero before allocation.",
      "blocking",
      { totalSspCents: totalSspSupported ? Number(totalSspBig) : String(totalSspBig) },
    ),
  );
  results.push(
    check(
      totalSspSupported,
      "allocation.total_ssp.supported_range",
      "allocation",
      "Total standalone selling price exceeds the amount this engine can calculate exactly.",
      "blocking",
      { totalSspCents: String(totalSspBig), maxSupportedCents: MAX_CENTS },
    ),
  );

  results.push(
    check(
      pos.every(
        (po) => po.recognitionMethod === "over_time_ratable" || po.recognitionMethod === "point_in_time",
      ),
      "po.recognition_method.present",
      "revenue",
      "Every performance obligation must have a supported recognition method.",
    ),
  );

  const overTime = pos.filter((po) => po.recognitionMethod === "over_time_ratable");
  results.push(
    check(
      overTime.every((po) => isValidIsoDate(po.serviceStart) && isValidIsoDate(po.serviceEnd)),
      "po.service_dates.present",
      "revenue",
      "Over-time performance obligations require valid service start and end dates.",
    ),
  );
  results.push(
    check(
      overTime.every(
        (po) =>
          !isValidIsoDate(po.serviceStart) ||
          !isValidIsoDate(po.serviceEnd) ||
          po.serviceEnd! >= po.serviceStart!,
      ),
      "po.service_dates.sequence",
      "revenue",
      "Service end date must be on or after the service start date.",
      "blocking",
      {
        invalid: overTime
          .filter(
            (po) =>
              isValidIsoDate(po.serviceStart) &&
              isValidIsoDate(po.serviceEnd) &&
              po.serviceEnd! < po.serviceStart!,
          )
          .map((po) => po.name)
          .join(", "),
      },
    ),
  );

  const pointInTime = pos.filter((po) => po.recognitionMethod === "point_in_time");
  results.push(
    check(
      pointInTime.every((po) => isValidIsoDate(po.recognitionDate)),
      "po.recognition_date.present",
      "revenue",
      "Point-in-time performance obligations require a valid recognition date.",
    ),
  );

  if (input.promises && input.promises.length > 0) {
    const poIds = new Set(pos.map((po) => po.id));
    results.push(
      check(
        input.promises.every((p) => p.performanceObligationId !== null && poIds.has(p.performanceObligationId)),
        "promise.assigned",
        "performance_obligations",
        "Every contract promise must be assigned to a performance obligation.",
      ),
    );
    results.push(
      check(
        pos.every((po) => input.promises!.some((p) => p.performanceObligationId === po.id)),
        "po.has_promise",
        "performance_obligations",
        "Every performance obligation must contain at least one contract promise.",
      ),
    );
  }

  const blockingFailures = results.filter((r) => !r.passed && r.severity === "blocking");
  return {
    status: results.every((r) => r.passed) ? "passed" : "attention",
    results,
    blockingFailures,
  };
}
