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
};

export interface PassedValidationGroup {
  key: CategoryKey;
  heading: string;
  description: string;
  checks: CheckResult[];
}

export function groupPassedValidationChecks(checks: readonly CheckResult[]): PassedValidationGroup[] {
  const passed = checks.filter((check) => check.passed);
  return VALIDATION_PRESENTATION_CATEGORIES.map((category) => ({
    ...category,
    checks: passed.filter((check) => (RULE_CATEGORY_BY_ID[check.id] ?? "other") === category.key),
  })).filter((category) => category.checks.length > 0);
}