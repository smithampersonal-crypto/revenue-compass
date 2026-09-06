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
import {
  RESERVED_ID_NAMESPACE,
  signedConsiderationChangeCents,
  type ContractModificationInput,
  type ModificationAllocationBasis,
  type ModifiedPerformanceObligationInput,
} from "./types";

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

  if (!input.hasContractModifications) {
    fail(
      "modification.enabled",
      "contract",
      "No contract modification has been recorded, so no modification analysis is produced.",
    );
    return outcome(results);
  }
  if (input.contractModifications.length === 0) {
    fail("modification.event.exists", "contract", "Enter the contract modification.");
    return outcome(results);
  }
  if (input.contractModifications.length > 1) {
    fail(
      "modification.event.single",
      "contract",
      "This version calculates a single contract modification. Remove the additional modifications to continue.",
    );
    return outcome(results);
  }

  const mod = input.contractModifications[0]!;
  const originalIds = new Set(input.originalPerformanceObligations.map((po) => po.id));

  if (mod.approvedAndEnforceable === null) {
    fail(
      "modification.approval.answered",
      "contract",
      "State whether the modification has been approved and creates enforceable rights and obligations (ASC 606-10-25-10).",
    );
  } else if (mod.approvedAndEnforceable === false) {
    fail(
      "modification.approval.not_enforceable",
      "contract",
      "An unapproved or unenforceable modification is not accounted for under ASC 606-10-25-10, so no modification analysis is produced.",
    );
  } else {
    pass("modification.approval", "contract", "The modification is approved and enforceable.");
    if (isBlank(mod.approvalRationale)) {
      fail(
        "modification.approval.rationale",
        "contract",
        "Document the basis for concluding that the modification is approved and creates enforceable rights and obligations (ASC 606-10-25-10).",
      );
    }
  }

  if (!isValidIsoDate(mod.modificationDate)) {
    fail("modification.effective_date", "contract", "Enter a valid modification effective date.");
    return outcome(results);
  }
  pass("modification.effective_date", "contract", "The modification has a valid effective date.");

  if (!mod.scopeChangeDescription || mod.scopeChangeDescription.trim() === "") {
    fail(
      "modification.description",
      "contract",
      "Describe the change in scope, price, or both made by the modification.",
    );
  }
  if (
    !isValidCents(mod.considerationMagnitudeCents) ||
    mod.considerationMagnitudeCents < 0 ||
    (mod.considerationEffect === "none" && mod.considerationMagnitudeCents !== 0)
  ) {
    fail(
      "modification.consideration_change",
      "contract",
      "The change in consideration must be a whole, non-negative number of cents inside the supported range, and zero when there is no price change.",
    );
    return outcome(results);
  }
  const considerationChangeCents = signedConsiderationChangeCents(mod);
  const lifecycle = BigInt(input.originalTransactionPriceCents) + BigInt(considerationChangeCents);
  if (lifecycle > BigInt(MAX_CENTS) || lifecycle < 0n) {
    fail(
      "modification.lifecycle_range",
      "contract",
      "The modified contract consideration is negative or exceeds the supported monetary range.",
    );
  }

  const active = activeModifiedPos(mod);
  if (active.length === 0) {
    fail(
      "modification.performance_obligations.exists",
      "performance_obligations",
      "Enter the performance obligations that exist after the modification.",
    );
    return outcome(results);
  }

  // ASC 606-10-25-12(b) is only a meaningful question when the modification
  // actually adds goods or services. A pure scope reduction or a price-only
  // change never reaches criterion (b), so the accountant is not asked to
  // answer a structurally irrelevant criterion in order to continue into
  // ASC 606-10-25-13.
  const addedPos = active.filter((po) => po.status === "added");
  const criterionBRelevant = addedPos.length > 0;
  if (criterionBRelevant) {
    if (mod.priceReflectsAddedGoodsSsp === null) {
      fail(
        "modification.price_reflects_ssp",
        "contract",
        "State whether the change in price reflects the standalone selling prices of the added goods or services (ASC 606-10-25-12(b)).",
      );
    } else if (isBlank(mod.priceReflectsSspRationale)) {
      fail(
        "modification.price_reflects_ssp.rationale",
        "contract",
        "Document the basis for the conclusion on whether the change in price reflects the standalone selling prices of the added goods or services (ASC 606-10-25-12(b)).",
      );
    }
  }

  if (mod.id.includes(RESERVED_ID_NAMESPACE)) {
    fail(
      "modification.id_reserved",
      "contract",
      `The modification identifier must not contain the reserved sequence "${RESERVED_ID_NAMESPACE}".`,
    );
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
    if (po.id.includes(RESERVED_ID_NAMESPACE)) {
      fail(
        "modification.po.id_reserved",
        "performance_obligations",
        `The identifier of "${label}" must not contain the reserved sequence "${RESERVED_ID_NAMESPACE}".`,
      );
    }
    seen.add(po.id);
    if (!po.name || po.name.trim() === "") {
      fail(
        "modification.po.name",
        "performance_obligations",
        `Name post-modification performance obligation ${po.id}.`,
      );
    }
    if (po.status === "continuing") {
      if (!po.sourcePoId || !originalIds.has(po.sourcePoId)) {
        fail(
          "modification.po.source",
          "performance_obligations",
          `Continuing obligation "${label}" must reference an original performance obligation.`,
        );
      }
      if (po.scopeEffect === null || po.scopeEffect === undefined) {
        fail(
          "modification.po.scope_effect",
          "performance_obligations",
          `State how the modification changes the scope of the continuing obligation "${label}".`,
        );
      }
    } else {
      if (po.sourcePoId) {
        fail(
          "modification.po.added_source",
          "performance_obligations",
          `Added obligation "${label}" must not reference an original performance obligation.`,
        );
      }
      if (po.addedGoodsAreDistinct === null || po.addedGoodsAreDistinct === undefined) {
        fail(
          "modification.po.added_distinct",
          "performance_obligations",
          `State whether the goods or services added by "${label}" are distinct (ASC 606-10-25-12(a)).`,
        );
      }
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
      } else if (po.serviceEnd! < mod.modificationDate) {
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
      } else if (po.recognitionDate === mod.modificationDate) {
        fail(
          "modification.po.same_day",
          "revenue",
          `"${label}" transfers on the modification effective date. The ordering of the transfer and the modification is ambiguous, so it is not supported.`,
        );
      } else if (po.recognitionDate! < mod.modificationDate) {
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

  const treatment = deriveModificationTreatment(mod);
  const cutoff = historicalCutoffDate(mod.modificationDate);

  if (treatment === "mixed" && !mod.mixedAllocationPolicy) {
    fail(
      "modification.mixed_policy",
      "allocation",
      "Select the allocation policy applied to a modification with both distinct and non-distinct remaining goods or services.",
    );
  }

  // ---- Branch-specific standalone selling prices ---------------------------
  const requireRemaining = (po: ModifiedPerformanceObligationInput, context: string) => {
    const label = po.name || po.id;
    if (
      po.remainingSspCents === null ||
      !isValidCents(po.remainingSspCents) ||
      po.remainingSspCents < 0
    ) {
      fail(
        "modification.ssp.remaining",
        "allocation",
        `${context} Enter the standalone selling price of the goods or services remaining to be transferred for "${label}".`,
      );
    }
    if (!po.remainingSspBasis || po.remainingSspBasis.trim() === "") {
      fail(
        "modification.ssp.remaining_basis",
        "allocation",
        `Document how the remaining standalone selling price of "${label}" was determined.`,
      );
    }
  };
  const requireTotal = (po: ModifiedPerformanceObligationInput, context: string) => {
    const label = po.name || po.id;
    if (
      po.totalModifiedSspCents === null ||
      !isValidCents(po.totalModifiedSspCents) ||
      po.totalModifiedSspCents <= 0
    ) {
      fail(
        "modification.ssp.total",
        "allocation",
        `${context} Enter the standalone selling price of the whole modified obligation "${label}".`,
      );
    }
    if (!po.totalModifiedSspBasis || po.totalModifiedSspBasis.trim() === "") {
      fail(
        "modification.ssp.total_basis",
        "allocation",
        `Document how the modified standalone selling price of "${label}" was determined.`,
      );
    }
  };

  if (treatment === "separate_contract") {
    const added = active.filter((po) => po.status === "added");
    if (considerationChangeCents <= 0) {
      fail(
        "modification.separate.consideration",
        "contract",
        "A separate contract must add consideration for the additional goods or services.",
      );
    }
    for (const po of added) {
      requireRemaining(
        po,
        "The modification is a separate contract, so only the added goods and services are allocated.",
      );
      if ((po.remainingSspCents ?? 0) <= 0) {
        fail(
          "modification.separate.ssp",
          "allocation",
          `Enter a positive standalone selling price for the added obligation "${po.name || po.id}".`,
        );
      }
    }
  } else {
    const usesTotalBasis =
      treatment === "cumulative_catch_up" ||
      (treatment === "mixed" && mod.mixedAllocationPolicy === "updated_total_transaction_price");
    const basis: ModificationAllocationBasis = usesTotalBasis
      ? "total_modified_ssp"
      : "remaining_ssp";
    const context = usesTotalBasis
      ? "The derived treatment allocates the updated TOTAL transaction price."
      : "The derived treatment allocates the updated REMAINING transaction price.";

    for (const po of active) {
      const label = po.name || po.id;
      if (usesTotalBasis) requireTotal(po, context);
      else requireRemaining(po, context);

      const isCatchUp =
        treatment === "cumulative_catch_up" || !po.remainingGoodsDistinctFromTransferred;
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
        po.serviceStart! < mod.modificationDate
      ) {
        fail(
          "modification.prospective.start",
          "revenue",
          `"${label}" is distinct from the goods or services already transferred, so its remaining service period must begin on or after the modification effective date.`,
        );
      }
    }

    if (!results.some((r) => !r.passed && r.id.startsWith("modification.ssp."))) {
      const basisTotal = active.reduce(
        (total, po) =>
          total +
          BigInt(
            (basis === "total_modified_ssp" ? po.totalModifiedSspCents : po.remainingSspCents) ?? 0,
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
  }

  if (results.filter((r) => !r.passed && r.severity === "blocking").length === 0) {
    pass("modification.inputs", "contract", "The modification inputs are complete.");
  }
  return outcome(results);
}
