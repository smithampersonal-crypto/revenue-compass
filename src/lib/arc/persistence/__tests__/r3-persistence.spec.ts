/**
 * Phase 9G-R3 Part 2 integration patch, Section A.
 *
 * Proves that every additive R3 accountant fact survives the real persistence
 * path — validate, serialize, parse — and that a malformed R3 fact fails
 * closed instead of being silently stripped.
 */

import { describe, expect, it } from "vitest";

import {
  ARC_WORKFLOW_SCHEMA_VERSION,
  parseCanonicalInputs,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "@/lib/arc/persistence/schema";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

function draftWithR3Facts(): WorkflowDraft {
  const draft = createDemoDraftIfKnown("redwood") ?? createEmptyDraft();
  const po = draft.performanceObligations[0]!;
  po.recognitionMethod = "over_time_ratable";
  po.overTimeMeasure = "input_measure";
  po.totalExpectedUnitsInput = "120";
  po.unitLabel = "hours";
  po.progressEvents = [{ id: `${po.id}-pe-1`, seq: 1, date: "2026-02-28", unitsInput: "30" }];
  const second = draft.performanceObligations[1];
  if (second) second.transferStatus = "not_yet_transferred";

  draft.hasVariableConsideration = true;
  draft.variableConsiderationComponents = [
    {
      id: "vc-sla",
      seq: 1,
      treatment: "estimated",
      description: "Service level credits",
      effect: "decrease",
      estimationMethod: "most_likely_amount",
      allocationTreatment: "specific_series_period",
      targetPoId: po.id,
      relatesSpecifically: true,
      consistentWithAllocationObjective: true,
      allocationRationale: "Credits relate to the month in which the service failed.",
      inception: {
        id: "vc-sla-a1",
        seq: 1,
        effectiveDate: "2026-01-01",
        outcomes: [],
        includedInput: "0",
        constraintRationale: "No trigger at inception.",
        evidence: "Contract section 8.",
      },
      remeasurements: [],
      hasResolution: false,
      resolutionDate: "",
      resolutionAmountInput: "",
      resolutionRationale: "",
      meters: [
        {
          id: "vc-sla-m1",
          seq: 1,
          name: "API calls",
          rateAmountInput: "4.00",
          rateQuantityInput: "1000000",
          unit: "calls",
          includedQuantityInput: "500000",
        },
      ],
      seriesPeriods: [
        {
          id: "vc-sla-p1",
          seq: 1,
          label: "February 2026",
          startDate: "2026-02-01",
          endDate: "2026-02-28",
        },
      ],
      realizedEvents: [
        {
          id: "vc-sla-r1",
          seq: 1,
          date: "2026-02-28",
          amountInput: "2500.00",
          seriesPeriodId: "vc-sla-p1",
          description: "February outage credit",
        },
      ],
      billOnRealization: true,
      usagePeriods: [{ id: "vc-sla-u1", month: "2026-02", quantities: { "vc-sla-m1": "750000" } }],
    },
  ];
  return draft;
}

describe("R3 facts round-trip through real ARC persistence", () => {
  it("survives validate -> serialize -> parse unchanged", () => {
    const draft = draftWithR3Facts();

    const validated = validateDraftForPersistence(draft);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const stored = toCanonicalInputs(validated.draft);
    expect(stored.schemaVersion).toBe(ARC_WORKFLOW_SCHEMA_VERSION);

    const parsed = parseCanonicalInputs(JSON.parse(JSON.stringify(stored)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const po = parsed.draft.performanceObligations[0]!;
    expect(po.overTimeMeasure).toBe("input_measure");
    expect(po.totalExpectedUnitsInput).toBe("120");
    expect(po.unitLabel).toBe("hours");
    expect(po.progressEvents).toEqual(draft.performanceObligations[0]!.progressEvents);
    expect(parsed.draft.performanceObligations[1]?.transferStatus).toBe(
      draft.performanceObligations[1]?.transferStatus,
    );

    const component = parsed.draft.variableConsiderationComponents[0]!;
    expect(component.meters[0]!.includedQuantityInput).toBe("500000");
    expect(component.seriesPeriods).toEqual(
      draft.variableConsiderationComponents[0]!.seriesPeriods,
    );
    expect(component.realizedEvents).toEqual(
      draft.variableConsiderationComponents[0]!.realizedEvents,
    );
    expect(component.billOnRealization).toBe(true);

    expect(parsed.draft).toEqual(draft);
  });

  it("still reads a saved draft written before the R3 facts existed", () => {
    const legacy = createDemoDraftIfKnown("meridian")!;
    const stored = toCanonicalInputs(legacy);
    const parsed = parseCanonicalInputs(stored);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schemaVersion).toBe("arc.workflow.v1");
    expect(parsed.draft.performanceObligations[0]!.progressEvents).toBeUndefined();
  });

  it("fails closed on malformed R3 facts instead of stripping them", () => {
    const badProgressEvent = () => {
      const draft = draftWithR3Facts();
      (draft.performanceObligations[0]!.progressEvents as unknown as unknown[])[0] = {
        id: "pe-1",
      };
      return draft;
    };
    const badTransferStatus = () => {
      const draft = draftWithR3Facts();
      (draft.performanceObligations[0] as unknown as Record<string, unknown>)["transferStatus"] =
        "maybe";
      return draft;
    };
    const badSeriesPeriod = () => {
      const draft = draftWithR3Facts();
      (draft.variableConsiderationComponents[0]!.seriesPeriods as unknown as unknown[])[0] = {
        id: "p",
        seq: "first",
      };
      return draft;
    };
    const badRealizedEvent = () => {
      const draft = draftWithR3Facts();
      (draft.variableConsiderationComponents[0]!.realizedEvents as unknown as unknown[])[0] = {
        id: "r",
        seq: 1,
      };
      return draft;
    };
    const badMeterThreshold = () => {
      const draft = draftWithR3Facts();
      (draft.variableConsiderationComponents[0]!.meters[0] as unknown as Record<string, unknown>)[
        "includedQuantityInput"
      ] = 500000;
      return draft;
    };
    const badBillOnRealization = () => {
      const draft = draftWithR3Facts();
      (draft.variableConsiderationComponents[0] as unknown as Record<string, unknown>)[
        "billOnRealization"
      ] = "yes";
      return draft;
    };

    for (const build of [
      badProgressEvent,
      badTransferStatus,
      badSeriesPeriod,
      badRealizedEvent,
      badMeterThreshold,
      badBillOnRealization,
    ]) {
      expect(validateDraftForPersistence(build()).ok).toBe(false);
    }
  });
});
