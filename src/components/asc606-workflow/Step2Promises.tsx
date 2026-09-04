import {
  createPromiseDraft,
  derivePromiseDistinct,
  nextId,
  nextSeq,
  type PromiseDraft,
  type PromiseKind,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, JudgmentControl, Notice, Section } from "./fields";

export function Step2Promises({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const setPromises = (promises: PromiseDraft[]) => onChange({ ...draft, promises });
  const patch = (id: string, values: Partial<PromiseDraft>) =>
    setPromises(draft.promises.map((p) => (p.id === id ? { ...p, ...values } : p)));

  return (
    <Section
      title="Step 2A — Identify and Assess Promises"
      description="List every promised good or service and record your distinctness judgments. Customer options are recorded here too: for an option you conclude whether it conveys a material right instead of answering the distinctness judgments. The distinct conclusion is derived from your two answers and cannot be edited directly."
    >
      <div className="space-y-5">
        {draft.promises.length === 0 ? (
          <Notice>No promises have been identified yet.</Notice>
        ) : null}

        {draft.promises.map((promise) => {
          const distinct = derivePromiseDistinct(promise);
          return (
            <div key={promise.id} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">Promise {promise.seq}</span>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                  onClick={() => setPromises(draft.promises.filter((p) => p.id !== promise.id))}
                >
                  Remove
                </button>
              </div>
              <Field label="Type of promise">
                <select
                  className={inputClass}
                  value={promise.kind}
                  onChange={(e) => patch(promise.id, { kind: e.target.value as PromiseKind })}
                >
                  <option value="good_or_service">Promised good or service</option>
                  <option value="customer_option">
                    Customer option (renewal, upgrade, additional goods)
                  </option>
                </select>
              </Field>
              <Field label="Description of the promised good or service">
                <input
                  className={inputClass}
                  value={promise.description}
                  onChange={(e) => patch(promise.id, { description: e.target.value })}
                />
              </Field>
              {promise.kind === "customer_option" ? (
                <div className="space-y-3">
                  <JudgmentControl
                    name={`material-right-${promise.id}`}
                    legend="Does the option convey a material right to the customer?"
                    value={promise.conveysMaterialRight}
                    onChange={(value) => patch(promise.id, { conveysMaterialRight: value })}
                  />
                  <Field label="Material-right rationale">
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={promise.materialRightRationale}
                      onChange={(e) =>
                        patch(promise.id, { materialRightRationale: e.target.value })
                      }
                    />
                  </Field>
                  <Notice>
                    An option that conveys a material right is a separate performance obligation.
                    Create it in Step 2B as a material right and assign this promise to it.
                  </Notice>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <JudgmentControl
                    name={`capable-${promise.id}`}
                    legend="Capable of being distinct?"
                    value={promise.capableOfBeingDistinct}
                    onChange={(value) => patch(promise.id, { capableOfBeingDistinct: value })}
                  />
                  <JudgmentControl
                    name={`context-${promise.id}`}
                    legend="Distinct within the context of the contract?"
                    value={promise.distinctWithinContractContext}
                    onChange={(value) =>
                      patch(promise.id, { distinctWithinContractContext: value })
                    }
                  />
                </div>
              )}
              {promise.kind === "customer_option" ? null : (
                <Field label="Distinctness rationale">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={promise.distinctRationale}
                    onChange={(e) => patch(promise.id, { distinctRationale: e.target.value })}
                  />
                </Field>
              )}
              {promise.kind === "customer_option" ? null : (
                <p className="text-sm">
                  <span className="font-semibold">Derived conclusion: </span>
                  {distinct === null ? "Incomplete" : distinct ? "Distinct" : "Not distinct"}
                </p>
              )}
            </div>
          );
        })}

        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
          onClick={() =>
            setPromises([
              ...draft.promises,
              createPromiseDraft(nextSeq(draft.promises), nextId("promise", draft.promises)),
            ])
          }
        >
          Add promise
        </button>
      </div>
    </Section>
  );
}
