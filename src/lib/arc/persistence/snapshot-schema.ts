/**
 * Phase 7D — versioned, renderer-safe runtime decoding of a frozen snapshot.
 *
 * A finalized revision is presented from its recording, never recalculated, so
 * the recording must be proven safe for every field the canonical historical
 * workspace dereferences. This module owns that proof for `arc.engine.v1`.
 *
 * Rules:
 *  - Structural / integrity validation only. No accounting amount is derived,
 *    summed or re-checked here; every number is accepted exactly as recorded.
 *  - Objects are permissive about EXTRA keys (a later engine may add fields)
 *    and strict about the keys the renderers read.
 *  - Decoders are keyed by engine version. When a future engine version is
 *    introduced, add a new decoder; never reinterpret v1 JSON with a new shape.
 */

import { z } from "zod";

/* ---------------------------------------------------------------- shared -- */

const cents = z.number().int();
const nullableCents = cents.nullable();
const nullableBool = z.boolean().nullable();
const text = z.string();
const nullableText = z.string().nullable();
const severity = z.enum(["blocking", "warning"]);
const outcomeStatus = z.enum(["passed", "attention"]);

const explanation = z
  .object({
    template: text,
    inputs: z.record(z.union([z.number(), z.string()])),
  })
  .passthrough();

const allocationRow = z
  .object({
    poId: text,
    seq: z.number(),
    name: text,
    sspCents: cents,
    totalSspCents: cents,
    relativeSspPercent: z.number(),
    allocatedCents: cents,
    explanation,
  })
  .passthrough();

const revenueSchedule = z
  .object({
    byPo: z.array(
      z.object({ poId: text, month: text, revenueCents: cents, explanation }).passthrough(),
    ),
    byMonth: z.array(
      z
        .object({
          month: text,
          perPo: z.record(cents),
          totalCents: cents,
          cumulativeCents: cents,
        })
        .passthrough(),
    ),
    totalCents: cents,
    firstMonth: nullableText,
    lastMonth: nullableText,
  })
  .passthrough();

const checkResult = z
  .object({ id: text, category: text, severity, message: text, passed: z.boolean() })
  .passthrough();

const validationOutcome = z
  .object({
    status: outcomeStatus,
    results: z.array(checkResult),
    blockingFailures: z.array(checkResult),
  })
  .passthrough();

const revenueSource = z
  .object({
    id: text,
    name: text,
    sourceType: text,
    // Optional provenance the historical renderers read when present; typed so
    // a malformed recording cannot reach a renderer as an arbitrary value.
    originalPoId: text.optional(),
    materialRightPoId: text.optional(),
    usageComponentId: text.optional(),
    modificationPoId: text.optional(),
    modificationId: text.optional(),
    segmentId: text.optional(),
    groupId: text.optional(),
    effectiveDate: text.optional(),
  })
  .passthrough();

const coreReconciliation = z
  .object({
    allocationDifferenceCents: nullableCents,
    revenueDifferenceCents: nullableCents,
    reconciled: nullableBool,
  })
  .passthrough();

const differenceReconciliation = z
  .object({
    scheduledPlusUnscheduledCents: nullableCents,
    differenceCents: nullableCents,
    reconciled: nullableBool,
  })
  .passthrough();

/* ------------------------------------------------------- workflow output -- */

/** The workflow step keys the historical step presentation indexes by. */
const workflowStepId = z.enum(["1", "2a", "2b", "3", "4", "5", "mod"]);

const workflowIssue = z
  .object({ id: text, step: workflowStepId, severity, message: text })
  .passthrough();

/** Every step key must be present: the renderers index all seven directly. */
const issuesByStep = z
  .object({
    "1": z.array(workflowIssue),
    "2a": z.array(workflowIssue),
    "2b": z.array(workflowIssue),
    "3": z.array(workflowIssue),
    "4": z.array(workflowIssue),
    "5": z.array(workflowIssue),
    mod: z.array(workflowIssue),
  })
  .passthrough();

const workflowValidation = z
  .object({
    issues: z.array(workflowIssue),
    blocking: z.array(workflowIssue),
    warnings: z.array(workflowIssue),
    blockingByStep: issuesByStep,
    warningsByStep: issuesByStep,
  })
  .passthrough();

