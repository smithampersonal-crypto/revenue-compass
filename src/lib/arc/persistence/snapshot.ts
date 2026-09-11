/**
 * Phase 7D — the ARC workpaper bundle and the finalization snapshot builder.
 *
 * Pure and server-usable: it takes the authoritative persisted `WorkflowDraft`
 * and reruns the existing deterministic engines exactly as the workspace does.
 * It performs NO accounting arithmetic of its own — every number it records is
 * copied verbatim from an engine result field.
 *
 * The browser never supplies engine output: `finalizeRevision` rebuilds the
 * snapshot on the server from the stored canonical inputs, and the stored
 * snapshot is afterwards read back as recorded, never recalculated.
 */

import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  type ContractBalanceWorkflowResult,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import {
  analyzeGroupedJournalEntries,
  analyzeJournalEntries,
  type GroupedJournalAnalysis,
  type JournalAnalysis,
} from "@/lib/asc606-journals";

import { ARC_WORKFLOW_SCHEMA_VERSION } from "./schema";

/**
 * Version of the deterministic engine composition recorded with every
 * finalized snapshot. Bump it when engine behaviour changes so historical
 * snapshots can be identified as produced by an earlier engine.
 */
export const ARC_ENGINE_VERSION = "arc.engine.v1";

/**
 * The applicable journal output for a contract. A contract is either ordinary
 * or grouped (Phase 5C); it is never both and a complete workpaper is never
 * neither. Modelling it as a discriminated union makes "finalized with no
 * journal output" structurally impossible.
 */
export type ArcJournalSnapshot =
  | { kind: "ordinary"; analysis: JournalAnalysis }
  | { kind: "grouped"; analysis: GroupedJournalAnalysis };

/** Every engine output the workspace presents, computed exactly once. */
export interface ArcWorkpaper {
  workflow: WorkflowAnalysisResult;
  balances: ContractBalanceWorkflowResult;
  /** Null while the billing workpaper is incomplete. */
  journals: ArcJournalSnapshot | null;
}

export interface ArcEngineOutputsSnapshot {
  engineVersion: string;
  schemaVersion: string;
  workflow: WorkflowAnalysisResult;
  balances: ContractBalanceWorkflowResult;
  journals: ArcJournalSnapshot;
}

/**
 * Engine-provided reconciliation fields, copied as-is. Nothing here is
 * derived, summed or re-derived by ARC.
 */
export interface ArcReconciliationSnapshot {
  engineVersion: string;
  schemaVersion: string;
  step1Conclusion: WorkflowAnalysisResult["step1Conclusion"];
  totals: {
    transactionPriceCents: number | null;
    allocatedCents: number | null;
    revenueCents: number | null;
    unscheduledRevenueCents: number;
    lifecycleConsiderationCents: number | null;
  };
  // Engine-reported reconciliation objects, copied verbatim from the engines.
  core: NonNullable<WorkflowAnalysisResult["analysis"]>["reconciliation"] | null;
  lifecycle: NonNullable<WorkflowAnalysisResult["lifecycle"]>["reconciliation"] | null;
  variableConsideration:
    NonNullable<WorkflowAnalysisResult["variableConsideration"]>["reconciliation"] | null;
  modification: NonNullable<WorkflowAnalysisResult["modification"]>["reconciliation"] | null;
  balances: NonNullable<ContractBalanceWorkflowResult["analysis"]>["reconciliation"] | null;
  groupedBalancesReconciled: boolean | null;
  journalsReconciled: boolean | null;
  groupedJournalsReconciled: boolean | null;
}

export type FinalizationSnapshotResult =
  | {
      ok: true;
      engineOutputs: ArcEngineOutputsSnapshot;
      reconciliation: ArcReconciliationSnapshot;
    }
  | { ok: false; issues: string[] };

/**
 * Runs every deterministic engine for a draft exactly once, in the same order
 * and with the same inputs the workspace uses. No accounting decision is made
 * here: which journal engine applies is the balance engine's own `grouped`
 * conclusion.
 */
