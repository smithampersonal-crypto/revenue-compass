/**
 * Phase 5C deterministic contract-modification engine — public surface.
 *
 * Pure TypeScript: no React, DOM, network, database or AI dependency and no
 * mutable global accounting state. A blocking validation failure yields no
 * authoritative allocation, revenue schedule or reconciliation.
 *
 * Every identifier produced here comes from the deterministic identity helpers
 * in `segmentation.ts`. No timestamp, random value or array index ever enters
 * an accounting identity.
 */

export * from "./types";
export * from "./classification";
export * from "./segmentation";
export * from "./allocation";
export * from "./recognition";
export * from "./validation";

import {
  allocateTransactionPrice,
  generateRevenueSchedule,
  monthKeyOf,
  type AllocationRow,
  type Cents,
  type PerformanceObligationInput,
} from "@/lib/asc606";
import type { RevenueSource, RevenueSourceType } from "@/lib/asc606-material-rights";

import { activeModifiedPos, classifyModification } from "./classification";
import {
  allocateModificationPool,
  modificationPoolCents,
  sspBasisFor,
  sspForBasis,
} from "./allocation";
import {
  HISTORICAL_SEGMENT_ID,
  ORIGINAL_SEGMENT_ID,
  historicalCutoffDate,
  historicalRevenue,
  modificationSegmentId,
  modificationSourceId,
  type ModificationSourceKind,
  type SourceRow,
} from "./segmentation";
import {
  composeSchedule,
  computeCatchUp,
  continueFromRevisedCumulative,
  prospectiveRecognition,
} from "./recognition";
import {
  ContractModificationError,
  MIXED_POLICY_LABELS,
  signedConsiderationChangeCents,
  soleModificationEvent,
  type AccountingSegment,
  type ContractModificationAnalysis,
  type ContractModificationInput,
  type ContractPresentationGroup,
  type HistoricalPoRevenue,
  type ModificationAllocationBasis,
  type ModificationAllocationLayer,
  type ModificationCatchUpEvent,
  type ModificationEventInput,
  type ModifiedPerformanceObligationInput,
} from "./types";
import { validateContractModification } from "./validation";

export const ORIGINAL_GROUP_ID = "group::original";
export const NEW_CONTRACT_GROUP_ID = "group::separate";

const SOURCE_TYPE_BY_KIND: Record<ModificationSourceKind, RevenueSourceType> = {
  original_historical: "original_historical",
  separate_contract_po: "separate_contract_po",
  prospective_modified_po: "prospective_modified_po",
  modification_catch_up: "modification_catch_up",
  mixed_prospective_po: "mixed_prospective_po",
  mixed_catch_up: "mixed_catch_up",
  modification_continuation: "modification_post",
};

const ALLOCATION_BASIS_LABELS: Record<ModificationAllocationBasis, string> = {
  added_goods_remaining_ssp: "Standalone selling prices of the added goods and services",
  remaining_ssp: "Standalone selling prices of the remaining goods and services",
  total_modified_ssp: "Standalone selling prices of the modified performance obligations",
};

function sumRows(rows: readonly SourceRow[]): Cents {
  let total = 0n;
  for (const row of rows) total += BigInt(row.amountCents);
  return Number(total);
}

function sspEvidenceFor(
  pos: readonly ModifiedPerformanceObligationInput[],
  basis: ModificationAllocationBasis,
): ModificationAllocationLayer["sspEvidence"] {
  return pos.map((po) => ({
    poId: po.id,
    name: po.name,
    sspCents: sspForBasis(po, basis),
    basis: sspBasisFor(po, basis),
  }));
}

function blockedResult(
  input: ContractModificationInput,
  validation: ContractModificationAnalysis["validation"],
): ContractModificationAnalysis {
  const event = soleModificationEvent(input);
  const change = event ? signedConsiderationChangeCents(event) : 0;
  return {
    validation,
    event: null,
    historicalCutoffDate: null,
    classification: null,
    allocationLayers: null,
    historical: [],
    catchUpEvents: [],
    revenueSchedule: null,
    revenueSources: [],
    groups: [],
    segments: [],
    totals: {
      originalTransactionPriceCents: input.originalTransactionPriceCents,
      considerationChangeCents: change,
      lifecycleConsiderationCents: input.originalTransactionPriceCents + change,
      historicalRevenueCents: 0,
      unrecognizedOriginalConsiderationCents: 0,
      remainingTransactionPriceCents: null,
      updatedTotalTransactionPriceCents: null,
      catchUpCents: 0,
      futureRevenueCents: 0,
      scheduledRevenueCents: 0,
    },
    reconciliation: {
      historicalPlusCatchUpPlusFutureCents: null,
      differenceCents: null,
      reconciled: null,
    },
  };
}