const phase1Analysis = z
  .object({
    validation: validationOutcome,
    allocation: z.array(allocationRow).nullable(),
    revenueSchedule: revenueSchedule.nullable(),
    totals: z
      .object({
        transactionPriceCents: cents,
        allocatedCents: nullableCents,
        revenueCents: nullableCents,
      })
      .passthrough(),
    reconciliation: coreReconciliation,
  })
  .passthrough();

const materialRightOutcome = z
  .object({
    poId: text,
    seq: z.number(),
    name: text,
    underlyingGoodOrServiceName: text,
    benefitAmountCents: cents,
    exerciseProbabilityBps: z.number(),
    estimatedSspCents: cents,
    allocatedCents: cents,
    status: z.enum(["outstanding", "exercised", "expired"]),
    unscheduledCents: cents,
    exerciseDate: nullableText,
    exerciseConsiderationCents: nullableCents,
    exerciseRecognitionBasisCents: nullableCents,
    expirationDate: nullableText,
    expirationRevenueCents: nullableCents,
    revenueSourceId: nullableText,
  })
  .passthrough();

const lifecycleAnalysis = z
  .object({
    validation: validationOutcome,
    allocation: z.array(allocationRow).nullable(),
    revenueSchedule: revenueSchedule.nullable(),
    revenueSources: z.array(revenueSource),
    materialRights: z.array(materialRightOutcome),
    totals: z
      .object({
        originalTransactionPriceCents: cents,
        originalAllocatedCents: nullableCents,
        exerciseConsiderationCents: cents,
        lifecycleConsiderationCents: cents,
        scheduledRevenueCents: nullableCents,
        unscheduledMaterialRightCents: nullableCents,
      })
      .passthrough(),
    reconciliation: differenceReconciliation,
  })
  .passthrough();

const vcAssessment = z
  .object({
    assessmentId: text,
    seq: z.number(),
    effectiveDate: text,
    unconstrainedCents: cents,
    includedCents: cents,
    constraintConclusion: text,
    constraintRationale: text,
    changeCents: cents,
    isResolution: z.boolean(),
  })
  .passthrough();

const vcComponent = z
  .object({
    componentId: text,
    seq: z.number(),
    description: text,
    effect: z.enum(["increase", "decrease"]),
    estimationMethod: text,
    allocationTreatment: text,
    targetPoId: nullableText,
    initialIncludedCents: cents,
    currentIncludedCents: cents,
    assessments: z.array(vcAssessment),
    resolved: z.boolean(),
  })
  .passthrough();

const vcChangeEvent = z
  .object({
    id: text,
    componentId: text,
    assessmentId: text,
    effectiveDate: text,
    month: text,
    transactionPriceChangeCents: cents,
    allocationByPo: z.array(z.object({ poId: text, amountCents: cents }).passthrough()),
    catchUpCents: cents,
    futureImpactCents: cents,
    isResolution: z.boolean(),
  })
  .passthrough();

const vcUsagePeriod = z
  .object({
    componentId: text,
    targetPoId: text,
    revenueSourceId: text,
    month: text,
    meters: z.array(
      z
        .object({
          meterId: text,
          meterName: text,
          quantity: z.number(),
          rateAmountCents: cents,
          rateQuantity: z.number(),
          amountCents: cents,
        })
        .passthrough(),
    ),
    totalCents: cents,
  })
  .passthrough();

const poAmount = z.object({ poId: text, name: text, amountCents: cents }).passthrough();

const vcAnalysis = z
  .object({
    validation: validationOutcome,
    allocation: z
      .object({
        base: z.array(allocationRow),
        specific: z.array(
          z
            .object({
              componentId: text,
              description: text,
              poId: text,
              poName: text,
              amountCents: cents,
            })
            .passthrough(),
        ),
        inceptionFinal: z.array(poAmount),
        currentFinal: z.array(poAmount),
      })
      .passthrough()
      .nullable(),
    revenueSchedule: revenueSchedule.nullable(),
    revenueSources: z.array(revenueSource),
    components: z.array(vcComponent),
    changeEvents: z.array(vcChangeEvent),
    usagePeriods: z.array(vcUsagePeriod),
    materialRights: z.array(materialRightOutcome),
    totals: z
      .object({
        fixedConsiderationCents: cents,
        initialTransactionPriceCents: cents,
        currentEstimatedConsiderationCents: cents,
        usageConsiderationCents: cents,
        exerciseConsiderationCents: cents,
        lifecycleConsiderationCents: cents,
        scheduledRevenueCents: nullableCents,
        unscheduledConsiderationCents: nullableCents,
      })
      .passthrough(),
    reconciliation: differenceReconciliation,
  })
  .passthrough();

