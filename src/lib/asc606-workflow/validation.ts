/**
 * Phase 2 workflow validation — completeness and structural consistency of the
 * accountant's draft. Pure data in, pure findings out.
 *
 * This layer never makes an accounting judgment: it can surface a
 * contradiction (for example a bundle whose promises were each concluded
 * distinct) as a warning, but it never rewrites the accountant's answer.
 */

import { isValidIsoDate } from "@/lib/asc606";
import { parseUsdToCents } from "./money-input";
import { derivePromiseDistinct, deriveStep1Conclusion, STEP1_CRITERIA, type WorkflowDraft } from "./types";

export type WorkflowStepId = "1" | "2a" | "2b" | "3" | "4" | "5";

export interface WorkflowIssue {
  id: string;
  step: WorkflowStepId;
  severity: "blocking" | "warning";
  message: string;
}

export interface WorkflowValidationOutcome {
  issues: WorkflowIssue[];
  blocking: WorkflowIssue[];
  warnings: WorkflowIssue[];
  /** Blocking issues for a given step, in step order. */
  blockingByStep: Record<WorkflowStepId, WorkflowIssue[]>;
}

const isBlank = (value: string | null | undefined) => !value || value.trim() === "";

export function validateWorkflow(draft: WorkflowDraft): WorkflowValidationOutcome {
  const issues: WorkflowIssue[] = [];
  const add = (
    id: string,
    step: WorkflowStepId,
    message: string,
    severity: WorkflowIssue["severity"] = "blocking",
  ) => issues.push({ id, step, severity, message });

  // ---- Step 1 -------------------------------------------------------------
  if (isBlank(draft.contract.customerName)) {
    add("contract.customer_name.present", "1", "Customer name is required.");
  }
  if (isBlank(draft.contract.contractNumber)) {
    add("contract.number.present", "1", "Contract number or reference is required.");
  }
  const unanswered = STEP1_CRITERIA.filter((c) => draft.contract.criteria[c.id]?.answer === null);
  if (unanswered.length > 0) {
    add(
      "contract.criteria.answered",
      "1",
      `Answer every Step 1 criterion: ${unanswered.map((c) => c.label).join(", ")}.`,
    );
  }
  const missingRationale = STEP1_CRITERIA.filter(
    (c) =>
      draft.contract.criteria[c.id]?.answer !== null &&
      isBlank(draft.contract.criteria[c.id]?.rationale),
  );
  if (missingRationale.length > 0) {
    add(
      "contract.criteria.rationale",
      "1",
      `Document your rationale for: ${missingRationale.map((c) => c.label).join(", ")}.`,
    );
  }

  // ---- Step 2A ------------------------------------------------------------
  const promises = draft.promises;
  if (promises.length === 0) {
    add("promise.exists", "2a", "Identify at least one promised good or service.");
  }
  if (promises.some((p) => isBlank(p.description))) {
    add("promise.description.present", "2a", "Every promise requires a description.");
  }
  if (promises.some((p) => derivePromiseDistinct(p) === null)) {
    add(
      "promise.judgments.answered",
      "2a",
      "Answer both distinctness judgments for every promise.",
    );
  }
  if (promises.some((p) => isBlank(p.distinctRationale))) {
    add("promise.rationale.present", "2a", "Document a distinctness rationale for every promise.");
  }

  // ---- Step 2B ------------------------------------------------------------
  const pos = draft.performanceObligations;
  if (pos.length === 0) {
    add("po.exists", "2b", "Create at least one performance obligation.");
  }
  const poIds = pos.map((po) => po.id);
  if (new Set(poIds).size !== poIds.length || poIds.some((id) => isBlank(id))) {
    add("po.id.unique", "2b", "Each performance obligation needs a unique, non-empty identifier.");
  }
  const seqs = pos.map((po) => po.seq);
  if (new Set(seqs).size !== seqs.length || seqs.some((s) => !Number.isInteger(s))) {
    add(
      "po.sequence.unique",
      "2b",
      "Each performance obligation needs a unique whole-number sequence.",
    );
  }
  if (pos.some((po) => isBlank(po.name))) {
    add("po.name.present", "2b", "Every performance obligation requires a name.");
  }
  if (pos.some((po) => po.classification === null)) {
    add("po.classification.present", "2b", "Select a classification for every performance obligation.");
  }
  if (pos.some((po) => isBlank(po.classificationRationale))) {
    add(
      "po.classification.rationale",
      "2b",
      "Document a classification rationale for every performance obligation.",
    );
  }
  const poIdSet = new Set(poIds);
  if (promises.some((p) => p.performanceObligationId === null || !poIdSet.has(p.performanceObligationId))) {
    add("promise.assigned", "2b", "Assign every promise to exactly one performance obligation.");
  }
  if (pos.some((po) => !promises.some((p) => p.performanceObligationId === po.id))) {
    add("po.has_promise", "2b", "Every performance obligation must contain at least one promise.");
  }

  for (const po of pos) {
    const assigned = promises.filter((p) => p.performanceObligationId === po.id);
    if (po.classification === "single_distinct") {
      const valid = assigned.length === 1 && derivePromiseDistinct(assigned[0]!) === true;
      if (!valid) {
        add(
          "po.single_distinct.valid",
          "2b",
          `"${po.name || po.id}" is classified as a single distinct promise, so it must contain exactly one promise concluded to be distinct.`,
        );
      }
    }
    if (po.classification === "bundle_not_distinct") {
      if (assigned.length < 2) {
        add(
          "po.bundle.min_promises",
          "2b",
          `"${po.name || po.id}" is classified as a bundle, so it must contain at least two promises.`,
        );
      } else if (assigned.every((p) => derivePromiseDistinct(p) === true)) {
        add(
          "po.bundle.all_distinct",
          "2b",
          `Every promise in "${po.name || po.id}" was concluded to be distinct, yet the bundle is classified as non-distinct. Please reconsider the classification or the distinctness judgments.`,
          "warning",
        );
      }
    }
  }

  // ---- Step 3 -------------------------------------------------------------
  const price = parseUsdToCents(draft.transactionPriceInput);
  if (!price.ok) {
    add("contract.transaction_price.valid", "3", `Transaction price: ${price.error}`);
  } else if (price.cents <= 0) {
    add("contract.transaction_price.valid", "3", "Transaction price must be greater than zero.");
  }

  // ---- Step 4 -------------------------------------------------------------
  for (const po of pos) {
    const ssp = parseUsdToCents(po.sspInput);
    if (!ssp.ok || ssp.cents <= 0) {
      add(
        "po.ssp.positive",
        "4",
        `Standalone selling price for "${po.name || po.id}" must be a valid USD amount greater than zero.`,
      );
    }
    if (isBlank(po.sspBasis)) {
      add("po.ssp_basis.present", "4", `Document how the SSP for "${po.name || po.id}" was determined.`);
    }
  }

  // ---- Step 5 -------------------------------------------------------------
  for (const po of pos) {
    const label = po.name || po.id;
    if (po.recognitionMethod === null) {
      add("po.recognition_method.present", "5", `Select a recognition method for "${label}".`);
      continue;
    }
    if (po.recognitionMethod === "over_time_ratable") {
      if (!isValidIsoDate(po.serviceStart) || !isValidIsoDate(po.serviceEnd)) {
        add("po.service_dates.present", "5", `Enter service start and end dates for "${label}".`);
      } else if (po.serviceEnd < po.serviceStart) {
        add(
          "po.service_dates.sequence",
          "5",
          `Service end date for "${label}" must be on or after the service start date.`,
        );
      }
    }
    if (po.recognitionMethod === "point_in_time" && !isValidIsoDate(po.recognitionDate)) {
      add("po.recognition_date.present", "5", `Enter a recognition date for "${label}".`);
    }
    if (isBlank(po.recognitionRationale)) {
      add("po.recognition_rationale.present", "5", `Document the recognition rationale for "${label}".`);
    }
  }

  const blocking = issues.filter((i) => i.severity === "blocking");
  const warnings = issues.filter((i) => i.severity === "warning");
  const blockingByStep: Record<WorkflowStepId, WorkflowIssue[]> = {
    "1": [],
    "2a": [],
    "2b": [],
    "3": [],
    "4": [],
    "5": [],
  };
  for (const issue of blocking) blockingByStep[issue.step].push(issue);

  return { issues, blocking, warnings, blockingByStep };
}

/** Step 1 conclusion is derived, not validated; re-exported for convenience. */
export { deriveStep1Conclusion };