export function buildWorkpaper(draft: WorkflowDraft): ArcWorkpaper {
  const workflow = analyzeWorkflow(draft);
  const balances = analyzeContractBalanceWorkflow(draft);

  let journals: ArcJournalSnapshot | null = null;
  if (balances.finalized && balances.grouped) {
    journals = { kind: "grouped", analysis: analyzeGroupedJournalEntries(balances.groupInputs) };
  } else if (balances.finalized && balances.engineInput) {
    journals = { kind: "ordinary", analysis: analyzeJournalEntries(balances.engineInput) };
  }

  return { workflow, balances, journals };
}

/** Engine-reported blocking messages for an incomplete five-step analysis. */
function workflowIssues(workflow: WorkflowAnalysisResult): string[] {
  const issues = [
    ...workflow.workflowValidation.blocking.map((issue) => issue.message),
    ...workflow.adapterErrors,
    ...(workflow.engineValidation && workflow.engineValidation.status !== "passed"
      ? workflow.engineValidation.results
          .filter((check) => !check.passed && check.severity === "blocking")
          .map((check) => check.message)
      : []),
  ];
  return issues.length > 0
    ? issues
    : [workflow.blockedReason ?? "The ASC 606 analysis is not complete."];
}

/**
 * Reruns the engines against the persisted draft and records the outcome.
 *
 * A revision may be finalized only when the whole workpaper is complete: the
 * five-step analysis, the billing and contract-balance workpaper with a
 * reconciled balance conclusion, and the applicable reconciled journal
 * output. Warnings stay warnings; every blocking condition reported here is
 * reported by an existing engine.
 */
export function buildFinalizationSnapshot(draft: WorkflowDraft): FinalizationSnapshotResult {
  const workpaper = buildWorkpaper(draft);
  const { workflow, balances, journals } = workpaper;

  if (!workflow.finalized) {
    return { ok: false, issues: workflowIssues(workflow) };
  }

  if (!balances.finalized) {
    const issues = balances.validation.blocking.map((issue) => issue.message);
    return {
      ok: false,
      issues:
        issues.length > 0 ? issues : ["The Billing & Contract Balances workpaper is not complete."],
    };
  }

  if (!journals) {
    return {
      ok: false,
      issues: ["No journal entries could be produced from the billing workpaper."],
    };
  }

  if (journals.kind === "grouped") {
    if (balances.grouped?.reconciled !== true) {
      return { ok: false, issues: ["The combined gross contract balances do not reconcile."] };
    }
    for (const group of balances.grouped.groups) {
      if (group.analysis.reconciliation.reconciled !== true) {
        return {
          ok: false,
          issues: [`The contract balances for ${group.label} do not reconcile.`],
        };
      }
    }
    if (journals.analysis.reconciled !== true) {
      return { ok: false, issues: ["The grouped journal entries do not reconcile."] };
    }
  } else {
    if (balances.analysis?.reconciliation.reconciled !== true) {
      return { ok: false, issues: ["The contract balance workpaper does not reconcile."] };
    }
    if (journals.analysis.reconciliation.reconciled !== true) {
      return { ok: false, issues: ["The journal entries do not reconcile."] };
    }
  }

  // Structural guarantee: a successful snapshot always carries applicable
  // journal output; it can never mean "no journals".
  const engineOutputs: ArcEngineOutputsSnapshot = {
    engineVersion: ARC_ENGINE_VERSION,
    schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    workflow,
    balances,
    journals,
  };

  const reconciliation: ArcReconciliationSnapshot = {
    engineVersion: ARC_ENGINE_VERSION,
    schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    step1Conclusion: workflow.step1Conclusion,
    totals: {
      transactionPriceCents: workflow.analysis?.totals.transactionPriceCents ?? null,
      allocatedCents: workflow.analysis?.totals.allocatedCents ?? null,
      revenueCents: workflow.revenueSchedule?.totalCents ?? null,
      unscheduledRevenueCents: workflow.unscheduledRevenueCents,
      lifecycleConsiderationCents: workflow.lifecycleConsiderationCents,
    },
    core: workflow.analysis?.reconciliation ?? null,
    lifecycle: workflow.lifecycle?.reconciliation ?? null,
    variableConsideration: workflow.variableConsideration?.reconciliation ?? null,
    modification: workflow.modification?.reconciliation ?? null,
    balances: balances.analysis?.reconciliation ?? null,
    groupedBalancesReconciled: balances.grouped?.reconciled ?? null,
    journalsReconciled:
      journals.kind === "ordinary" ? journals.analysis.reconciliation.reconciled : null,
    groupedJournalsReconciled: journals.kind === "grouped" ? journals.analysis.reconciled : null,
  };

  // JSON round-trip so what is stored is exactly what can be read back.
  return {
    ok: true,
    engineOutputs: JSON.parse(JSON.stringify(engineOutputs)) as ArcEngineOutputsSnapshot,
    reconciliation: JSON.parse(JSON.stringify(reconciliation)) as ArcReconciliationSnapshot,
  };
}

