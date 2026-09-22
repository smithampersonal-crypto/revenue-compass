import { AiReviewTarget } from "@/components/arc/AiReviewTarget";
import { formatCents, type RecognitionMethod } from "@/lib/asc606";
import type { MaterialRightStatus } from "@/lib/asc606-material-rights";
import {
  materialRightStepPreviews,
  nextId,
  nextSeq,
  performanceObligationDisplayLabel,
  MATERIAL_RIGHT_STATUS_LABELS,
  type PoDraft,
  type ProgressEventDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, NarrativeTextarea, Notice, Section } from "./fields";
import { ProgressiveOutputs } from "./ProgressiveOutputs";
import { Step5VariableConsideration } from "./Step5VariableConsideration";

const smallButtonClass =
  "rounded-md border border-border px-2 py-1 text-sm font-medium text-foreground hover:bg-accent";

export function Step5Recognition({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const pos = draft.performanceObligations;
  // Read-only lifecycle amounts produced by the workflow/engine layer.
  const previews = new Map(materialRightStepPreviews(draft).map((row) => [row.poId, row]));
  const money = (cents: number | null) =>
    cents === null ? "Not yet determinable" : formatCents(cents);
  const patch = (id: string, values: Partial<PoDraft>) =>
    onChange({
      ...draft,
      performanceObligations: pos.map((po) => (po.id === id ? { ...po, ...values } : po)),
    });
  const patchProgressEvents = (po: PoDraft, progressEvents: ProgressEventDraft[]) =>
    patch(po.id, { progressEvents });

  const recognitionFields = (po: PoDraft, label: string) => (
    <>
      <AiReviewTarget targetKey={`po:${po.id}.recognitionMethod`}>
        <Field label={label}>
          <select
            className={inputClass}
            value={po.recognitionMethod ?? ""}
            onChange={(e) =>
              patch(po.id, {
                recognitionMethod: (e.target.value || null) as RecognitionMethod | null,
              })
            }
          >
            <option value="">Select a method…</option>
            <option value="over_time_ratable">Over time</option>
            <option value="point_in_time">Point in time</option>
          </select>
        </Field>
      </AiReviewTarget>

      {po.recognitionMethod === "over_time_ratable" ? (
        <>
          <AiReviewTarget targetKey={`po:${po.id}.overTimeMeasure`}>
            <Field label="Measure of progress">
              <select
                className={inputClass}
                value={po.overTimeMeasure ?? "time_based"}
                onChange={(e) =>
                  patch(po.id, {
                    overTimeMeasure: e.target.value as "time_based" | "input_measure",
                  })
                }
              >
                <option value="time_based">Time based — daily ratable</option>
                <option value="input_measure">Input measure — units incurred</option>
              </select>
            </Field>
          </AiReviewTarget>

          {po.overTimeMeasure === "input_measure" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <AiReviewTarget targetKey={`po:${po.id}.totalExpectedUnitsInput`}>
                  <Field label="Total contracted units (denominator)">
                    <input
                      className={inputClass}
                      inputMode="decimal"
                      value={po.totalExpectedUnitsInput ?? ""}
                      onChange={(e) => patch(po.id, { totalExpectedUnitsInput: e.target.value })}
                    />
                  </Field>
                </AiReviewTarget>
                <AiReviewTarget targetKey={`po:${po.id}.unitLabel`}>
                  <Field label="Unit label">
                    <input
                      className={inputClass}
                      value={po.unitLabel ?? ""}
                      placeholder="hours"
                      onChange={(e) => patch(po.id, { unitLabel: e.target.value })}
                    />
                  </Field>
                </AiReviewTarget>
              </div>

              <AiReviewTarget targetKey={`po:${po.id}.progressEvents`}>
                <div className="space-y-2" data-testid={`progress-events-${po.id}`}>
                  <p className="text-sm font-medium">
                    Actual {po.unitLabel || "units"} incurred to date
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Enter only effort that has actually been incurred. Future effort is never
                    assumed, and a blank entry is treated as missing, never as zero progress.
                  </p>

                  {(po.progressEvents ?? []).map((event) => (
                    <div key={event.id} className="grid gap-2 sm:grid-cols-3">
                      <Field label="Date incurred">
                        <input
                          type="date"
                          className={inputClass}
                          value={event.date}
                          onChange={(e) =>
                            patchProgressEvents(
                              po,
                              (po.progressEvents ?? []).map((row) =>
                                row.id === event.id ? { ...row, date: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label={`Units incurred (${po.unitLabel || "units"})`}>
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          value={event.unitsInput}
                          onChange={(e) =>
                            patchProgressEvents(
                              po,
                              (po.progressEvents ?? []).map((row) =>
                                row.id === event.id ? { ...row, unitsInput: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <div className="flex items-end">
                        <button
                          type="button"
                          className={smallButtonClass}
                          onClick={() =>
                            patchProgressEvents(
                              po,
                              (po.progressEvents ?? []).filter((row) => row.id !== event.id),
                            )
                          }
                        >
                          Remove entry
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    className={smallButtonClass}
                    onClick={() => {
                      const existing = po.progressEvents ?? [];
                      patchProgressEvents(po, [
                        ...existing,
                        {
                          id: nextId(`${po.id}-pe`, existing),
                          seq: nextSeq(existing),
                          date: "",
                          unitsInput: "",
                        },
                      ]);
                    }}
                  >
                    Add actual progress
                  </button>
                </div>
              </AiReviewTarget>
            </div>
          ) : (
            <AiReviewTarget targetKey={`po:${po.id}.servicePeriod`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <AiReviewTarget targetKey={`po:${po.id}.serviceStart`}>
                  <Field label="Service start date (inclusive)">
                    <input
                      type="date"
                      className={inputClass}
                      value={po.serviceStart}
                      onChange={(e) => patch(po.id, { serviceStart: e.target.value })}
                    />
                  </Field>
                </AiReviewTarget>
                <AiReviewTarget targetKey={`po:${po.id}.serviceEnd`}>
                  <Field label="Service end date (inclusive)">
                    <input
                      type="date"
                      className={inputClass}
                      value={po.serviceEnd}
                      onChange={(e) => patch(po.id, { serviceEnd: e.target.value })}
                    />
                  </Field>
                </AiReviewTarget>
              </div>
            </AiReviewTarget>
          )}
        </>
      ) : null}

      {po.recognitionMethod === "point_in_time" ? (
        <>
          <AiReviewTarget targetKey={`po:${po.id}.transferStatus`}>
            <Field label="Transfer of control">
              <select
                className={inputClass}
                value={po.transferStatus ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  const next: PoDraft = { ...po };
                  if (value === "") delete next.transferStatus;
                  else next.transferStatus = value as "transferred" | "not_yet_transferred";
                  // A deliberate move to "not yet transferred" removes any date
                  // previously entered: the date input disappears with it, so a
                  // retained date would be a contradiction the accountant can
                  // no longer see or correct. Moving back never invents one.
                  if (value === "not_yet_transferred") next.recognitionDate = "";
                  onChange({
                    ...draft,
                    performanceObligations: pos.map((row) => (row.id === po.id ? next : row)),
                  });
                }}
              >
                <option value="">Select…</option>
                <option value="transferred">Transferred — date known</option>
                <option value="not_yet_transferred">
                  Not yet transferred — date not yet known
                </option>
              </select>
            </Field>
          </AiReviewTarget>

          {po.transferStatus === "not_yet_transferred" ? (
            <Notice>
              Transfer has not happened yet, so the amount allocated to this obligation stays
              unrecognized and is reported as awaiting a transfer date. No date is assumed.
            </Notice>
          ) : (
            <AiReviewTarget targetKey={`po:${po.id}.recognitionDate`}>
              <Field label="Recognition date">
                <input
                  type="date"
                  className={inputClass}
                  value={po.recognitionDate}
                  onChange={(e) => patch(po.id, { recognitionDate: e.target.value })}
                />
              </Field>
            </AiReviewTarget>
          )}
        </>
      ) : null}

      <AiReviewTarget targetKey={`po:${po.id}.recognitionRationale`}>
        <Field label="Recognition rationale">
          <NarrativeTextarea
            value={po.recognitionRationale}
            onChange={(e) => patch(po.id, { recognitionRationale: e.target.value })}
          />
        </Field>
      </AiReviewTarget>
    </>
  );

  return (
    <Section
      title="Recognition Judgments"
      description="Select the recognition method and supporting dates for each performance obligation. Revenue amounts are produced by the deterministic engine."
    >
      <div className="space-y-4">
        {pos.length === 0 ? (
          <Notice>Create performance obligations in Step 2B first.</Notice>
        ) : null}
        {pos.map((po) => (
          <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-semibold">
              {performanceObligationDisplayLabel(po)}
              {po.kind === "material_right" ? " — material right" : ""}
            </p>

            {po.kind === "material_right" ? (
              <>
                <Field label="Option outcome (accountant judgment)">
                  <select
                    className={inputClass}
                    value={po.materialRightStatus}
                    onChange={(e) =>
                      patch(po.id, {
                        materialRightStatus: e.target.value as MaterialRightStatus,
                      })
                    }
                  >
                    {(["outstanding", "exercised", "expired"] as const).map((status) => (
                      <option key={status} value={status}>
                        {MATERIAL_RIGHT_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </Field>

                {po.materialRightStatus === "outstanding" ? (
                  <Notice>
                    <p>
                      The option is still outstanding, so the consideration allocated to it has no
                      determinable revenue date and is reported as unscheduled consideration.
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">
                        Unscheduled material-right allocation (engine):{" "}
                      </span>
                      {money(previews.get(po.id)?.unscheduledCents ?? null)}
                    </p>
                  </Notice>
                ) : null}

                {po.materialRightStatus === "expired" ? (
                  <Notice>
                    <span className="font-semibold">
                      Amount recognized upon expiration (engine):{" "}
                    </span>
                    {money(previews.get(po.id)?.expirationRevenueCents ?? null)}
                  </Notice>
                ) : null}

                {po.materialRightStatus === "expired" ? (
                  <Field label="Expiration date">
                    <input
                      type="date"
                      className={inputClass}
                      value={po.expirationDate}
                      onChange={(e) => patch(po.id, { expirationDate: e.target.value })}
                    />
                  </Field>
                ) : null}

                {po.materialRightStatus === "exercised" ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Exercise date">
                        <input
                          type="date"
                          className={inputClass}
                          value={po.exerciseDate}
                          onChange={(e) => patch(po.id, { exerciseDate: e.target.value })}
                        />
                      </Field>
                      <Field label="New consideration on exercise (USD)">
                        <UsdMoneyInput
                          value={po.exerciseConsiderationInput}
                          onValueChange={(next) =>
                            patch(po.id, { exerciseConsiderationInput: next })
                          }
                        />
                      </Field>
                    </div>
                    <Notice>
                      <p>
                        <span className="font-semibold">New consideration: </span>
                        {money(previews.get(po.id)?.exerciseConsiderationCents ?? null)}
                      </p>
                      <p>
                        <span className="font-semibold">
                          Carried material-right allocation (engine):{" "}
                        </span>
                        {money(previews.get(po.id)?.allocatedCents ?? null)}
                      </p>
                      <p>
                        <span className="font-semibold">
                          Exercise-segment recognition basis (engine):{" "}
                        </span>
                        {money(previews.get(po.id)?.recognitionBasisCents ?? null)}
                      </p>
                    </Notice>
                    {recognitionFields(
                      po,
                      `Recognition method for ${po.underlyingGoodOrServiceName || "the good or service obtained on exercise"}`,
                    )}
                  </>
                ) : null}
              </>
            ) : (
              recognitionFields(po, "Recognition method")
            )}
          </div>
        ))}

        <Step5VariableConsideration draft={draft} onChange={onChange} />

        <ProgressiveOutputs draft={draft} />
      </div>
    </Section>
  );
}
