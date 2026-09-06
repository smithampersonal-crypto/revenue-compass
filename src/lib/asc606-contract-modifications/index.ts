/**
 * Phase 5C deterministic contract-modification engine — public surface.
 *
 * Pure TypeScript: no React, DOM, network, database or AI dependency and no
 * mutable global accounting state. A blocking validation failure yields no
 * authoritative allocation, revenue schedule or reconciliation.
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
  proportionOfCents,
  type AllocationRow,
  type Cents,
  type PerformanceObligationInput,
} from "@/lib/asc606";
import type { RevenueSource } from "@/lib/asc606-material-rights";

import { activeModifiedPos, classifyModification } from "./classification";
import { allocateModificationPool, modificationPoolCents } from "./allocation";
import { historicalCutoffDate, historicalRevenue, type SourceRow } from "./segmentation";
import {
  composeSchedule,
  continueFromRevisedCumulative,
  progressThroughCutoff,
  prospectiveRecognition,
} from "./recognition";
import {
  ContractModificationError,
  MIXED_POLICY_LABELS,
  type ContractModificationAnalysis,
  type ContractModificationInput,
  type ContractPresentationGroup,
  type HistoricalPoRevenue,
  type ModificationAllocationBasis,
  type ModificationAllocationLayer,
  type ModificationCatchUpEvent,
  type ModifiedPerformanceObligationInput,
  type AccountingSegment,
} from "./types";
import { validateContractModification } from "./validation";

export const ORIGINAL_GROUP_ID = "group::original";
export const NEW_CONTRACT_GROUP_ID = "group::separate";

export function catchUpSourceId(modificationId: string, poId: string): string {
  return `${modificationId}::catch_up::${poId}`;
}

export function futureSourceId(modificationId: string, poId: string): string {
  return `${modificationId}::post_modification::${poId}`;
}

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

function blockedResult(
  input: ContractModificationInput,
  validation: ContractModificationAnalysis["validation"],
): ContractModificationAnalysis {
  return {
    validation,
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
      considerationChangeCents: input.modification.considerationChangeCents,
      lifecycleConsiderationCents:
        input.originalTransactionPriceCents + input.modification.considerationChangeCents,
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

  const classification = classifyModification(input);
  const mod = input.modification;
  const lifecycleConsiderationCents =
    input.originalTransactionPriceCents + mod.considerationChangeCents;

  const originalAllocation = allocateTransactionPrice({
    transactionPriceCents: input.originalTransactionPriceCents,
    performanceObligations: input.originalPerformanceObligations,
  });
  const originalAllocatedById = new Map(
    originalAllocation.map((row) => [row.poId, row.allocatedCents]),
  );

  if (classification.treatment === "separate_contract") {
    return analyzeSeparateContract(input, validation, classification, originalAllocation);
  }

  // ---- One combined contract: preserve history, then re-allocate ----------
  const cutoff = historicalCutoffDate(mod.effectiveDate);
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
      historicalRows.push(...segment.rows);
      historicalSources.push({
        id: po.id,
        name: `${po.name} — original contract through ${cutoff}`,
        sourceType: "original_po",
        originalPoId: po.id,
      });
    }
  }
  const historicalRevenueCents = sumRows(historicalRows);

  const active = activeModifiedPos(input);
  const usesTotalBasis =
    classification.treatment === "cumulative_catch_up" ||
    (classification.treatment === "mixed" &&
      mod.mixedAllocationPolicy === "total_transaction_price");
  const basis: ModificationAllocationBasis = usesTotalBasis
    ? "total_modified_ssp"
    : "remaining_ssp";
  const poolCents = modificationPoolCents(input, usesTotalBasis, historicalRevenueCents);

  if (poolCents < 0) {
    return blockedResult(input, {
      status: "attention",
      results: [
        ...validation.results,
        {
          id: "modification.pool.negative",
          category: "allocation",
          severity: "blocking",
          passed: false,
          message:
            "The consideration remaining after the modification is negative, so no authoritative allocation is produced.",
        },
      ],
      blockingFailures: [
        {
          id: "modification.pool.negative",
          category: "allocation",
          severity: "blocking",
          passed: false,
          message:
            "The consideration remaining after the modification is negative, so no authoritative allocation is produced.",
        },
      ],
    });
  }

  const allocationRows = allocateModificationPool(poolCents, active, basis);
  const allocatedById = new Map(allocationRows.map((row) => [row.poId, row.allocatedCents]));

  const catchUpEvents: ModificationCatchUpEvent[] = [];
  const futureRows: SourceRow[] = [];
  const catchUpRows: SourceRow[] = [];
  const postSources: RevenueSource[] = [];

  for (const po of active) {
    const allocated = allocatedById.get(po.id) ?? 0;
    const history = po.sourcePoId ? (historyByPo.get(po.sourcePoId) ?? 0) : 0;
    const isCatchUpPo =
      classification.treatment === "cumulative_catch_up" || !po.remainingGoodsDistinct;

    if (isCatchUpPo) {
      const entitlement =
        classification.treatment === "mixed" &&
        mod.mixedAllocationPolicy === "remaining_transaction_price"
          ? history + allocated
          : allocated;
      const { progressDays, totalDays } = progressThroughCutoff(po, cutoff);
      const revisedCumulative = proportionOfCents(
        entitlement,
        progressDays,
        totalDays,
        `revised cumulative revenue for "${po.name}"`,
      );
      const amountCents = revisedCumulative - history;
      const sourceId = catchUpSourceId(mod.id, po.id);
      if (amountCents !== 0) {
        catchUpRows.push({
          sourceId,
          month: monthKeyOf(mod.effectiveDate),
          amountCents,
          explanation: {
            template: "modification_cumulative_catch_up",
            inputs: {
              entitlementBasisCents: entitlement,
              progressDays,
              totalServiceDays: totalDays,
              revisedCumulativeCents: revisedCumulative,
              previouslyRecognizedCents: history,
              effectiveDate: mod.effectiveDate,
            },
          },
        });
        postSources.push({
          id: sourceId,
          name: `${po.name} — modification catch-up`,
          sourceType: "modification_catch_up",
          ...(po.sourcePoId ? { originalPoId: po.sourcePoId } : {}),
          modificationPoId: po.id,
          modificationId: mod.id,
        });
      }
      catchUpEvents.push({
        id: sourceId,
        poId: po.id,
        sourcePoId: po.sourcePoId ?? po.id,
        sourceId,
        effectiveDate: mod.effectiveDate,
        month: monthKeyOf(mod.effectiveDate),
        entitlementBasisCents: entitlement,
        revisedCumulativeCents: revisedCumulative,
        previouslyRecognizedCents: history,
        amountCents,
      });

      // Modification-specific: continues the ORIGINAL clock from a revised
      // cumulative entitlement. The core engine cannot express an opening
      // cumulative balance; see recognition.ts.
      const rows = continueFromRevisedCumulative(
        po,
        futureSourceId(mod.id, po.id),
        entitlement,
        revisedCumulative,
        mod.effectiveDate,
      );
      pushFuture(rows, po, mod.id, futureRows, postSources);
    } else {
      const entitlement =
        classification.treatment === "mixed" &&
        mod.mixedAllocationPolicy === "total_transaction_price"
          ? allocated - history
          : allocated;
      if (entitlement < 0) {
        throw new ContractModificationError(
          `post-modification entitlement for "${po.name}" is negative`,
        );
      }
      // Ordinary prospective obligation: delegated to the core engine.
      const rows = prospectiveRecognition(po, futureSourceId(mod.id, po.id), entitlement);
      pushFuture(rows, po, mod.id, futureRows, postSources);
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
      id: "segment::historical",
      label: `Original contract through ${cutoff}`,
      groupId: ORIGINAL_GROUP_ID,
      kind: "historical",
      startDate: null,
      endDate: cutoff,
      considerationCents: historicalRevenueCents,
    },
    {
      id: "segment::post_modification",
      label: `Modified contract from ${mod.effectiveDate}`,
      groupId: ORIGINAL_GROUP_ID,
      kind: "post_modification",
      startDate: mod.effectiveDate,
      endDate: null,
      considerationCents: catchUpCents + futureRevenueCents,
    },
  ];

  const layerLabel =
    classification.treatment === "mixed" && mod.mixedAllocationPolicy
      ? `${ALLOCATION_BASIS_LABELS[basis]} · ${MIXED_POLICY_LABELS[mod.mixedAllocationPolicy]}`
      : ALLOCATION_BASIS_LABELS[basis];

  const allocationLayers: ModificationAllocationLayer[] = [
    { basis, label: layerLabel, transactionPriceCents: poolCents, rows: allocationRows },
  ];

  return {
    validation,
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
      considerationChangeCents: mod.considerationChangeCents,
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

function pushFuture(
  rows: SourceRow[],
  po: ModifiedPerformanceObligationInput,
  modificationId: string,
  futureRows: SourceRow[],
  sources: RevenueSource[],
): void {
  if (rows.length === 0) return;
  futureRows.push(...rows);
  sources.push({
    id: futureSourceId(modificationId, po.id),
    name: `${po.name} — after modification`,
    sourceType: "modification_post",
    ...(po.sourcePoId ? { originalPoId: po.sourcePoId } : {}),
    modificationPoId: po.id,
    modificationId,
  });
}

function analyzeSeparateContract(
  input: ContractModificationInput,
  validation: ContractModificationAnalysis["validation"],
  classification: NonNullable<ContractModificationAnalysis["classification"]>,
  originalAllocation: AllocationRow[],
): ContractModificationAnalysis {
  const mod = input.modification;
  const allocatedById = new Map(originalAllocation.map((row) => [row.poId, row.allocatedCents]));
  const originalPos = [...input.originalPerformanceObligations].sort((a, b) => a.seq - b.seq);

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
  }));

  const added = activeModifiedPos(input).filter((po) => po.status === "added");
  const newAllocation = allocateTransactionPrice({
    transactionPriceCents: mod.considerationChangeCents,
    performanceObligations: added.map((po) => ({
      id: po.id,
      seq: po.seq,
      name: po.name,
      sspCents: po.remainingSspCents,
    })),
  });
  const newAllocatedById = new Map(newAllocation.map((row) => [row.poId, row.allocatedCents]));
  const newSchedule = generateRevenueSchedule(
    added.map((po) => ({
      po: {
        id: po.id,
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
    id: po.id,
    name: po.name,
    sourceType: "separate_contract_po",
    modificationPoId: po.id,
    modificationId: mod.id,
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
      label: `New contract — ${mod.description}`,
      transactionPriceCents: mod.considerationChangeCents,
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
    input.originalTransactionPriceCents + mod.considerationChangeCents;
  if (BigInt(combined.totalCents) !== BigInt(lifecycleConsiderationCents)) {
    throw new ContractModificationError(
      "separate-contract reconciliation invariant violated: combined revenue does not tie to lifecycle consideration",
    );
  }

  return {
    validation,
    classification,
    allocationLayers: [
      {
        basis: "added_goods_remaining_ssp",
        label: ALLOCATION_BASIS_LABELS["added_goods_remaining_ssp"],
        transactionPriceCents: mod.considerationChangeCents,
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
        id: "segment::original",
        label: "Original contract",
        groupId: ORIGINAL_GROUP_ID,
        kind: "original",
        startDate: null,
        endDate: null,
        considerationCents: input.originalTransactionPriceCents,
      },
      {
        id: "segment::separate",
        label: `New contract from ${mod.effectiveDate}`,
        groupId: NEW_CONTRACT_GROUP_ID,
        kind: "separate_contract",
        startDate: mod.effectiveDate,
        endDate: null,
        considerationCents: mod.considerationChangeCents,
      },
    ],
    totals: {
      originalTransactionPriceCents: input.originalTransactionPriceCents,
      considerationChangeCents: mod.considerationChangeCents,
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