/** Metadata the stored row itself carries, used to detect a rewritten row. */
export interface SnapshotMetadata {
  engineVersion: string;
  schemaVersion: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isNumber(value);
}

function isNullableBoolean(value: unknown): boolean {
  return value === null || typeof value === "boolean";
}

function matchesMetadata(value: Record<string, unknown>, expected?: SnapshotMetadata): boolean {
  if (typeof value["engineVersion"] !== "string") return false;
  if (typeof value["schemaVersion"] !== "string") return false;
  if (!expected) return true;
  return (
    value["engineVersion"] === expected.engineVersion &&
    value["schemaVersion"] === expected.schemaVersion
  );
}

/**
 * Reads a stored reconciliation snapshot back defensively. A snapshot written
 * by an earlier engine is returned exactly as recorded; it is never rebuilt.
 * When the row's own metadata is supplied it must agree with the snapshot's.
 */
export function readReconciliationSnapshot(
  value: unknown,
  expected?: SnapshotMetadata,
): ArcReconciliationSnapshot | null {
  if (!isObject(value)) return null;
  if (!matchesMetadata(value, expected)) return null;

  const totals = value["totals"];
  if (!isObject(totals)) return null;
  if (
    !isNullableNumber(totals["transactionPriceCents"]) ||
    !isNullableNumber(totals["allocatedCents"]) ||
    !isNullableNumber(totals["revenueCents"]) ||
    !isNumber(totals["unscheduledRevenueCents"]) ||
    !isNullableNumber(totals["lifecycleConsiderationCents"])
  ) {
    return null;
  }
  if (typeof value["step1Conclusion"] !== "string") return null;
  for (const key of ["core", "lifecycle", "variableConsideration", "modification", "balances"]) {
    const nested = value[key];
    if (nested !== null && !isObject(nested)) return null;
  }
  if (
    !isNullableBoolean(value["groupedBalancesReconciled"]) ||
    !isNullableBoolean(value["journalsReconciled"]) ||
    !isNullableBoolean(value["groupedJournalsReconciled"])
  ) {
    return null;
  }

  return value as unknown as ArcReconciliationSnapshot;
}

/** Every nested field the canonical workflow renderers read. */
function validWorkflow(value: unknown): boolean {
  if (!isObject(value)) return false;
  const validation = value["workflowValidation"];
  if (!isObject(validation)) return false;
  if (
    !isArray(validation["issues"]) ||
    !isArray(validation["blocking"]) ||
    !isArray(validation["warnings"])
  ) {
    return false;
  }
  if (typeof value["step1Conclusion"] !== "string") return false;
  if (typeof value["finalized"] !== "boolean") return false;
  if (value["blockedReason"] !== null && typeof value["blockedReason"] !== "string") return false;
  if (!isArray(value["adapterErrors"])) return false;
  if (value["engineValidation"] !== null && !isObject(value["engineValidation"])) return false;

  const analysis = value["analysis"];
  if (analysis !== null) {
    if (!isObject(analysis)) return false;
    if (!isObject(analysis["totals"]) || !isObject(analysis["reconciliation"])) return false;
    if (!isNumber((analysis["totals"] as Record<string, unknown>)["transactionPriceCents"])) {
      return false;
    }
  }

  for (const key of ["lifecycle", "variableConsideration", "modification"]) {
    const nested = value[key];
    if (nested !== null && !isObject(nested)) return false;
  }

  const allocation = value["allocation"];
  if (allocation !== null && !isArray(allocation)) return false;

  const schedule = value["revenueSchedule"];
  if (schedule !== null) {
    if (!isObject(schedule)) return false;
    if (!isNumber(schedule["totalCents"])) return false;
  }

  if (!isArray(value["revenueSources"]) || !isArray(value["contractGroups"])) return false;
  if (!isNumber(value["unscheduledRevenueCents"])) return false;
  if (!isNullableNumber(value["lifecycleConsiderationCents"])) return false;
  return true;
}

