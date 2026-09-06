/**
 * Phase 5C validation. Every blocking failure stops the modification engine
 * from producing an authoritative allocation, schedule or reconciliation.
 */

import {
  datePeriodExceedsSupportedHorizon,
  isValidCents,
  isValidIsoDate,
  MAX_CENTS,
  MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS,
  validatePhase1,
  type CheckResult,
  type ValidationOutcome,
} from "@/lib/asc606";

import { activeModifiedPos, deriveModificationTreatment } from "./classification";
import { historicalCutoffDate } from "./segmentation";
import type { ContractModificationInput } from "./types";

function outcome(results: CheckResult[]): ValidationOutcome {
  const blockingFailures = results.filter((r) => !r.passed && r.severity === "blocking");
  return {
    status: blockingFailures.length > 0 || results.some((r) => !r.passed) ? "attention" : "passed",
    results,
    blockingFailures,
  };
}

export function validateContractModification(input: ContractModificationInput): ValidationOutcome {
  const results: CheckResult[] = [];
  const fail = (
    id: string,
    category: CheckResult["category"],
    message: string,
    severity: CheckResult["severity"] = "blocking",
  ) => results.push({ id, category, severity, message, passed: false });
  const pass = (id: string, category: CheckResult["category"], message: string) =>
    results.push({ id, category, severity: "blocking", message, passed: true });

  // The original contract must itself be a valid Phase 1 contract.
  const phase1 = validatePhase1({
    transactionPriceCents: input.originalTransactionPriceCents,
    performanceObligations: input.originalPerformanceObligations,
  });
  for (const result of phase1.results) {
    if (!result.passed) results.push({ ...result, id: `original.${result.id}` });
  }

  const mod = input.modification;
  const originalIds = new Set(input.originalPerformanceObligations.map((po) => po.id));

  if (!isValidIsoDate(mod.effectiveDate)) {
    fail("modification.effective_date", "contract", "Enter a valid modification effective date.");
    return outcome(results);
  }
  pass("modification.effective_date", "contract", "The modification has a valid effective date.");

  if (!mod.description || mod.description.trim() === "") {
    fail("modification.description", "contract", "Describe the contract modification.");
  }
  if (!isValidCents(mod.considerationChangeCents)) {
    fail(
      "modification.consideration_change",
      "contract",
      "The change in consideration must be a whole number of cents inside the supported range.",
    );
    return outcome(results);
  }
  const lifecycle =
    BigInt(input.originalTransactionPriceCents) + BigInt(mod.considerationChangeCents);
  if (lifecycle > BigInt(MAX_CENTS) || lifecycle < 0n) {
    fail(
      "modification.lifecycle_range",
      "contract",
      "The modified contract consideration is negative or exceeds the supported monetary range.",
    );
  }

  const active = activeModifiedPos(input);
  if (active.length === 0) {
    fail(
      "modification.performance_obligations.exists",
      "performance_obligations",
      "Enter the performance obligations that exist after the modification.",
    );
    return outcome(results);
  }

  const seen = new Set<string>();
  for (const po of active) {
    const label = po.name || po.id;
    if (!po.id || seen.has(po.id)) {
      fail(
        "modification.po.id_unique",
        "performance_obligations",
        `Post-modification performance obligation "${label}" needs a unique identifier.`,
      );
    }
    seen.add(po.id);
    if (po.status === "continuing") {
      if (!po.sourcePoId || !originalIds.has(po.sourcePoId)) {
        fail(
          "modification.po.source",
          "performance_obligations",
          `Continuing obligation "${label}" must reference an original performance obligation.`,
        );
      }
    } else if (po.sourcePoId) {
      fail(
        "modification.po.added_source",
        "performance_obligations",
        `Added obligation "${label}" must not reference an original performance obligation.`,
      );
    }
    if (!isValidCents(po.remainingSspCents) || po.remainingSspCents < 0) {
      fail(
        "modification.po.remaining_ssp",
        "performance_obligations",
        `Enter the standalone selling price of the remaining goods or services for "${label}".`,
      );
    }
    if (!isValidCents(po.totalModifiedSspCents) || po.totalModifiedSspCents <= 0) {
      fail(
        "modification.po.total_ssp",
        "performance_obligations",
        `Enter the modified standalone selling price of "${label}".`,
      );
    }
    if (po.recognitionMethod === "over_time_ratable") {
      if (!isValidIsoDate(po.serviceStart) || !isValidIsoDate(po.serviceEnd)) {
        fail(
          "modification.po.service_dates",
          "revenue",
          `Enter service start and end dates for "${label}".`,
        );
      } else if (po.serviceEnd! < po.serviceStart!) {
        fail(
          "modification.po.service_sequence",
          "revenue",
          `Service end date for "${label}" must be on or after the service start date.`,
        );
      } else if (datePeriodExceedsSupportedHorizon(po.serviceStart!, po.serviceEnd!)) {
        fail(
          "modification.accounting_horizon",
          "revenue",
          `Accounting horizon exceeds the current ${MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS / 12}-year supported range. Check the dates entered for "${label}".`,
        );
      } else if (po.serviceEnd! < mod.effectiveDate) {
        fail(
          "modification.po.service_after",
          "revenue",
          `"${label}" has no service period remaining on or after the modification effective date.`,
        );
      }
    } else if (po.recognitionMethod === "point_in_time") {
      if (!isValidIsoDate(po.recognitionDate)) {
        fail(
          "modification.po.recognition_date",
          "revenue",
          `Enter a recognition date for "${label}".`,
        );
      } else if (po.recognitionDate === mod.effectiveDate) {
        fail(
          "modification.po.same_day",
          "revenue",
          `"${label}" transfers on the modification effective date. The ordering of the transfer and the modification is ambiguous, so it is not supported.`,
        );
      } else if (po.recognitionDate! < mod.effectiveDate) {
        fail(
          "modification.po.recognition_before",
          "revenue",
          `"${label}" transfers before the modification effective date, so it cannot be a post-modification obligation.`,
        );
      }
    } else {
      fail(
        "modification.po.recognition_method",
        "revenue",
        `Select a recognition method for "${label}".`,
      );
    }
  }

  for (const removed of mod.removedPoIds ?? []) {
    if (!originalIds.has(removed)) {
      fail(
        "modification.removed.reference",
        "performance_obligations",
        `Removed performance obligation "${removed}" is not part of the original contract.`,
      );
    }
  }

  const continuedSources = new Set(
    active.filter((po) => po.status === "continuing").map((po) => po.sourcePoId!),
  );
  const removedSet = new Set(mod.removedPoIds ?? []);
  for (const po of input.originalPerformanceObligations) {
    if (!continuedSources.has(po.id) && !removedSet.has(po.id)) {
      fail(
        "modification.original.accounted",
        "performance_obligations",
        `Original performance obligation "${po.name || po.id}" must either continue after the modification or be marked as removed.`,
      );
    }
    if (continuedSources.has(po.id) && removedSet.has(po.id)) {
      fail(
        "modification.original.conflict",
        "performance_obligations",
        `Original performance obligation "${po.name || po.id}" cannot be both continuing and removed.`,
      );
    }
  }

  if (results.some((r) => !r.passed && r.severity === "blocking")) return outcome(results);

  const treatment = deriveModificationTreatment(input);
  const cutoff = historicalCutoffDate(mod.effectiveDate);

  if (treatment === "mixed" && !mod.mixedAllocationPolicy) {
    fail(
      "modification.mixed_policy",
      "allocation",
      "Select the allocation policy applied to a modification with both distinct and non-distinct remaining goods or services.",
    );
  }

  if (treatment === "separate_contract") {
    const added = active.filter((po) => po.status === "added");
    if (added.length === 0) {
      fail(
        "modification.separate.added",
        "performance_obligations",
        "A separate contract must add at least one new performance obligation.",
      );
    }
    if (mod.considerationChangeCents <= 0) {
      fail(
        "modification.separate.consideration",
        "contract",
        "A separate contract must add consideration for the additional goods or services.",
      );
    }
    for (const po of added) {
      if (po.remainingSspCents <= 0) {
        fail(
          "modification.separate.ssp",
          "allocation",
          `Enter a positive standalone selling price for the added obligation "${po.name || po.id}".`,
        );
      }
    }
  } else {
    // Historical revenue is immutable, so the pool available for the remaining
    // performance must never be negative.
    for (const po of active) {
      const label = po.name || po.id;
      const isCatchUp = treatment === "cumulative_catch_up" || !po.remainingGoodsDistinct;
      if (isCatchUp) {
        if (po.recognitionMethod !== "over_time_ratable") {
          fail(
            "modification.catch_up.method",
            "revenue",
            `"${label}" is not distinct from the goods or services already transferred, so it must be recognized over time.`,
          );
        } else if (po.serviceStart! > cutoff) {
          fail(
            "modification.catch_up.start",
            "revenue",
            `"${label}" must keep its original service start date so the revised measure of progress can be applied.`,
          );
        }
      } else if (
        po.recognitionMethod === "over_time_ratable" &&
        po.serviceStart! < mod.effectiveDate
      ) {
        fail(
          "modification.prospective.start",
          "revenue",
          `"${label}" is distinct from the goods or services already transferred, so its remaining service period must begin on or after the modification effective date.`,
        );
      }
    }
    const basisTotal = active.reduce(
      (total, po) =>
        total +
        BigInt(
          treatment === "cumulative_catch_up" ||
            (treatment === "mixed" && mod.mixedAllocationPolicy === "total_transaction_price")
            ? po.totalModifiedSspCents
            : po.remainingSspCents,
        ),
      0n,
    );
    if (basisTotal <= 0n) {
      fail(
        "modification.allocation.ssp_total",
        "allocation",
        "The standalone selling prices used to allocate the modified consideration must total more than zero.",
      );
    }
  }

  if (results.filter((r) => !r.passed && r.severity === "blocking").length === 0) {
    pass("modification.inputs", "contract", "The modification inputs are complete.");
  }
  return outcome(results);
}