const contractPresentationGroup = z
  .object({
    id: text,
    label: text,
    transactionPriceCents: cents,
    revenueSchedule,
    revenueSources: z.array(revenueSource),
    unscheduledRevenueCents: cents,
  })
  .passthrough();

const modificationAnalysis = z
  .object({
    validation: validationOutcome,
    event: z
      .object({ id: text, modificationDate: text, scopeChangeDescription: text })
      .passthrough()
      .nullable(),
    historicalCutoffDate: nullableText,
    classification: z
      .object({
        treatment: text,
        label: text,
        separateContractTestPassed: z.boolean(),
        separateContractCriteria: z.array(
          z.object({ id: text, label: text, passed: z.boolean(), detail: text }).passthrough(),
        ),
        separateContractFailures: z.array(text),
        rationale: text,
        mixedAllocationPolicy: z
          .enum(["updated_total_transaction_price", "updated_remaining_transaction_price"])
          .nullable(),
        mixedAllocationPolicyRationale: nullableText,
        approvedAndEnforceable: z.boolean(),
        approvalRationale: nullableText,
      })
      .passthrough()
      .nullable(),
    allocationLayers: z
      .array(
        z
          .object({
            basis: text,
            label: text,
            sspEvidence: z.array(
              z
                .object({
                  poId: text,
                  name: text,
                  sspCents: cents,
                  basis: nullableText,
                })
                .passthrough(),
            ),
            transactionPriceCents: cents,
            rows: z.array(allocationRow),
          })
          .passthrough(),
      )
      .nullable(),
    historical: z.array(
      z
        .object({
          poId: text,
          name: text,
          revenueCents: cents,
          progressDays: z.number().nullable(),
          totalDays: z.number().nullable(),
        })
        .passthrough(),
    ),
    catchUpEvents: z.array(
      z
        .object({
          id: text,
          poId: text,
          poName: text,
          sourcePoId: text,
          sourceId: text,
          effectiveDate: text,
          month: text,
          entitlementBasisCents: cents,
          progressDays: z.number(),
          totalDays: z.number(),
          revisedCumulativeCents: cents,
          previouslyRecognizedCents: cents,
          amountCents: cents,
        })
        .passthrough(),
    ),
    revenueSchedule: revenueSchedule.nullable(),
    revenueSources: z.array(revenueSource),
    groups: z.array(contractPresentationGroup),
    segments: z.array(
      z
        .object({
          id: text,
          label: text,
          groupId: text,
          kind: text,
          startDate: nullableText,
          endDate: nullableText,
          considerationCents: cents,
        })
        .passthrough(),
    ),
    totals: z
      .object({
        originalTransactionPriceCents: cents,
        considerationChangeCents: cents,
        lifecycleConsiderationCents: cents,
        historicalRevenueCents: cents,
        unrecognizedOriginalConsiderationCents: cents,
        remainingTransactionPriceCents: nullableCents,
        updatedTotalTransactionPriceCents: nullableCents,
        catchUpCents: cents,
        futureRevenueCents: cents,
        scheduledRevenueCents: cents,
      })
      .passthrough(),
    reconciliation: z
      .object({
        historicalPlusCatchUpPlusFutureCents: nullableCents,
        differenceCents: nullableCents,
        reconciled: nullableBool,
      })
      .passthrough(),
  })
  .passthrough();

const workflowSnapshot = z
  .object({
    workflowValidation,
    step1Conclusion: z.enum(["qualified", "not_qualified", "incomplete"]),
    // A finalized recording can only be of a finalized workpaper.
    finalized: z.literal(true),
    blockedReason: nullableText,
    adapterErrors: z.array(text),
    engineValidation: validationOutcome.nullable(),
    analysis: phase1Analysis.nullable(),
    lifecycle: lifecycleAnalysis.nullable(),
    allocation: z.array(allocationRow).nullable(),
    revenueSchedule: revenueSchedule.nullable(),
    revenueSources: z.array(revenueSource),
    unscheduledRevenueCents: cents,
    lifecycleConsiderationCents: nullableCents,
    variableConsideration: vcAnalysis.nullable(),
    modification: modificationAnalysis.nullable(),
    contractGroups: z.array(contractPresentationGroup),
  })
  .passthrough();