export function analyzeContractModification(
  input: ContractModificationInput,
): ContractModificationAnalysis {
  const validation = validateContractModification(input);
  if (validation.blockingFailures.length > 0) return blockedResult(input, validation);

  const mod = soleModificationEvent(input);
  if (!mod) return blockedResult(input, validation);

  const classification = classifyModification(mod);
  const considerationChangeCents = signedConsiderationChangeCents(mod);
  const lifecycleConsiderationCents =
    input.originalTransactionPriceCents + considerationChangeCents;

  const originalAllocation = allocateTransactionPrice({
    transactionPriceCents: input.originalTransactionPriceCents,
    performanceObligations: input.originalPerformanceObligations,
  });
  const originalAllocatedById = new Map(
    originalAllocation.map((row) => [row.poId, row.allocatedCents]),
  );

  if (classification.treatment === "separate_contract") {
    return analyzeSeparateContract(input, mod, validation, classification, originalAllocation);
  }

  // ---- One combined contract: preserve history, then re-allocate ----------
  const cutoff = historicalCutoffDate(mod.modificationDate);
  const historical: HistoricalPoRevenue[] = [];
  const historicalRows: SourceRow[] = [];
  const historyByPo = new Map<string, Cents>();
  const historicalSources: RevenueSource[] = [];

  for (const po of [...input.originalPerformanceObligations].sort((a, b) => a.seq - b.seq)) {
    const segment = historicalRevenue(po, originalAllocatedById.get(po.id) ?? 0, cutoff);
    historyByPo.set(po.id, segment.totalCents);
    historical.push({
      poId: po.id,
      name: po.name,
      revenueCents: segment.totalCents,
      progressDays: segment.progressDays,
      totalDays: segment.totalDays,
    });
    if (segment.rows.length > 0) {
      const sourceId = modificationSourceId(mod.id, "original_historical", po.id);
      historicalRows.push(...segment.rows.map((row) => ({ ...row, sourceId })));
      historicalSources.push({
        id: sourceId,
        name: `${po.name} — original contract through ${cutoff}`,
        sourceType: SOURCE_TYPE_BY_KIND.original_historical,
        originalPoId: po.id,
        modificationId: mod.id,
        segmentId: HISTORICAL_SEGMENT_ID,
        groupId: ORIGINAL_GROUP_ID,
      });
    }
  }
  const historicalRevenueCents = sumRows(historicalRows);

  const active = activeModifiedPos(mod);
  const usesTotalBasis =
    classification.treatment === "cumulative_catch_up" ||
    (classification.treatment === "mixed" &&
      mod.mixedAllocationPolicy === "updated_total_transaction_price");
  const basis: ModificationAllocationBasis = usesTotalBasis
    ? "total_modified_ssp"
    : "remaining_ssp";
  const poolCents = modificationPoolCents(
    input.originalTransactionPriceCents,
    considerationChangeCents,
    usesTotalBasis,
    historicalRevenueCents,
  );

  if (poolCents < 0) {
    const failure = {
      id: "modification.pool.negative",
      category: "allocation" as const,
      severity: "blocking" as const,
      passed: false,
      message:
        "The consideration remaining after the modification is negative, so no authoritative allocation is produced.",
    };
    return blockedResult(input, {
      status: "attention",
      results: [...validation.results, failure],
      blockingFailures: [failure],
    });
  }

  const segmentKind = classification.treatment === "mixed" ? "mixed" : classification.treatment === "cumulative_catch_up" ? "catch_up" : "prospective";
  const postSegmentId = modificationSegmentId(mod.id, segmentKind);

  const allocationRows = allocateModificationPool(poolCents, active, basis);
  const allocatedById = new Map(allocationRows.map((row) => [row.poId, row.allocatedCents]));

  const catchUpEvents: ModificationCatchUpEvent[] = [];
  const futureRows: SourceRow[] = [];
  const catchUpRows: SourceRow[] = [];
  const postSources: RevenueSource[] = [];

  const pushFuture = (
    rows: SourceRow[],
    po: ModifiedPerformanceObligationInput,
    kind: ModificationSourceKind,
    sourceId: string,
  ) => {
    if (rows.length === 0) return;
    futureRows.push(...rows);
    postSources.push({
      id: sourceId,
      name: `${po.name} — after modification`,
      sourceType: SOURCE_TYPE_BY_KIND[kind],
      ...(po.sourcePoId ? { originalPoId: po.sourcePoId } : {}),
      modificationPoId: po.id,
      modificationId: mod.id,
      segmentId: postSegmentId,
      groupId: ORIGINAL_GROUP_ID,
    });
  };

  for (const po of active) {
    const allocated = allocatedById.get(po.id) ?? 0;
    const history = po.sourcePoId ? (historyByPo.get(po.sourcePoId) ?? 0) : 0;
    const isCatchUpPo =
      classification.treatment === "cumulative_catch_up" ||
      !po.remainingGoodsDistinctFromTransferred;

    if (isCatchUpPo) {
      const entitlement =
        classification.treatment === "mixed" &&
        mod.mixedAllocationPolicy === "updated_remaining_transaction_price"
          ? history + allocated
          : allocated;
      const catchUpKind: ModificationSourceKind =
        classification.treatment === "mixed" ? "mixed_catch_up" : "modification_catch_up";
      const catchUpId = modificationSourceId(mod.id, catchUpKind, po.id);
      const measured = computeCatchUp(po, entitlement, history, cutoff);

      if (measured.amountCents !== 0) {
        catchUpRows.push({
          sourceId: catchUpId,
          month: monthKeyOf(mod.modificationDate),
          amountCents: measured.amountCents,
          explanation: {
            template: "modification_cumulative_catch_up",
            inputs: {
              entitlementBasisCents: entitlement,
              progressDays: measured.progressDays,
              totalServiceDays: measured.totalDays,
              revisedCumulativeCents: measured.revisedCumulativeCents,
              previouslyRecognizedCents: history,
              effectiveDate: mod.modificationDate,
            },
          },
        });
        postSources.push({
          id: catchUpId,
          name: `${po.name} — modification catch-up`,
          sourceType: SOURCE_TYPE_BY_KIND[catchUpKind],
          ...(po.sourcePoId ? { originalPoId: po.sourcePoId } : {}),
          modificationPoId: po.id,
          modificationId: mod.id,
          segmentId: postSegmentId,
          groupId: ORIGINAL_GROUP_ID,
        });
      }
      catchUpEvents.push({
        id: catchUpId,
        poId: po.id,
        poName: po.name,
        sourcePoId: po.sourcePoId ?? po.id,
        sourceId: catchUpId,
        effectiveDate: mod.modificationDate,
        month: monthKeyOf(mod.modificationDate),
        entitlementBasisCents: entitlement,
        progressDays: measured.progressDays,
        totalDays: measured.totalDays,
        revisedCumulativeCents: measured.revisedCumulativeCents,
        previouslyRecognizedCents: history,
        amountCents: measured.amountCents,
      });

      // Modification-specific: continues the ORIGINAL clock from a revised
      // cumulative entitlement. The core engine cannot express an opening
      // cumulative balance; see recognition.ts.
      const continuationId = modificationSourceId(mod.id, "modification_continuation", po.id);
      const rows = continueFromRevisedCumulative(
        po,
        continuationId,
        entitlement,
        measured.revisedCumulativeCents,
        mod.modificationDate,
      );
      pushFuture(rows, po, "modification_continuation", continuationId);
    } else {
      const entitlement =
        classification.treatment === "mixed" &&
        mod.mixedAllocationPolicy === "updated_total_transaction_price"
          ? allocated - history
          : allocated;
      if (entitlement < 0) {
        throw new ContractModificationError(
          `post-modification entitlement for "${po.name}" is negative`,
        );
      }
      const kind: ModificationSourceKind =
        classification.treatment === "mixed" ? "mixed_prospective_po" : "prospective_modified_po";
      const sourceId = modificationSourceId(mod.id, kind, po.id);
      // Ordinary prospective obligation: delegated to the core engine.
      const rows = prospectiveRecognition(po, sourceId, entitlement);
      pushFuture(rows, po, kind, sourceId);
    }
  }

  const catchUpCents = sumRows(catchUpRows);
  const futureRevenueCents = sumRows(futureRows);
  const allRows = [...historicalRows, ...catchUpRows, ...futureRows];
  const revenueSources = [...historicalSources, ...postSources];
  const schedule = composeSchedule(
    allRows,
    revenueSources.map((source) => source.id),
  );

  if (
    BigInt(schedule.totalCents) !==
    BigInt(historicalRevenueCents) + BigInt(catchUpCents) + BigInt(futureRevenueCents)
  ) {
    throw new ContractModificationError("modification schedule composition invariant violated");
  }
  if (BigInt(schedule.totalCents) !== BigInt(lifecycleConsiderationCents)) {
    throw new ContractModificationError(
      `modification reconciliation invariant violated: scheduled ${schedule.totalCents} != modified consideration ${lifecycleConsiderationCents}`,
    );
  }

  const group: ContractPresentationGroup = {
    id: ORIGINAL_GROUP_ID,
    label: "Modified contract",
    transactionPriceCents: lifecycleConsiderationCents,
    revenueSchedule: schedule,
    revenueSources,
    unscheduledRevenueCents: 0,
  };

  const segments: AccountingSegment[] = [
    {
      id: HISTORICAL_SEGMENT_ID,
      label: `Original contract through ${cutoff}`,
      groupId: ORIGINAL_GROUP_ID,
      kind: "historical",
      startDate: null,
      endDate: cutoff,
      considerationCents: historicalRevenueCents,
    },
    {
      id: postSegmentId,
      label: `Modified contract from ${mod.modificationDate}`,
      groupId: ORIGINAL_GROUP_ID,
      kind: classification.treatment === "mixed" ? "mixed" : classification.treatment === "cumulative_catch_up" ? "catch_up" : "prospective",
      startDate: mod.modificationDate,
      endDate: null,
      considerationCents: catchUpCents + futureRevenueCents,
    },
  ];

  const layerLabel =
    classification.treatment === "mixed" && mod.mixedAllocationPolicy
      ? `${ALLOCATION_BASIS_LABELS[basis]} · ${MIXED_POLICY_LABELS[mod.mixedAllocationPolicy]}`
      : ALLOCATION_BASIS_LABELS[basis];

  const allocationLayers: ModificationAllocationLayer[] = [
    {
      basis,
      label: layerLabel,
      sspEvidence: sspEvidenceFor(active, basis),
      transactionPriceCents: poolCents,
      rows: allocationRows,
    },
  ];

  return {
    validation,
    event: mod,
    historicalCutoffDate: cutoff,
    classification,
    allocationLayers,
    historical,
    catchUpEvents,
    revenueSchedule: schedule,
    revenueSources,
    groups: [group],
    segments,
    totals: {
      originalTransactionPriceCents: input.originalTransactionPriceCents,
      considerationChangeCents,
      lifecycleConsiderationCents,
      historicalRevenueCents,
      unrecognizedOriginalConsiderationCents:
        input.originalTransactionPriceCents - historicalRevenueCents,
      remainingTransactionPriceCents: usesTotalBasis ? null : poolCents,
      updatedTotalTransactionPriceCents: usesTotalBasis ? poolCents : null,
      catchUpCents,
      futureRevenueCents,
      scheduledRevenueCents: schedule.totalCents,
    },
    reconciliation: {
      historicalPlusCatchUpPlusFutureCents:
        historicalRevenueCents + catchUpCents + futureRevenueCents,
      differenceCents:
        lifecycleConsiderationCents - (historicalRevenueCents + catchUpCents + futureRevenueCents),
      reconciled:
        lifecycleConsiderationCents === historicalRevenueCents + catchUpCents + futureRevenueCents,
    },
  };
}

