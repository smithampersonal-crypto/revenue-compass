import type { ReactNode } from "react";

import { AiReviewTarget } from "@/components/arc/AiReviewTarget";
import { formatCents } from "@/lib/asc606";
import {
  createVcAssessmentDraft,
  createVcComponentDraft,
  createVcMeterDraft,
  createVcOutcomeDraft,
  nextId,
  nextSeq,
  parseUsdToCents,
  previewVcMeasurement,
  VC_ALLOCATION_TREATMENT_LABELS,
  VC_EFFECT_LABELS,
  VC_ESTIMATION_METHOD_LABELS,
  type VcAssessmentDraft,
  type VcComponentDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import type {
  EstimationMethod,
  VcAllocationTreatment,
  VcEffect,
} from "@/lib/asc606-variable-consideration";

import { Field, inputClass, JudgmentControl, Notice, Section } from "./fields";

const buttonClass =
  "rounded-md border border-border px-2 py-1 text-sm font-medium text-foreground hover:bg-accent";

/**
 * One canonical meter field target ↔ one presentation boundary. Only the
 * deterministic AI meter (`${componentId}-m1`) carries AI targets; manually
 * added meter rows render as ordinary controls.
 */
type MeterFieldProps = { componentId: string; field: string; children: ReactNode };

function AiMeterField({ componentId, field, children }: MeterFieldProps) {
  return <AiReviewTarget targetKey={`vc:${componentId}.meter.${field}`}>{children}</AiReviewTarget>;
}

function PlainMeterField({ children }: MeterFieldProps) {
  return <>{children}</>;
}

export function Step3TransactionPrice({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const parsed = parseUsdToCents(draft.transactionPriceInput);
  const components = draft.variableConsiderationComponents;

  const setComponents = (next: VcComponentDraft[]) =>
    onChange({ ...draft, variableConsiderationComponents: next });

  const patchComponent = (id: string, values: Partial<VcComponentDraft>) =>
    setComponents(components.map((c) => (c.id === id ? { ...c, ...values } : c)));

  // Deterministic persisted identity: never a timestamp, random value or array
  // index. The same action on the same draft always produces the same id.
  const addComponent = (treatment: "estimated" | "usage_as_incurred") => {
    setComponents([
      ...components,
      createVcComponentDraft(nextSeq(components), nextId("vc", components), treatment),
    ]);
  };

  const patchAssessment = (
    component: VcComponentDraft,
    assessmentId: string,
    values: Partial<VcAssessmentDraft>,
  ) => {
    if (component.inception.id === assessmentId) {
      patchComponent(component.id, { inception: { ...component.inception, ...values } });
      return;
    }
    patchComponent(component.id, {
      remeasurements: component.remeasurements.map((a) =>
        a.id === assessmentId ? { ...a, ...values } : a,
      ),
    });
  };

  const assessmentEditor = (
    component: VcComponentDraft,
    assessment: VcAssessmentDraft,
    title: string,
    onRemove?: () => void,
  ) => (
    <div key={assessment.id} className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        {onRemove ? (
          <button type="button" className={buttonClass} onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>

      <Field label="Effective date of this assessment">
        <input
          type="date"
          className={inputClass}
          value={assessment.effectiveDate}
          onChange={(e) =>
            patchAssessment(component, assessment.id, { effectiveDate: e.target.value })
          }
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Possible outcomes (accountant judgment)</p>
        {assessment.outcomes.map((outcome) => (
          <div key={outcome.id} className="grid gap-2 sm:grid-cols-4">
            <Field label="Description">
              <input
                className={inputClass}
                value={outcome.description}
                onChange={(e) =>
                  patchAssessment(component, assessment.id, {
                    outcomes: assessment.outcomes.map((o) =>
                      o.id === outcome.id ? { ...o, description: e.target.value } : o,
                    ),
                  })
                }
              />
            </Field>
            <Field label="Amount (USD)">
              <input
                className={inputClass}
                inputMode="decimal"
                value={outcome.amountInput}
                onChange={(e) =>
                  patchAssessment(component, assessment.id, {
                    outcomes: assessment.outcomes.map((o) =>
                      o.id === outcome.id ? { ...o, amountInput: e.target.value } : o,
                    ),
                  })
                }
              />
            </Field>
            {component.estimationMethod === "expected_value" ? (
              <Field label="Probability (%)">
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={outcome.probabilityInput}
                  onChange={(e) =>
                    patchAssessment(component, assessment.id, {
                      outcomes: assessment.outcomes.map((o) =>
                        o.id === outcome.id ? { ...o, probabilityInput: e.target.value } : o,
                      ),
                    })
                  }
                />
              </Field>
            ) : (
              <label className="flex items-end gap-2 text-sm">
                <input
                  type="radio"
                  name={`most-likely-${assessment.id}`}
                  checked={outcome.isMostLikely}
                  onChange={() =>
                    patchAssessment(component, assessment.id, {
                      outcomes: assessment.outcomes.map((o) => ({
                        ...o,
                        isMostLikely: o.id === outcome.id,
                      })),
                    })
                  }
                />
                Most likely amount
              </label>
            )}
            <div className="flex items-end">
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  patchAssessment(component, assessment.id, {
                    outcomes: assessment.outcomes.filter((o) => o.id !== outcome.id),
                  })
                }
              >
                Remove outcome
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            patchAssessment(component, assessment.id, {
              outcomes: [
                ...assessment.outcomes,
                createVcOutcomeDraft(
                  nextSeq(assessment.outcomes),
                  nextId(`${assessment.id}-o`, assessment.outcomes),
                ),
              ],
            })
          }
        >
          Add outcome
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Amount included after the constraint (USD)"
          hint="The accountant decides how much is included; the engine never constrains automatically."
        >
          <input
            className={inputClass}
            inputMode="decimal"
            value={assessment.includedInput}
            onChange={(e) =>
              patchAssessment(component, assessment.id, { includedInput: e.target.value })
            }
          />
        </Field>
        <Field label="Constraint rationale (ASC 606-10-32-11)">
          <textarea
            className={inputClass}
            rows={2}
            value={assessment.constraintRationale}
            onChange={(e) =>
              patchAssessment(component, assessment.id, { constraintRationale: e.target.value })
            }
          />
        </Field>
      </div>
      <Field label="Evidence supporting this assessment (optional)">
        <textarea
          className={inputClass}
          rows={2}
          value={assessment.evidence}
          onChange={(e) => patchAssessment(component, assessment.id, { evidence: e.target.value })}
        />
      </Field>
    </div>
  );

  return (
    <Section
      title="Transaction Price"
      description="Enter fixed consideration, then add any variable-consideration components. Every estimate, constraint conclusion and allocation judgment is yours; the engine only calculates."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <AiReviewTarget targetKey="transactionPrice.input">
          <Field label="Fixed consideration (USD)" hint="Example: 120,000.00">
            <input
              className={inputClass}
              inputMode="decimal"
              value={draft.transactionPriceInput}
              onChange={(e) => onChange({ ...draft, transactionPriceInput: e.target.value })}
            />
          </Field>
        </AiReviewTarget>
        <AiReviewTarget targetKey="transactionPrice.notes">
          <Field label="Transaction price notes (optional)">
            <textarea
              className={inputClass}
              rows={2}
              value={draft.transactionPriceNotes}
              onChange={(e) => onChange({ ...draft, transactionPriceNotes: e.target.value })}
            />
          </Field>
        </AiReviewTarget>
      </div>

      {draft.transactionPriceInput.trim() === "" ? null : parsed.ok ? (
        <p className="text-sm">
          Fixed consideration interpreted as{" "}
          <span className="font-semibold">{formatCents(parsed.cents)}</span>.
        </p>
      ) : (
        <Notice tone="danger">{parsed.error}</Notice>
      )}

      <AiReviewTarget targetKey="draft.hasVariableConsideration">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.hasVariableConsideration}
            onChange={(e) => onChange({ ...draft, hasVariableConsideration: e.target.checked })}
          />
          This contract contains variable consideration
        </label>
      </AiReviewTarget>

      {draft.hasVariableConsideration ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={() => addComponent("estimated")}>
              Add estimated component
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => addComponent("usage_as_incurred")}
            >
              Add usage-as-incurred component
            </button>
          </div>

          {components.length === 0 ? (
            <Notice>No variable-consideration components have been added yet.</Notice>
          ) : null}

          {components.map((component) => (
            <AiReviewTarget
              key={component.id}
              targetKey={`vc:${component.id}`}
              canonicalObjectId={component.id}
              className="space-y-3 rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <AiReviewTarget targetKey={`vc:${component.id}.treatment`}>
                  <p className="text-sm font-semibold">
                    {component.treatment === "estimated"
                      ? "Estimated variable consideration"
                      : "Usage as incurred"}
                  </p>
                </AiReviewTarget>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setComponents(components.filter((c) => c.id !== component.id))}
                >
                  Remove component
                </button>
              </div>

              <AiReviewTarget targetKey={`vc:${component.id}.description`}>
                <Field label="Description">
                  <input
                    className={inputClass}
                    value={component.description}
                    onChange={(e) => patchComponent(component.id, { description: e.target.value })}
                  />
                </Field>
              </AiReviewTarget>

              {component.treatment === "estimated" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Direction of the variability">
                    <select
                      className={inputClass}
                      value={component.effect}
                      onChange={(e) =>
                        patchComponent(component.id, { effect: e.target.value as VcEffect })
                      }
                    >
                      {(["increase", "decrease"] as const).map((effect) => (
                        <option key={effect} value={effect}>
                          {VC_EFFECT_LABELS[effect]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <AiReviewTarget targetKey={`vc:${component.id}.estimationMethod`}>
                    <Field label="Estimation method (ASC 606-10-32-8)">
                      <select
                        className={inputClass}
                        value={component.estimationMethod ?? ""}
                        onChange={(e) =>
                          patchComponent(component.id, {
                            estimationMethod: (e.target.value || null) as EstimationMethod | null,
                          })
                        }
                      >
                        <option value="">Select a method…</option>
                        {(["most_likely_amount", "expected_value"] as const).map((method) => (
                          <option key={method} value={method}>
                            {VC_ESTIMATION_METHOD_LABELS[method]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </AiReviewTarget>
                </div>
              ) : null}

              <Field label="Allocation treatment">
                <select
                  className={inputClass}
                  value={component.allocationTreatment}
                  onChange={(e) =>
                    patchComponent(component.id, {
                      allocationTreatment: e.target.value as VcAllocationTreatment,
                    })
                  }
                  disabled={component.treatment === "usage_as_incurred"}
                >
                  {(component.treatment === "estimated"
                    ? (["general", "specific_po"] as const)
                    : (["specific_series_period"] as const)
                  ).map((treatment) => (
                    <option key={treatment} value={treatment}>
                      {VC_ALLOCATION_TREATMENT_LABELS[treatment]}
                    </option>
                  ))}
                </select>
              </Field>

              {component.allocationTreatment !== "general" ? (
                <>
                  <Field label="Performance obligation the variability relates to">
                    <select
                      className={inputClass}
                      value={component.targetPoId ?? ""}
                      onChange={(e) =>
                        patchComponent(component.id, { targetPoId: e.target.value || null })
                      }
                    >
                      <option value="">Select a performance obligation…</option>
                      {draft.performanceObligations
                        .filter((po) =>
                          component.treatment === "usage_as_incurred" ||
                          component.allocationTreatment === "specific_series_period"
                            ? po.kind !== "material_right" && po.classification === "series"
                            : true,
                        )
                        .map((po) => (
                          <option key={po.id} value={po.id}>
                            {po.name || `Performance obligation ${po.seq}`}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <JudgmentControl
                    name={`${component.id}-relates`}
                    legend={
                      component.treatment === "estimated"
                        ? "Does the variable amount relate specifically to this performance obligation?"
                        : "Does each usage fee relate specifically to the distinct service period in which it is incurred?"
                    }
                    value={component.relatesSpecifically}
                    onChange={(value) =>
                      patchComponent(component.id, { relatesSpecifically: value })
                    }
                  />
                  <JudgmentControl
                    name={`${component.id}-objective`}
                    legend="Is allocating the variable amount entirely to that item consistent with the allocation objective?"
                    value={component.consistentWithAllocationObjective}
                    onChange={(value) =>
                      patchComponent(component.id, { consistentWithAllocationObjective: value })
                    }
                  />
                </>
              ) : null}

              <Field label="Allocation rationale">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={component.allocationRationale}
                  onChange={(e) =>
                    patchComponent(component.id, { allocationRationale: e.target.value })
                  }
                />
              </Field>

              {component.treatment === "estimated" ? (
                <>
                  <AiReviewTarget targetKey={`vc:${component.id}.inception`}>
                    {assessmentEditor(component, component.inception, "Inception estimate")}
                  </AiReviewTarget>
                  {component.treatment === "estimated" ? (
                    <MeasurementReadout component={component} />
                  ) : null}
                  {component.remeasurements.map((assessment) =>
                    assessmentEditor(component, assessment, `Remeasurement ${assessment.seq}`, () =>
                      patchComponent(component.id, {
                        remeasurements: component.remeasurements.filter(
                          (a) => a.id !== assessment.id,
                        ),
                      }),
                    ),
                  )}
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() =>
                      patchComponent(component.id, {
                        remeasurements: [
                          ...component.remeasurements,
                          createVcAssessmentDraft(
                            component.remeasurements.length + 2,
                            `${component.id}-a${component.remeasurements.length + 2}-${Date.now()}`,
                          ),
                        ],
                      })
                    }
                  >
                    Add remeasurement
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Usage meters (fixed rate per quantity)</p>
                  {component.meters.map((meter) => {
                    // The merge engine owns exactly one deterministic AI meter
                    // per component. Only its fields carry AI targets, and each
                    // field is its own presentation boundary so review severity
                    // and provenance are never collapsed into a group badge.
                    const aiMeter = meter.id === `${component.id}-m1`;
                    const MeterField = aiMeter ? AiMeterField : PlainMeterField;
                    return (
                      <div key={meter.id} className="grid gap-2 sm:grid-cols-5">
                        <MeterField componentId={component.id} field="name">
                          <Field label="Meter name">
                            <input
                              className={inputClass}
                              value={meter.name}
                              onChange={(e) =>
                                patchComponent(component.id, {
                                  meters: component.meters.map((m) =>
                                    m.id === meter.id ? { ...m, name: e.target.value } : m,
                                  ),
                                })
                              }
                            />
                          </Field>
                        </MeterField>
                        <MeterField componentId={component.id} field="rateAmountInput">
                          <Field label="Rate amount (USD)">
                            <input
                              className={inputClass}
                              inputMode="decimal"
                              value={meter.rateAmountInput}
                              onChange={(e) =>
                                patchComponent(component.id, {
                                  meters: component.meters.map((m) =>
                                    m.id === meter.id
                                      ? { ...m, rateAmountInput: e.target.value }
                                      : m,
                                  ),
                                })
                              }
                            />
                          </Field>
                        </MeterField>
                        <MeterField componentId={component.id} field="rateQuantityInput">
                          <Field label="Per quantity">
                            <input
                              className={inputClass}
                              inputMode="numeric"
                              value={meter.rateQuantityInput}
                              onChange={(e) =>
                                patchComponent(component.id, {
                                  meters: component.meters.map((m) =>
                                    m.id === meter.id
                                      ? { ...m, rateQuantityInput: e.target.value }
                                      : m,
                                  ),
                                })
                              }
                            />
                          </Field>
                        </MeterField>
                        <MeterField componentId={component.id} field="unit">
                          <Field label="Unit">
                            <input
                              className={inputClass}
                              value={meter.unit}
                              onChange={(e) =>
                                patchComponent(component.id, {
                                  meters: component.meters.map((m) =>
                                    m.id === meter.id ? { ...m, unit: e.target.value } : m,
                                  ),
                                })
                              }
                            />
                          </Field>
                        </MeterField>
                        <div className="flex items-end">
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() =>
                              patchComponent(component.id, {
                                meters: component.meters.filter((m) => m.id !== meter.id),
                              })
                            }
                          >
                            Remove meter
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() =>
                      patchComponent(component.id, {
                        meters: [
                          ...component.meters,
                          createVcMeterDraft(
                            component.meters.length + 1,
                            `${component.id}-m${component.meters.length + 1}-${Date.now()}`,
                          ),
                        ],
                      })
                    }
                  >
                    Add meter
                  </button>
                  <Notice>
                    Actual usage quantities are entered in Step 5, in the accounting month the usage
                    occurs.
                  </Notice>
                </div>
              )}
            </AiReviewTarget>
          ))}
        </div>
      ) : null}

      <Notice>
        Significant financing components, noncash consideration and consideration payable to a
        customer are not implemented. Contract modifications are entered under Additional topics.
      </Notice>
    </Section>
  );
}

const CONSTRAINT_LABELS: Record<string, string> = {
  fully_included: "Fully included — the constraint does not reduce the estimate",
  partially_included: "Partially included — the constraint reduces the estimate",
  excluded: "Excluded — the constraint removes the estimate entirely",
};

/** Read-only: every figure here is calculated by the engine, never by React. */
function MeasurementReadout({ component }: { component: VcComponentDraft }) {
  const measurement = previewVcMeasurement(component);
  if (measurement.unconstrainedCents === null) {
    return (
      <Notice>
        {measurement.issues.length > 0
          ? `The estimate at inception is not yet measurable: ${measurement.issues.join(" ")}`
          : "The estimate at inception is not yet measurable."}
      </Notice>
    );
  }
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <p>
        <span className="font-semibold">Engine estimate before the constraint: </span>
        {formatCents(measurement.unconstrainedCents)}
      </p>
      <p>
        <span className="font-semibold">Included after your constraint conclusion: </span>
        {formatCents(measurement.includedCents ?? 0)}
      </p>
      <p>
        <span className="font-semibold">Derived constraint conclusion: </span>
        {CONSTRAINT_LABELS[measurement.conclusion ?? ""] ?? measurement.conclusion}
      </p>
    </div>
  );
}