/* ------------------------------------------------------- balance output -- */

const balanceIssue = z.object({ id: text, severity, message: text }).passthrough();

const balanceValidation = z
  .object({
    status: outcomeStatus,
    results: z.array(checkResult),
    blockingFailures: z.array(checkResult),
  })
  .passthrough();

const monthlyBalanceRow = z
  .object({
    month: text,
    revenueCents: cents,
    cumulativeRevenueCents: cents,
    unconditionalRightsCents: cents,
    cumulativeUnconditionalRightsCents: cents,
    invoicesIssuedCents: cents,
    cumulativeInvoicesIssuedCents: cents,
    cashCollectedCents: cents,
    cumulativeCashCollectedCents: cents,
    billedArCents: cents,
    unbilledArCents: cents,
    totalArCents: cents,
    contractAssetCents: cents,
    contractLiabilityCents: cents,
  })
  .passthrough();

const contractBalanceAnalysis = z
  .object({
    validation: balanceValidation,
    billingSchedule: z
      .array(
        z
          .object({
            seq: z.number(),
            eventId: text,
            amountCents: cents,
            unconditionalRightDate: text,
            invoiceDate: text,
            cashCollectedCents: cents,
            outstandingCents: cents,
          })
          .passthrough(),
      )
      .nullable(),
    monthly: z.array(monthlyBalanceRow).nullable(),
    reconciliation: z
      .object({
        transactionPriceCents: cents,
        totalConsiderationEventsCents: cents,
        differenceCents: nullableCents,
        totalRevenueCents: nullableCents,
        unscheduledRevenueCents: cents,
        reconciled: nullableBool,
      })
      .passthrough(),
  })
  .passthrough();

const balancesSnapshot = z
  .object({
    validation: z
      .object({
        issues: z.array(balanceIssue),
        blocking: z.array(balanceIssue),
        warnings: z.array(balanceIssue),
      })
      .passthrough(),
    // A finalized recording can only be of a complete balance workpaper.
    finalized: z.literal(true),
    blockedReason: nullableText,
    engineValidation: balanceValidation.nullable(),
    analysis: contractBalanceAnalysis.nullable(),
    engineInput: z.object({}).passthrough().nullable(),
    groupInputs: z.array(
      z.object({ groupId: text, label: text, input: z.object({}).passthrough() }).passthrough(),
    ),
    grouped: z
      .object({
        groups: z.array(
          z.object({ groupId: text, label: text, analysis: contractBalanceAnalysis }).passthrough(),
        ),
        combinedMonthly: z.array(monthlyBalanceRow).nullable(),
        combinedTransactionPriceCents: cents,
        combinedRevenueCents: nullableCents,
        reconciled: nullableBool,
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

/* ------------------------------------------------------- journal output -- */

const journalLine = z
  .object({
    account: z.enum([
      "cash",
      "billed_ar",
      "unbilled_ar",
      "contract_asset",
      "contract_liability",
      "revenue",
    ]),
    debitCents: cents,
    creditCents: cents,
    poId: text.optional(),
  })
  .passthrough();

const journalEntry = z
  .object({
    id: text,
    date: text,
    month: text,
    eventType: z.enum([
      "revenue_recognition",
      "unconditional_right",
      "invoice_reclassification",
      "cash_collection",
    ]),
    sourceId: nullableText,
    description: text,
    lines: z.array(journalLine),
    totalDebitsCents: cents,
    totalCreditsCents: cents,
  })
  .passthrough();

const journalReconciliation = z
  .object({
    allEntriesBalanced: nullableBool,
    monthlyBalancesTie: nullableBool,
    revenueByPoTies: nullableBool,
    sourceEventsComplete: nullableBool,
    reconciled: nullableBool,
  })
  .passthrough();

const journalAnalysis = z
  .object({
    validation: z
      .object({
        status: outcomeStatus,
        results: z.array(checkResult),
        blockingFailures: z.array(checkResult),
      })
      .passthrough(),
    entries: z.array(journalEntry).nullable(),
    ledgerByMonth: z
      .array(
        z
          .object({
            month: text,
            cashCents: cents,
            billedArCents: cents,
            unbilledArCents: cents,
            contractAssetCents: cents,
            contractLiabilityCents: cents,
            cumulativeCashCents: cents,
            cumulativeRevenueCents: cents,
            revenueByPoCents: z.record(cents),
          })
          .passthrough(),
      )
      .nullable(),
    reconciliation: journalReconciliation,
  })
  .passthrough();

const groupedJournalAnalysis = z
  .object({
    groups: z.array(
      z.object({ groupId: text, label: text, analysis: journalAnalysis }).passthrough(),
    ),
    entries: z.array(journalEntry.and(z.object({ groupId: text, groupLabel: text }))).nullable(),
    reconciled: nullableBool,
  })
  .passthrough();

const journalsSnapshot = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ordinary"), analysis: journalAnalysis }).passthrough(),
  z.object({ kind: z.literal("grouped"), analysis: groupedJournalAnalysis }).passthrough(),
]);

/* ------------------------------------------------------------- top level -- */

const engineOutputsV1 = z
  .object({
    engineVersion: text,
    schemaVersion: text,
    workflow: workflowSnapshot,
    balances: balancesSnapshot,
    journals: journalsSnapshot,
  })
  .passthrough()
  .superRefine((value, ctx) => {
    // Integrity, not arithmetic: the recorded journal kind and the recorded
    // balance output must describe the same workpaper.
    if (value.journals.kind === "ordinary" && value.balances.analysis === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An ordinary journal recording requires an ordinary balance analysis.",
      });
    }
    if (value.journals.kind === "grouped") {
      const grouped = value.balances.grouped;
      if (!grouped || grouped.groups.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A grouped journal recording requires grouped balance output.",
        });
      }
    }
  });

