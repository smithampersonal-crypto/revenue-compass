/**
 * Phase 5C contract-modification inputs.
 *
 * Every field here is an accountant judgment or fact. The modification
 * treatment is never selected: it is derived by the deterministic engine from
 * the ASC 606-10-25-12 criteria, the scope effect on each continuing
 * obligation and the distinctness of the remaining goods or services.
 *
 * Disabling the feature preserves what has been captured; nothing is discarded
 * until the accountant explicitly removes it.
 */

import type {
  ConsiderationEffect,
  MixedAllocationPolicy,
  ScopeEffect,
} from "@/lib/asc606-contract-modifications";
import {
  createModificationDraft,
  nextModificationId,
  createModifiedPoDraft,
  nextModifiedPoId,
  type Judgment,
  type ModificationDraft,
  type ModifiedPoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, JudgmentControl, Notice, Section, inputClass } from "./fields";

const SCOPE_EFFECTS: { value: ScopeEffect; label: string }[] = [
  { value: "unchanged", label: "Unchanged — same goods or services at the same price" },
  { value: "increase", label: "Increased scope of this obligation" },
  { value: "decrease", label: "Reduced scope of this obligation" },
  { value: "reconfigured", label: "Reconfigured or repriced" },
];

export function ContractModifications({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const modifications = draft.contractModifications;

  const setMod = (id: string, patch: Partial<ModificationDraft>) =>
    onChange({
      ...draft,
      contractModifications: modifications.map((mod) =>
        mod.id === id ? { ...mod, ...patch } : mod,
      ),
    });

  const setPo = (modId: string, poId: string, patch: Partial<ModifiedPoDraft>) => {
    const mod = modifications.find((m) => m.id === modId);
    if (!mod) return;
    setMod(modId, {
      modifiedPerformanceObligations: mod.modifiedPerformanceObligations.map((po) =>
        po.id === poId ? { ...po, ...patch } : po,
      ),
    });
  };

  const addPo = (mod: ModificationDraft, status: ModifiedPoDraft["status"]) => {
    const seq = mod.modifiedPerformanceObligations.length + 1;
    setMod(mod.id, {
      modifiedPerformanceObligations: [
        ...mod.modifiedPerformanceObligations,
        createModifiedPoDraft(seq, nextModifiedPoId(mod), status),
      ],
    });
  };

  const addModification = () => {
    const { id, seq } = nextModificationId(modifications);
    onChange({
      ...draft,
      hasContractModifications: true,
      contractModifications: [...modifications, { ...createModificationDraft(seq), id }],
    });
  };

  // Entered work is only destroyed through the application's confirmation
  // pattern, the same one used by Reset analysis.
  const removeModification = (modId: string) => {
    if (
      !window.confirm(
        "Remove this modification? Every judgment, amount and rationale entered for it will be discarded.",
      )
    ) {
      return;
    }
    onChange({
      ...draft,
      contractModifications: modifications.filter((row) => row.id !== modId),
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
          checked={draft.hasContractModifications}
          onChange={(event) =>
            onChange({
              ...draft,
              hasContractModifications: event.target.checked,
              // Data entered is never discarded when the feature is switched
              // off; the accountant removes a modification explicitly.
              contractModifications:
                event.target.checked && modifications.length === 0
                  ? [createModificationDraft(1)]
                  : modifications,
            })
          }
        />
        This contract has been modified
      </label>

      {!draft.hasContractModifications ? (
        <Notice>
          No modification is being accounted for. The original contract analysis is presented
          unchanged
          {modifications.length > 0 ? ", and the modification details you entered are kept" : ""}.
        </Notice>
      ) : (
        <div className="space-y-8">
          {modifications.length > 1 ? (
            <Notice>
              This version calculates a single contract modification. Remove the additional
              modifications to produce a complete draft analysis.
            </Notice>
          ) : null}

          {modifications.map((mod) => (
            <div key={mod.id} className="space-y-6 rounded-md border border-border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">Modification {mod.seq}</h3>
                <button
                  type="button"
                  className="rounded-md border border-destructive/40 px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                  onClick={() => removeModification(mod.id)}
                >
                  Remove modification
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Modification effective date">
                  <input
                    type="date"
                    className={inputClass}
                    value={mod.modificationDate}
                    onChange={(e) => setMod(mod.id, { modificationDate: e.target.value })}
                  />
                </Field>
                <Field
                  label="Change in consideration (USD)"
                  hint="Enter the amount as a positive number and choose the direction."
                >
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      value={mod.considerationMagnitudeInput}
                      onChange={(e) =>
                        setMod(mod.id, { considerationMagnitudeInput: e.target.value })
                      }
                      placeholder="0.00"
                    />
                    <select
                      className={inputClass}
                      value={mod.considerationEffect}
                      onChange={(e) =>
                        setMod(mod.id, {
                          considerationEffect: e.target.value as ConsiderationEffect,
                        })
                      }
                    >
                      <option value="increase">Increase</option>
                      <option value="decrease">Decrease</option>
                      <option value="none">No change in price</option>
                    </select>
                  </div>
                </Field>
              </div>

              <JudgmentControl
                name={`mod-approved-${mod.id}`}
                legend="Has the modification been approved and does it create enforceable rights and obligations? (ASC 606-10-25-10)"
                value={mod.approvedAndEnforceable}
                onChange={(v: Judgment) => setMod(mod.id, { approvedAndEnforceable: v })}
              />
              <Field label="Approval and enforceability rationale">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={mod.approvalRationale}
                  onChange={(e) => setMod(mod.id, { approvalRationale: e.target.value })}
                />
              </Field>

              <Field label="Description of the change in scope, price, or both">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={mod.scopeChangeDescription}
                  onChange={(e) => setMod(mod.id, { scopeChangeDescription: e.target.value })}
                />
              </Field>

              <JudgmentControl
                name={`mod-criterion-b-${mod.id}`}
                legend="Does the change in price reflect the standalone selling prices of the added goods or services? (ASC 606-10-25-12(b))"
                value={mod.priceReflectsAddedGoodsSsp}
                onChange={(v: Judgment) => setMod(mod.id, { priceReflectsAddedGoodsSsp: v })}
              />
              <Field label="Rationale for the standalone-selling-price conclusion">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={mod.priceReflectsSspRationale}
                  onChange={(e) => setMod(mod.id, { priceReflectsSspRationale: e.target.value })}
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Mixed-modification allocation policy"
                  hint="Required only when some remaining goods or services are distinct and others are not."
                >
                  <select
                    className={inputClass}
                    value={mod.mixedAllocationPolicy ?? ""}
                    onChange={(e) =>
                      setMod(mod.id, {
                        mixedAllocationPolicy:
                          e.target.value === "" ? null : (e.target.value as MixedAllocationPolicy),
                      })
                    }
                  >
                    <option value="">Not selected</option>
                    <option value="updated_total_transaction_price">
                      Allocate the updated TOTAL transaction price
                    </option>
                    <option value="updated_remaining_transaction_price">
                      Allocate the updated REMAINING transaction price
                    </option>
                  </select>
                </Field>
                <Field label="Allocation policy rationale">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={mod.mixedAllocationPolicyRationale}
                    onChange={(e) =>
                      setMod(mod.id, { mixedAllocationPolicyRationale: e.target.value })
                    }
                  />
                </Field>
              </div>

              <Field label="Original performance obligations removed by the modification">
                <div className="space-y-1 text-sm">
                  {draft.performanceObligations.map((po) => (
                    <label key={po.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mod.removedPoIds.includes(po.id)}
                        onChange={(e) =>
                          setMod(mod.id, {
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
                <h4 className="text-sm font-semibold text-foreground">
                  Performance obligations after the modification
                </h4>
                {mod.modifiedPerformanceObligations.map((po) => (
                  <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Name">
                        <input
                          className={inputClass}
                          value={po.name}
                          onChange={(e) => setPo(mod.id, po.id, { name: e.target.value })}
                        />
                      </Field>
                      <Field label="Status">
                        <select
                          className={inputClass}
                          value={po.status}
                          onChange={(e) =>
                            setPo(mod.id, po.id, {
                              status: e.target.value as ModifiedPoDraft["status"],
                            })
                          }
                        >
                          <option value="continuing">Continues an original obligation</option>
                          <option value="added">Added by the modification</option>
                        </select>
                      </Field>
                      {po.status === "continuing" ? (
                        <>
                          <Field label="Original performance obligation continued">
                            <select
                              className={inputClass}
                              value={po.sourcePoId ?? ""}
                              onChange={(e) =>
                                setPo(mod.id, po.id, { sourcePoId: e.target.value || null })
                              }
                            >
                              <option value="">Select…</option>
                              {draft.performanceObligations.map((original) => (
                                <option key={original.id} value={original.id}>
                                  {original.name || original.id}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field
                            label="Effect of the modification on this obligation"
                            hint="A repriced or reconfigured obligation cannot be part of a separate contract."
                          >
                            <select
                              className={inputClass}
                              value={po.scopeEffect ?? ""}
                              onChange={(e) =>
                                setPo(mod.id, po.id, {
                                  scopeEffect:
                                    e.target.value === "" ? null : (e.target.value as ScopeEffect),
                                })
                              }
                            >
                              <option value="">Select…</option>
                              {SCOPE_EFFECTS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </>
                      ) : null}
                      <Field
                        label="Remaining standalone selling price (USD)"
                        hint="Standalone selling price of the goods or services still to be transferred."
                      >
                        <input
                          className={inputClass}
                          value={po.remainingSspInput}
                          onChange={(e) =>
                            setPo(mod.id, po.id, { remainingSspInput: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Basis for the remaining standalone selling price">
                        <input
                          className={inputClass}
                          value={po.remainingSspBasis}
                          onChange={(e) =>
                            setPo(mod.id, po.id, { remainingSspBasis: e.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="Modified total standalone selling price (USD)"
                        hint="Standalone selling price of the full modified obligation."
                      >
                        <input
                          className={inputClass}
                          value={po.totalModifiedSspInput}
                          onChange={(e) =>
                            setPo(mod.id, po.id, { totalModifiedSspInput: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Basis for the modified standalone selling price">
                        <input
                          className={inputClass}
                          value={po.totalModifiedSspBasis}
                          onChange={(e) =>
                            setPo(mod.id, po.id, { totalModifiedSspBasis: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Recognition method">
                        <select
                          className={inputClass}
                          value={po.recognitionMethod ?? ""}
                          onChange={(e) =>
                            setPo(mod.id, po.id, {
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
                            onChange={(e) =>
                              setPo(mod.id, po.id, { recognitionDate: e.target.value })
                            }
                          />
                        </Field>
                      ) : (
                        <>
                          <Field label="Service start">
                            <input
                              type="date"
                              className={inputClass}
                              value={po.serviceStart}
                              onChange={(e) =>
                                setPo(mod.id, po.id, { serviceStart: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Service end">
                            <input
                              type="date"
                              className={inputClass}
                              value={po.serviceEnd}
                              onChange={(e) => setPo(mod.id, po.id, { serviceEnd: e.target.value })}
                            />
                          </Field>
                        </>
                      )}
                    </div>

                    {po.status === "added" ? (
                      <>
                        <JudgmentControl
                          name={`mod-added-distinct-${po.id}`}
                          legend="Are the goods or services added by this obligation distinct? (ASC 606-10-25-12(a))"
                          value={po.addedGoodsAreDistinct}
                          onChange={(v: Judgment) =>
                            setPo(mod.id, po.id, { addedGoodsAreDistinct: v })
                          }
                        />
                        <Field label="Added-goods distinctness rationale">
                          <textarea
                            className={inputClass}
                            rows={2}
                            value={po.addedGoodsDistinctnessRationale}
                            onChange={(e) =>
                              setPo(mod.id, po.id, {
                                addedGoodsDistinctnessRationale: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </>
                    ) : null}

                    <JudgmentControl
                      name={`mod-distinct-${po.id}`}
                      legend="Are the remaining goods or services distinct from those already transferred? (ASC 606-10-25-13)"
                      value={po.remainingGoodsDistinctFromTransferred}
                      onChange={(v: Judgment) =>
                        setPo(mod.id, po.id, { remainingGoodsDistinctFromTransferred: v })
                      }
                    />
                    <Field label="Remaining-goods distinctness rationale">
                      <textarea
                        className={inputClass}
                        rows={2}
                        value={po.remainingDistinctnessRationale}
                        onChange={(e) =>
                          setPo(mod.id, po.id, { remainingDistinctnessRationale: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Recognition rationale">
                      <textarea
                        className={inputClass}
                        rows={2}
                        value={po.recognitionRationale}
                        onChange={(e) =>
                          setPo(mod.id, po.id, { recognitionRationale: e.target.value })
                        }
                      />
                    </Field>
                    <button
                      type="button"
                      className="rounded-md border border-destructive/40 px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                      onClick={() =>
                        setMod(mod.id, {
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
                    onClick={() => addPo(mod, "continuing")}
                  >
                    Add continuing obligation
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
                    onClick={() => addPo(mod, "added")}
                  >
                    Add new obligation
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
            onClick={addModification}
          >
            Add another modification
          </button>
        </div>
      )}
    </Section>
  );
}
