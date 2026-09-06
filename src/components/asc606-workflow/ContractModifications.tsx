/**
 * Phase 5C contract-modification inputs.
 *
 * Every field here is an accountant judgment or fact. The modification
 * treatment is never selected: it is derived by the deterministic engine from
 * the ASC 606-10-25-12 criteria and the distinctness of the remaining goods
 * or services.
 */

import type { MixedAllocationPolicy } from "@/lib/asc606-contract-modifications";
import {
  createModificationDraft,
  createModifiedPoDraft,
  type Judgment,
  type ModifiedPoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, JudgmentControl, Notice, Section, inputClass } from "./fields";

export function ContractModifications({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const mod = draft.modification;

  const setMod = (patch: Partial<typeof mod>) =>
    onChange({ ...draft, modification: { ...mod, ...patch } });

  const setPo = (id: string, patch: Partial<ModifiedPoDraft>) =>
    setMod({
      modifiedPerformanceObligations: mod.modifiedPerformanceObligations.map((po) =>
        po.id === id ? { ...po, ...patch } : po,
      ),
    });

  const addPo = (status: ModifiedPoDraft["status"]) => {
    const seq = mod.modifiedPerformanceObligations.length + 1;
    setMod({
      modifiedPerformanceObligations: [
        ...mod.modifiedPerformanceObligations,
        createModifiedPoDraft(seq, `mod-po-${seq}-${Date.now()}`, status),
      ],
    });
  };

  return (
    <Section
      title="Contract modification"
      description="Record a change to the contract's scope, price, or both. The engine derives the ASC 606 modification treatment from your judgments and preserves revenue already recognized before the effective date."
    >
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <input
          type="checkbox"
          checked={draft.hasContractModification}
          onChange={(event) =>
            onChange({
              ...draft,
              hasContractModification: event.target.checked,
              modification: event.target.checked ? mod : createModificationDraft(),
            })
          }
        />
        This contract has been modified
      </label>

      {!draft.hasContractModification ? (
        <Notice>
          No modification recorded. The original contract analysis is presented unchanged.
        </Notice>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Modification effective date">
              <input
                type="date"
                className={inputClass}
                value={mod.effectiveDate}
                onChange={(e) => setMod({ effectiveDate: e.target.value })}
              />
            </Field>
            <Field
              label="Change in consideration (USD)"
              hint="Enter the amount as a positive number and choose the direction."
            >
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  value={mod.considerationChangeInput}
                  onChange={(e) => setMod({ considerationChangeInput: e.target.value })}
                  placeholder="0.00"
                />
                <select
                  className={inputClass}
                  value={mod.considerationChangeDirection}
                  onChange={(e) =>
                    setMod({
                      considerationChangeDirection: e.target.value as "increase" | "decrease",
                    })
                  }
                >
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                </select>
              </div>
            </Field>
          </div>

          <Field label="Description of the modification">
            <textarea
              className={inputClass}
              rows={2}
              value={mod.description}
              onChange={(e) => setMod({ description: e.target.value })}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <JudgmentControl
              name="mod-criterion-a"
              legend="Does the modification add distinct goods or services? (ASC 606-10-25-12(a))"
              value={mod.addsDistinctGoodsOrServices}
              onChange={(v: Judgment) => setMod({ addsDistinctGoodsOrServices: v })}
            />
            <JudgmentControl
              name="mod-criterion-b"
              legend="Does the price increase reflect the standalone selling prices of the added goods or services? (ASC 606-10-25-12(b))"
              value={mod.priceReflectsStandaloneSellingPrices}
              onChange={(v: Judgment) => setMod({ priceReflectsStandaloneSellingPrices: v })}
            />
          </div>

          <Field label="Rationale for the separate-contract conclusion">
            <textarea
              className={inputClass}
              rows={2}
              value={mod.separateContractRationale}
              onChange={(e) => setMod({ separateContractRationale: e.target.value })}
            />
          </Field>

          <Field
            label="Mixed-modification allocation policy"
            hint="Required only when some remaining goods or services are distinct and others are not."
          >
            <select
              className={inputClass}
              value={mod.mixedAllocationPolicy ?? ""}
              onChange={(e) =>
                setMod({
                  mixedAllocationPolicy:
                    e.target.value === "" ? null : (e.target.value as MixedAllocationPolicy),
                })
              }
            >
              <option value="">Not selected</option>
              <option value="total_transaction_price">
                Policy A — allocate the updated total transaction price
              </option>
              <option value="remaining_transaction_price">
                Policy B — allocate the remaining transaction price
              </option>
            </select>
          </Field>

          <Field label="Original performance obligations removed by the modification">
            <div className="space-y-1 text-sm">
              {draft.performanceObligations.map((po) => (
                <label key={po.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mod.removedPoIds.includes(po.id)}
                    onChange={(e) =>
                      setMod({
                        removedPoIds: e.target.checked
                          ? [...mod.removedPoIds, po.id]
                          : mod.removedPoIds.filter((id) => id !== po.id),
                      })
                    }
                  />
                  {po.name || po.id}
                </label>
              ))}
              {draft.performanceObligations.length === 0 ? (
                <p className="text-muted-foreground">No performance obligations entered yet.</p>
              ) : null}
            </div>
          </Field>

          <div className="space-y-4">
            <h3 className="text-base font-semibold text-foreground">
              Performance obligations after the modification
            </h3>
            {mod.modifiedPerformanceObligations.map((po) => (
              <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={po.name}
                      onChange={(e) => setPo(po.id, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Status">
                    <select
                      className={inputClass}
                      value={po.status}
                      onChange={(e) =>
                        setPo(po.id, { status: e.target.value as ModifiedPoDraft["status"] })
                      }
                    >
                      <option value="continuing">Continues an original obligation</option>
                      <option value="added">Added by the modification</option>
                    </select>
                  </Field>
                  {po.status === "continuing" ? (
                    <Field label="Original performance obligation continued">
                      <select
                        className={inputClass}
                        value={po.sourcePoId ?? ""}
                        onChange={(e) => setPo(po.id, { sourcePoId: e.target.value || null })}
                      >
                        <option value="">Select…</option>
                        {draft.performanceObligations.map((original) => (
                          <option key={original.id} value={original.id}>
                            {original.name || original.id}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <Field
                    label="Remaining standalone selling price (USD)"
                    hint="Standalone selling price of the goods or services still to be transferred."
                  >
                    <input
                      className={inputClass}
                      value={po.remainingSspInput}
                      onChange={(e) => setPo(po.id, { remainingSspInput: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Modified total standalone selling price (USD)"
                    hint="Standalone selling price of the full modified obligation."
                  >
                    <input
                      className={inputClass}
                      value={po.totalModifiedSspInput}
                      onChange={(e) => setPo(po.id, { totalModifiedSspInput: e.target.value })}
                    />
                  </Field>
                  <Field label="Standalone selling price basis">
                    <input
                      className={inputClass}
                      value={po.sspBasis}
                      onChange={(e) => setPo(po.id, { sspBasis: e.target.value })}
                    />
                  </Field>
                  <Field label="Recognition method">
                    <select
                      className={inputClass}
                      value={po.recognitionMethod ?? ""}
                      onChange={(e) =>
                        setPo(po.id, {
                          recognitionMethod:
                            e.target.value === ""
                              ? null
                              : (e.target.value as ModifiedPoDraft["recognitionMethod"]),
                        })
                      }
                    >
                      <option value="">Select…</option>
                      <option value="over_time_ratable">Over time — daily ratable</option>
                      <option value="point_in_time">Point in time</option>
                    </select>
                  </Field>
                  {po.recognitionMethod === "point_in_time" ? (
                    <Field label="Recognition date">
                      <input
                        type="date"
                        className={inputClass}
                        value={po.recognitionDate}
                        onChange={(e) => setPo(po.id, { recognitionDate: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <>
                      <Field label="Service start">
                        <input
                          type="date"
                          className={inputClass}
                          value={po.serviceStart}
                          onChange={(e) => setPo(po.id, { serviceStart: e.target.value })}
                        />
                      </Field>
                      <Field label="Service end">
                        <input
                          type="date"
                          className={inputClass}
                          value={po.serviceEnd}
                          onChange={(e) => setPo(po.id, { serviceEnd: e.target.value })}
                        />
                      </Field>
                    </>
                  )}
                </div>
                <JudgmentControl
                  name={`mod-distinct-${po.id}`}
                  legend="Are the remaining goods or services distinct from those already transferred?"
                  value={po.remainingGoodsDistinct}
                  onChange={(v: Judgment) => setPo(po.id, { remainingGoodsDistinct: v })}
                />
                <Field label="Distinctness rationale">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={po.distinctRationale}
                    onChange={(e) => setPo(po.id, { distinctRationale: e.target.value })}
                  />
                </Field>
                <Field label="Recognition rationale">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={po.recognitionRationale}
                    onChange={(e) => setPo(po.id, { recognitionRationale: e.target.value })}
                  />
                </Field>
                <button
                  type="button"
                  className="rounded-md border border-destructive/40 px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    setMod({
                      modifiedPerformanceObligations: mod.modifiedPerformanceObligations.filter(
                        (row) => row.id !== po.id,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
                onClick={() => addPo("continuing")}
              >
                Add continuing obligation
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
                onClick={() => addPo("added")}
              >
                Add new obligation
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