function analyzeSeparateContract(
  input: ContractModificationInput,
  mod: ModificationEventInput,
  validation: ContractModificationAnalysis["validation"],
  classification: NonNullable<ContractModificationAnalysis["classification"]>,
  originalAllocation: AllocationRow[],
): ContractModificationAnalysis {
  const allocatedById = new Map(originalAllocation.map((row) => [row.poId, row.allocatedCents]));
  const originalPos = [...input.originalPerformanceObligations].sort((a, b) => a.seq - b.seq);
  const considerationChangeCents = signedConsiderationChangeCents(mod);
  const separateSegmentId = modificationSegmentId(mod.id, "separate");

  // The original contract is untouched: its approved schedule is reproduced
  // exactly, with no cutoff and no re-measurement.
  const originalSchedule = generateRevenueSchedule(
    originalPos.map((po: PerformanceObligationInput) => ({
      po,
      allocatedCents: allocatedById.get(po.id) ?? 0,
    })),
  );
  const originalSources: RevenueSource[] = originalPos.map((po) => ({
    id: po.id,
    name: po.name,
    sourceType: "original_po",
    originalPoId: po.id,
    segmentId: ORIGINAL_SEGMENT_ID,
    groupId: ORIGINAL_GROUP_ID,
  }));

  const added = activeModifiedPos(mod).filter((po) => po.status === "added");
  const newAllocation = allocateTransactionPrice({
    transactionPriceCents: considerationChangeCents,
    performanceObligations: added.map((po) => ({
      id: po.id,
      seq: po.seq,
      name: po.name,
      sspCents: sspForBasis(po, "added_goods_remaining_ssp"),
    })),
  });
  const newAllocatedById = new Map(newAllocation.map((row) => [row.poId, row.allocatedCents]));
  const newSourceIdByPo = new Map(
    added.map((po) => [po.id, modificationSourceId(mod.id, "separate_contract_po", po.id)]),
  );
  const newSchedule = generateRevenueSchedule(
    added.map((po) => ({
      po: {
        id: newSourceIdByPo.get(po.id)!,
        seq: po.seq,
        name: po.name,
        recognitionMethod: po.recognitionMethod,
        ...(po.serviceStart ? { serviceStart: po.serviceStart } : {}),
        ...(po.serviceEnd ? { serviceEnd: po.serviceEnd } : {}),
        ...(po.recognitionDate ? { recognitionDate: po.recognitionDate } : {}),
      },
      allocatedCents: newAllocatedById.get(po.id) ?? 0,
    })),
  );
  const newSources: RevenueSource[] = added.map((po) => ({
    id: newSourceIdByPo.get(po.id)!,
    name: po.name,
    sourceType: SOURCE_TYPE_BY_KIND.separate_contract_po,
    modificationPoId: po.id,
    modificationId: mod.id,
    segmentId: separateSegmentId,
    groupId: NEW_CONTRACT_GROUP_ID,
  }));

  const groups: ContractPresentationGroup[] = [
    {
      id: ORIGINAL_GROUP_ID,
      label: "Original contract",
      transactionPriceCents: input.originalTransactionPriceCents,
      revenueSchedule: originalSchedule,
      revenueSources: originalSources,
      unscheduledRevenueCents: 0,
    },
    {
      id: NEW_CONTRACT_GROUP_ID,
      label: `New contract — ${mod.scopeChangeDescription}`,
      transactionPriceCents: considerationChangeCents,
      revenueSchedule: newSchedule,
      revenueSources: newSources,
      unscheduledRevenueCents: 0,
    },
  ];

  const combinedRows: SourceRow[] = [
    ...originalSchedule.byPo.map((row) => ({
      sourceId: row.poId,
      month: row.month,
      amountCents: row.revenueCents,
      explanation: row.explanation,
    })),
    ...newSchedule.byPo.map((row) => ({
      sourceId: row.poId,
      month: row.month,
      amountCents: row.revenueCents,
      explanation: row.explanation,
    })),
  ];
  const revenueSources = [...originalSources, ...newSources];
  const combined = composeSchedule(
    combinedRows,
    revenueSources.map((source) => source.id),
  );

  const lifecycleConsiderationCents =
    input.originalTransactionPriceCents + considerationChangeCents;
  if (BigInt(combined.totalCents) !== BigInt(lifecycleConsiderationCents)) {
    throw new ContractModificationError(
      "separate-contract reconciliation invariant violated: combined revenue does not tie to lifecycle consideration",
    );
  }

  return {
    validation,
    event: mod,
    historicalCutoffDate: null,
    classification,
    allocationLayers: [
      {
        basis: "added_goods_remaining_ssp",
        label: ALLOCATION_BASIS_LABELS["added_goods_remaining_ssp"],
        sspEvidence: sspEvidenceFor(added, "added_goods_remaining_ssp"),
        transactionPriceCents: considerationChangeCents,
        rows: newAllocation,
      },
    ],
    historical: [],
    catchUpEvents: [],
    revenueSchedule: combined,
    revenueSources,
    groups,
    segments: [
      {
        id: ORIGINAL_SEGMENT_ID,
        label: "Original contract",
        groupId: ORIGINAL_GROUP_ID,
        kind: "original",
        startDate: null,
        endDate: null,
        considerationCents: input.originalTransactionPriceCents,
      },
      {
        id: separateSegmentId,
        label: `New contract from ${mod.modificationDate}`,
        groupId: NEW_CONTRACT_GROUP_ID,
        kind: "separate_contract",
        startDate: mod.modificationDate,
        endDate: null,
        considerationCents: considerationChangeCents,
      },
    ],
    totals: {
      originalTransactionPriceCents: input.originalTransactionPriceCents,
      considerationChangeCents,
      lifecycleConsiderationCents,
      historicalRevenueCents: 0,
      unrecognizedOriginalConsiderationCents: input.originalTransactionPriceCents,
      remainingTransactionPriceCents: null,
      updatedTotalTransactionPriceCents: null,
      catchUpCents: 0,
      futureRevenueCents: combined.totalCents,
      scheduledRevenueCents: combined.totalCents,
    },
    reconciliation: {
      historicalPlusCatchUpPlusFutureCents: combined.totalCents,
      differenceCents: lifecycleConsiderationCents - combined.totalCents,
      reconciled: lifecycleConsiderationCents === combined.totalCents,
    },
  };
}
