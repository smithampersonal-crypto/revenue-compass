import { formatCents } from "@/lib/asc606";
import {
  variableConsiderationPreview,
  type VcComponentDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, IssueList, Notice, td, th } from "./fields";

const buttonClass =
  "rounded-md border border-border px-2 py-1 text-sm font-medium text-foreground hover:bg-accent";

/**
 * Step 5 variable-consideration controls: usage actuals and resolution are
 * accountant inputs; every amount displayed here is produced by the engine.
 */
export function Step5VariableConsideration({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const components = draft.variableConsiderationComponents;
  if (!draft.hasVariableConsideration || components.length === 0) return null;

  const preview = variableConsiderationPreview(draft);
  const analysis = preview.analysis;

  const patch = (id: string, values: Partial<VcComponentDraft>) =>
    onChange({
      ...draft,
      variableConsiderationComponents: components.map((c) =>
        c.id === id ? { ...c, ...values } : c,
      ),
    });

  return (
    <div className="space-y-4 rounded-md border border-border p-3">
      <p className="text-sm font-semibold">Variable consideration</p>

      <IssueList
        issues={preview.errors.map((message, index) => ({ id: `vc-${index}`, message }))}
        title="These variable-consideration inputs are not yet complete:"
        tone="warning"
      />

      {components.map((component) => {
        const result = analysis?.components.find((c) => c.componentId === component.id) ?? null;
        const periods = analysis?.usagePeriods.filter((p) => p.componentId === component.id) ?? [];
        const changes = analysis?.changeEvents.filter((e) => e.componentId === component.id) ?? [];

        return (
          <div key={component.id} className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-semibold">
              {component.description || `Variable component ${component.seq}`}
            </p>

            {component.treatment === "estimated" ? (
              <>
                {result ? (
                  <Notice>
                    <p>
                      <span className="font-semibold">Included at inception (engine): </span>
                      {formatCents(result.initialIncludedCents)}
                    </p>
                    <p>
                      <span className="font-semibold">Currently included (engine): </span>
                      {formatCents(result.currentIncludedCents)}
                    </p>
                  </Notice>
                ) : null}

                {result && result.assessments.length > 0 ? (
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">Assessment history</caption>
                    <thead>
                      <tr>
                        <th className={th}>Effective date</th>
                        <th className={th}>Unconstrained estimate</th>
                        <th className={th}>Included after constraint</th>
                        <th className={th}>Constraint conclusion</th>
                        <th className={th}>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.assessments.map((assessment) => (
                        <tr key={assessment.assessmentId}>
                          <td className={td}>
                            {assessment.effectiveDate}
                            {assessment.isResolution ? " (resolution)" : ""}
                          </td>
                          <td className={td}>{formatCents(assessment.unconstrainedCents)}</td>
                          <td className={td}>{formatCents(assessment.includedCents)}</td>
                          <td className={td}>{assessment.constraintConclusion.replace(/_/g, " ")}</td>
                          <td className={td}>{formatCents(assessment.changeCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {changes.length > 0 ? (
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">Revenue effect of each change</caption>
                    <thead>
                      <tr>
                        <th className={th}>Effective month</th>
                        <th className={th}>Transaction price change</th>
                        <th className={th}>Cumulative catch-up</th>
                        <th className={th}>Affects future periods</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((change) => (
                        <tr key={change.id}>
                          <td className={td}>{change.month}</td>
                          <td className={td}>{formatCents(change.transactionPriceChangeCents)}</td>
                          <td className={td}>{formatCents(change.catchUpCents)}</td>
                          <td className={td}>{formatCents(change.futureImpactCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={component.hasResolution}
                    onChange={(e) => patch(component.id, { hasResolution: e.target.checked })}
                  />
                  The uncertainty has been resolved
                </label>

                {component.hasResolution ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Resolution date">
                      <input
                        type="date"
                        className={inputClass}
                        value={component.resolutionDate}
                        onChange={(e) => patch(component.id, { resolutionDate: e.target.value })}
                      />
                    </Field>
                    <Field label="Actual amount (USD)">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        value={component.resolutionAmountInput}
                        onChange={(e) =>
                          patch(component.id, { resolutionAmountInput: e.target.value })
                        }
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Resolution rationale">
                        <textarea
                          className={inputClass}
                          rows={2}
                          value={component.resolutionRationale}
                          onChange={(e) =>
                            patch(component.id, { resolutionRationale: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter the actual measured usage for each accounting month. A blank quantity is
                  treated as missing, never as zero; enter 0 when usage was genuinely zero.
                </p>

                {component.usagePeriods.map((period) => (
                  <div key={period.id} className="grid gap-2 sm:grid-cols-4">
                    <Field label="Accounting month">
                      <input
                        type="month"
                        className={inputClass}
                        value={period.month}
                        onChange={(e) =>
                          patch(component.id, {
                            usagePeriods: component.usagePeriods.map((p) =>
                              p.id === period.id ? { ...p, month: e.target.value } : p,
                            ),
                          })
                        }
                      />
                    </Field>
                    {component.meters.map((meter) => (
                      <Field key={meter.id} label={`${meter.name || meter.id} (${meter.unit})`}>
                        <input
                          className={inputClass}
                          inputMode="numeric"
                          value={period.quantities[meter.id] ?? ""}
                          onChange={(e) =>
                            patch(component.id, {
                              usagePeriods: component.usagePeriods.map((p) =>
                                p.id === period.id
                                  ? {
                                      ...p,
                                      quantities: { ...p.quantities, [meter.id]: e.target.value },
                                    }
                                  : p,
                              ),
                            })
                          }
                        />
                      </Field>
                    ))}
                    <div className="flex items-end">
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() =>
                          patch(component.id, {
                            usagePeriods: component.usagePeriods.filter((p) => p.id !== period.id),
                          })
                        }
                      >
                        Remove month
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className={buttonClass}
                  onClick={() =>
                    patch(component.id, {
                      usagePeriods: [
                        ...component.usagePeriods,
                        {
                          id: `${component.id}-p${component.usagePeriods.length + 1}-${Date.now()}`,
                          month: "",
                          quantities: {},
                        },
                      ],
                    })
                  }
                >
                  Add usage month
                </button>

                {periods.length > 0 ? (
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">Usage consideration by month</caption>
                    <thead>
                      <tr>
                        <th className={th}>Month</th>
                        {component.meters.map((meter) => (
                          <th key={meter.id} className={th}>
                            {meter.name || meter.id}
                          </th>
                        ))}
                        <th className={th}>Usage consideration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((period) => (
                        <tr key={period.month}>
                          <td className={td}>{period.month}</td>
                          {component.meters.map((meter) => {
                            const row = period.meters.find((m) => m.meterId === meter.id);
                            return (
                              <td key={meter.id} className={td}>
                                {row ? formatCents(row.amountCents) : "—"}
                              </td>
                            );
                          })}
                          <td className={td}>{formatCents(period.totalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