const reconciliationV1 = z
  .object({
    engineVersion: text,
    schemaVersion: text,
    step1Conclusion: z.enum(["qualified", "not_qualified", "incomplete"]),
    totals: z
      .object({
        transactionPriceCents: nullableCents,
        allocatedCents: nullableCents,
        revenueCents: nullableCents,
        unscheduledRevenueCents: cents,
        lifecycleConsiderationCents: nullableCents,
      })
      .passthrough(),
    core: coreReconciliation.nullable(),
    lifecycle: differenceReconciliation.nullable(),
    variableConsideration: differenceReconciliation.nullable(),
    modification: z
      .object({
        historicalPlusCatchUpPlusFutureCents: nullableCents,
        differenceCents: nullableCents,
        reconciled: nullableBool,
      })
      .passthrough()
      .nullable(),
    balances: z
      .object({
        transactionPriceCents: cents,
        totalConsiderationEventsCents: cents,
        differenceCents: nullableCents,
        totalRevenueCents: nullableCents,
        unscheduledRevenueCents: cents,
        reconciled: nullableBool,
      })
      .passthrough()
      .nullable(),
    groupedBalancesReconciled: nullableBool,
    journalsReconciled: nullableBool,
    groupedJournalsReconciled: nullableBool,
  })
  .passthrough();

/**
 * Decoders keyed by the engine version that produced the recording. A future
 * engine adds its own entry; the v1 decoder is preserved so v1 JSON is never
 * reinterpreted with a newer shape.
 */
const DECODERS: Record<string, { engineOutputs: z.ZodTypeAny; reconciliation: z.ZodTypeAny }> = {
  "arc.engine.v1": { engineOutputs: engineOutputsV1, reconciliation: reconciliationV1 },
};

/** True when a recording of this engine version can be decoded at all. */
export function hasSnapshotDecoder(engineVersion: string): boolean {
  return Boolean(DECODERS[engineVersion]);
}

/** Structural decode of recorded engine outputs. Returns false when unusable. */
export function isDecodableEngineOutputs(value: unknown, engineVersion: string): boolean {
  const decoder = DECODERS[engineVersion];
  if (!decoder) return false;
  return decoder.engineOutputs.safeParse(value).success;
}

/** Structural decode of a recorded reconciliation. Returns false when unusable. */
export function isDecodableReconciliation(value: unknown, engineVersion: string): boolean {
  const decoder = DECODERS[engineVersion];
  if (!decoder) return false;
  return decoder.reconciliation.safeParse(value).success;
}
