import type { CheckResult } from "@/lib/asc606";

export const VALIDATION_PRESENTATION_CATEGORIES = [
  {
    key: "contract-setup",
    heading: "Contract setup",
    description: "Applicable contract-level checks passed.",
  },
  {
    key: "performance-obligations",
    heading: "Performance obligations",
    description: "Applicable performance-obligation checks passed.",
  },
  {
    key: "standalone-selling-prices",
    heading: "Standalone selling prices",
    description: "Applicable SSP and allocation-input checks passed.",
  },
  {
    key: "revenue-recognition",
    heading: "Revenue recognition",
    description: "Applicable recognition-method and timing checks passed.",
  },
  {
    key: "accounting-period",
    heading: "Accounting period",
    description: "Applicable date-range and accounting-horizon checks passed.",
  },
  {
    key: "other",
    heading: "Other validation checks",
    description: "Applicable additional checks passed.",
  },
] as const;

type CategoryKey = (typeof VALIDATION_PRESENTATION_CATEGORIES)[number]["key"];

const RULE_CATEGORY_BY_ID: Readonly<Record<string, CategoryKey>> = {
  "contract.transaction_price.valid": "contract-setup",
  "material_right.exercise_consideration.valid": "contract-setup",
  "po.exists": "performance-obligations",
  "po.has_promise": "performance-obligations",
  "po.id.unique": "performance-obligations",
  "po.sequence.unique": "performance-obligations",
  "po.ssp.positive": "standalone-selling-prices",
  "promise.assigned": "performance-obligations",
  "material_right.name.present": "performance-obligations",
  "material_right.underlying_service.present": "performance-obligations",
  "material_right.benefit.positive": "performance-obligations",
  "material_right.probability.range": "performance-obligations",
  "material_right.ssp.positive": "standalone-selling-prices",
  "material_right.status.valid": "performance-obligations",
  "material_right.outstanding.no_exercise": "performance-obligations",
  "material_right.outstanding.no_expiration": "performance-obligations",
  "material_right.expired.no_exercise": "performance-obligations",
  "material_right.exercised.no_expiration": "performance-obligations",
  "material_right.exercise.present": "performance-obligations",
  "allocation.total_ssp.positive": "standalone-selling-prices",
  "allocation.total_ssp.supported_range": "standalone-selling-prices",
  "po.recognition_method.present": "revenue-recognition",
  "po.recognition_date.present": "revenue-recognition",
  "material_right.exercise_recognition_method.present": "revenue-recognition",
  "material_right.exercise_recognition_date.present": "revenue-recognition",
  "po.service_dates.present": "accounting-period",
  "po.service_dates.sequence": "accounting-period",
  "po.recognition_period.supported_range": "accounting-period",
  "accounting_horizon.supported_range": "accounting-period",
  "material_right.expiration_date.present": "accounting-period",
  "material_right.exercise_date.present": "accounting-period",
  "material_right.exercise_service_dates.present": "accounting-period",
  "material_right.exercise_service_dates.sequence": "accounting-period",
  "material_right.exercise_period.supported_range": "accounting-period",
  "modification.enabled": "contract-setup",
  "modification.event.exists": "contract-setup",
  "modification.event.single": "contract-setup",
  "modification.approval.answered": "contract-setup",
  "modification.approval.not_enforceable": "contract-setup",
  "modification.approval": "contract-setup",
  "modification.approval.rationale": "contract-setup",
  "modification.description": "contract-setup",
  "modification.consideration_change": "contract-setup",
  "modification.price_reflects_ssp": "contract-setup",
  "modification.price_reflects_ssp.rationale": "contract-setup",
  "modification.id_reserved": "contract-setup",
  "modification.inputs": "contract-setup",
  "modification.original.accounted": "contract-setup",
  "modification.original.conflict": "contract-setup",
  "modification.mixed_policy": "contract-setup",
  "modification.mixed_policy.rationale": "contract-setup",
  "modification.performance_obligations.exists": "performance-obligations",
  "modification.po.id_reserved": "performance-obligations",
  "modification.po.id_unique": "performance-obligations",
  "modification.po.name": "performance-obligations",
  "modification.po.source": "performance-obligations",
  "modification.po.added_source": "performance-obligations",
  "modification.po.added_distinct": "performance-obligations",
  "modification.po.added_distinct_rationale": "performance-obligations",
  "modification.po.remaining_distinct_rationale": "performance-obligations",
  "modification.po.scope_effect": "performance-obligations",
  "modification.removed.reference": "performance-obligations",
  "modification.separate.consideration": "standalone-selling-prices",
  "modification.separate.ssp": "standalone-selling-prices",
  "modification.ssp.remaining": "standalone-selling-prices",
  "modification.ssp.remaining_basis": "standalone-selling-prices",
  "modification.ssp.total": "standalone-selling-prices",
  "modification.ssp.total_basis": "standalone-selling-prices",
  "modification.allocation.ssp_total": "standalone-selling-prices",
  "modification.po.recognition_method": "revenue-recognition",
  "modification.catch_up.method": "revenue-recognition",
  "modification.po.recognition_before": "revenue-recognition",
  "modification.effective_date": "accounting-period",
  "modification.lifecycle_range": "accounting-period",
  "modification.accounting_horizon": "accounting-period",
  "modification.po.recognition_date": "accounting-period",
  "modification.po.same_day": "accounting-period",
  "modification.po.service_after": "accounting-period",
  "modification.po.service_dates": "accounting-period",
  "modification.po.service_sequence": "accounting-period",
  "modification.catch_up.start": "accounting-period",
  "modification.prospective.start": "accounting-period",
};

export interface PassedValidationGroup {
  key: CategoryKey;
  heading: string;
  description: string;
  checks: CheckResult[];
}

export function groupPassedValidationChecks(
  checks: readonly CheckResult[],
): PassedValidationGroup[] {
  const passed = checks.filter((check) => check.passed);
  return VALIDATION_PRESENTATION_CATEGORIES.map((category) => ({
    ...category,
    checks: passed.filter((check) => (RULE_CATEGORY_BY_ID[check.id] ?? "other") === category.key),
  })).filter((category) => category.checks.length > 0);
}
