import {
  deriveStep1Conclusion,
  STEP1_CRITERIA,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, JudgmentControl, Notice, Section } from "./fields";

export function Step1Contract({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const contract = draft.contract;
  const conclusion = deriveStep1Conclusion(contract);
  const set = (patch: Partial<typeof contract>) =>
    onChange({ ...draft, contract: { ...contract, ...patch } });

  return (
    <div className="space-y-6">
      <Section title="Step 1 — Identify the Contract" description="Basic contract facts.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name">
            <input
              className={inputClass}
              value={contract.customerName}
              onChange={(e) => set({ customerName: e.target.value })}
            />
          </Field>
          <Field label="Contract number / reference">
            <input
              className={inputClass}
              value={contract.contractNumber}
              onChange={(e) => set({ contractNumber: e.target.value })}
            />
          </Field>
          <Field label="Contract execution / effective date (optional)">
            <input
              type="date"
              className={inputClass}
              value={contract.executionDate}
              onChange={(e) => set({ executionDate: e.target.value })}
            />
          </Field>
          <Field label="Currency" hint="Phase 2 supports USD only.">
            <input className={inputClass} value="USD" readOnly disabled />
          </Field>
        </div>
      </Section>

      <Section
        title="ASC 606 contract criteria"
        description="Answer each criterion and document your rationale. The conclusion below is derived and cannot be overridden."
      >
        <div className="space-y-5">
          {STEP1_CRITERIA.map((criterion) => {
            const answer = contract.criteria[criterion.id];
            return (
              <div key={criterion.id} className="space-y-2 border-b border-border pb-4 last:border-0">
                <p className="text-sm text-muted-foreground">{criterion.description}</p>
                <JudgmentControl
                  name={`criterion-${criterion.id}`}
                  legend={criterion.label}
                  value={answer.answer}
                  onChange={(value) =>
                    set({
                      criteria: {
                        ...contract.criteria,
                        [criterion.id]: { ...answer, answer: value },
                      },
                    })
                  }
                />
                <Field label="Rationale / comment">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={answer.rationale}
                    onChange={(e) =>
                      set({
                        criteria: {
                          ...contract.criteria,
                          [criterion.id]: { ...answer, rationale: e.target.value },
                        },
                      })
                    }
                  />
                </Field>
              </div>
            );
          })}
        </div>

        <Notice tone={conclusion === "qualified" ? "muted" : "danger"}>
          <p className="font-semibold">Derived conclusion (not editable)</p>
          <p>
            {conclusion === "qualified"
              ? "Qualifies as a contract under ASC 606."
              : conclusion === "not_qualified"
                ? "Does not currently qualify for a finalized ASC 606 analysis. Later steps may still be documented, but no finalized allocation or revenue schedule will be produced."
                : "Incomplete — one or more criteria remain unanswered."}
          </p>
        </Notice>
      </Section>
    </div>
  );
}