function validBalanceAnalysis(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!isObject(value["validation"])) return false;
  const reconciliation = value["reconciliation"];
  if (!isObject(reconciliation)) return false;
  if (!isNullableBoolean(reconciliation["reconciled"])) return false;
  const billing = value["billingSchedule"];
  const monthly = value["monthly"];
  if (billing !== null && !isArray(billing)) return false;
  if (monthly !== null && !isArray(monthly)) return false;
  return true;
}

function validBalances(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value["finalized"] !== "boolean") return false;
  const validation = value["validation"];
  if (!isObject(validation) || !isArray(validation["blocking"])) return false;
  if (value["analysis"] !== null && !validBalanceAnalysis(value["analysis"])) return false;
  if (!isArray(value["groupInputs"])) return false;

  const grouped = value["grouped"];
  if (grouped !== null) {
    if (!isObject(grouped)) return false;
    if (!isNullableBoolean(grouped["reconciled"])) return false;
    const groups = grouped["groups"];
    if (!isArray(groups)) return false;
    for (const group of groups) {
      if (!isObject(group)) return false;
      if (typeof group["groupId"] !== "string" || typeof group["label"] !== "string") return false;
      if (!validBalanceAnalysis(group["analysis"])) return false;
    }
  }
  return true;
}

function validJournalAnalysis(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!isObject(value["validation"])) return false;
  const reconciliation = value["reconciliation"];
  if (!isObject(reconciliation)) return false;
  if (!isNullableBoolean(reconciliation["reconciled"])) return false;
  const entries = value["entries"];
  const ledger = value["ledgerByMonth"];
  if (entries !== null && !isArray(entries)) return false;
  if (ledger !== null && !isArray(ledger)) return false;
  return true;
}

function validJournals(value: unknown): boolean {
  if (!isObject(value)) return false;
  const kind = value["kind"];
  if (kind === "ordinary") return validJournalAnalysis(value["analysis"]);
  if (kind !== "grouped") return false;

  const analysis = value["analysis"];
  if (!isObject(analysis)) return false;
  if (!isNullableBoolean(analysis["reconciled"])) return false;
  if (analysis["entries"] !== null && !isArray(analysis["entries"])) return false;
  const groups = analysis["groups"];
  if (!isArray(groups)) return false;
  for (const group of groups) {
    if (!isObject(group)) return false;
    if (typeof group["groupId"] !== "string" || typeof group["label"] !== "string") return false;
    if (!validJournalAnalysis(group["analysis"])) return false;
  }
  return true;
}

/**
 * Reads recorded engine outputs back defensively, validating every nested
 * shape the canonical historical renderers consume and, when the stored row's
 * own metadata is supplied, that the row and the snapshot agree on the engine
 * and schema versions.
 *
 * Returns null when the recording is missing, structurally unusable or
 * inconsistent with its row; the caller must then fail closed rather than
 * recalculate the inputs with the current engine.
 */
export function readEngineOutputsSnapshot(
  value: unknown,
  expected?: SnapshotMetadata,
): ArcEngineOutputsSnapshot | null {
  if (!isObject(value)) return null;
  if (!matchesMetadata(value, expected)) return null;
  if (!validWorkflow(value["workflow"])) return null;
  if (!validBalances(value["balances"])) return null;
  if (!validJournals(value["journals"])) return null;
  return value as unknown as ArcEngineOutputsSnapshot;
}

/**
 * Client-side readiness only: whether the whole workpaper — five-step
 * analysis, contract balances and the applicable journal output — is complete
 * and reconciled, using exactly the engine conclusions the server checks. The
 * server remains authoritative; this only decides whether the Finalize action
 * is offered.
 */
export function isWorkpaperComplete(workpaper: ArcWorkpaper): boolean {
  const { workflow, balances, journals } = workpaper;
  if (!workflow.finalized || !balances.finalized || !journals) return false;
  if (journals.kind === "grouped") {
    return (
      balances.grouped?.reconciled === true &&
      balances.grouped.groups.every((group) => group.analysis.reconciliation.reconciled === true) &&
      journals.analysis.reconciled === true
    );
  }
  return (
    balances.analysis?.reconciliation.reconciled === true &&
    journals.analysis.reconciliation.reconciled === true
  );
}
