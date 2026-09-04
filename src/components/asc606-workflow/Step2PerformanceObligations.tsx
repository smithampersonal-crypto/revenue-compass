import type { PoClassification } from "@/lib/asc606";
import {
  createMaterialRightPoDraft,
  createPoDraft,
  derivePromiseDistinct,
  nextId,
  nextSeq,
  PO_CLASSIFICATION_LABELS,
  validateWorkflow,
  type PerformanceObligationKind,
  type PoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, IssueList, Notice, Section } from "./fields";

const CLASSIFICATIONS: PoClassification[] = ["single_distinct", "bundle_not_distinct", "series"];

export function Step2PerformanceObligations({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const pos = draft.performanceObligations;
  const setPos = (performanceObligations: PoDraft[]) =>
    onChange({ ...draft, performanceObligations });
  const patch = (id: string, values: Partial<PoDraft>) =>
    setPos(pos.map((po) => (po.id === id ? { ...po, ...values } : po)));

  const removePo = (id: string) =>
    onChange({
      ...draft,
      performanceObligations: pos.filter((po) => po.id !== id),
      promises: draft.promises.map((p) =>
        p.performanceObligationId === id ? { ...p, performanceObligationId: null } : p,
      ),
    });

  // Warnings are produced by the pure workflow validation layer; React only
  // displays them at the point where the judgment is made.
  const warnings = validateWorkflow(draft).warningsByStep["2b"];

  return (
    <Section
      title="Step 2B — Form Performance Obligations"
      description="Group promises into performance obligations. Each promise belongs to exactly one performance obligation. A customer option that conveys a material right is created here as a material-right performance obligation."
    >
      <div className="space-y-5">
        {pos.length === 0 ? (
          <Notice>No performance obligations have been created yet.</Notice>
        ) : null}

        <IssueList
          tone="warning"
          title="Classification warnings (non-blocking)"
          issues={warnings}
        />

        {pos.map((po) => (
          <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">Performance obligation {po.seq}</span>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                onClick={() => removePo(po.id)}
              >
                Remove
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Obligation type">
                <select
                  className={inputClass}
                  value={po.kind}
                  onChange={(e) =>
                    patch(po.id, { kind: e.target.value as PerformanceObligationKind })
                  }
                >
                  <option value="standard">Standard performance obligation</option>
                  <option value="material_right">Material right (customer option)</option>
                </select>
              </Field>
              <Field label="Name">
                <input
                  className={inputClass}
                  value={po.name}
                  onChange={(e) => patch(po.id, { name: e.target.value })}
                />
              </Field>
              {po.kind === "material_right" ? (
                <Field
                  label="Underlying good or service obtained on exercise"
                  hint="Named here so the lifecycle schedule can label the exercise segment."
                >
                  <input
                    className={inputClass}
                    value={po.underlyingGoodOrServiceName}
                    onChange={(e) => patch(po.id, { underlyingGoodOrServiceName: e.target.value })}
                  />
                </Field>
              ) : (
                <Field label="Classification">
                  <select
                    className={inputClass}
                    value={po.classification ?? ""}
                    onChange={(e) =>
                      patch(po.id, {
                        classification: (e.target.value || null) as PoClassification | null,
                      })
                    }
                  >
                    <option value="">Select a classification…</option>
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>
                        {PO_CLASSIFICATION_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            {po.kind === "material_right" ? (
              <Notice>
                A material right is measured from your economic-benefit and exercise-probability
                judgments in Step 4; it is not classified as a distinct promise or a bundle.
              </Notice>
            ) : (
              <Field label="Classification rationale">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={po.classificationRationale}
                  onChange={(e) => patch(po.id, { classificationRationale: e.target.value })}
                />
              </Field>
            )}
          </div>
        ))}

        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
          onClick={() => setPos([...pos, createPoDraft(nextSeq(pos), nextId("po", pos))])}
        >
          Add performance obligation
        </button>
        <button
          type="button"
          className="ml-2 rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
          onClick={() =>
            setPos([...pos, createMaterialRightPoDraft(nextSeq(pos), nextId("po", pos))])
          }
        >
          Add material right
        </button>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Assign promises</h3>
          {draft.promises.length === 0 ? (
            <Notice>Identify promises in Step 2A first.</Notice>
          ) : (
            draft.promises.map((promise) => {
              const distinct = derivePromiseDistinct(promise);
              return (
                <div key={promise.id} className="grid gap-2 sm:grid-cols-2 sm:items-center">
                  <div className="text-sm">
                    <span className="font-medium">
                      {promise.description || `Promise ${promise.seq}`}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      —{" "}
                      {promise.kind === "customer_option"
                        ? promise.conveysMaterialRight === null
                          ? "Customer option — material-right conclusion incomplete"
                          : promise.conveysMaterialRight
                            ? "Customer option — conveys a material right"
                            : "Customer option — no material right"
                        : distinct === null
                          ? "Incomplete"
                          : distinct
                            ? "Distinct"
                            : "Not distinct"}
                    </span>
                  </div>
                  <select
                    aria-label={`Performance obligation for ${promise.description || promise.id}`}
                    className={inputClass}
                    value={promise.performanceObligationId ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        promises: draft.promises.map((p) =>
                          p.id === promise.id
                            ? { ...p, performanceObligationId: e.target.value || null }
                            : p,
                        ),
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {pos.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.name || `Performance obligation ${po.seq}`}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Section>
  );
}
