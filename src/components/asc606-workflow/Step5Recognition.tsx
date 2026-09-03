import type { RecognitionMethod } from "@/lib/asc606";
import type { PoDraft, WorkflowDraft } from "@/lib/asc606-workflow";

import { Field, inputClass, Notice, Section } from "./fields";

export function Step5Recognition({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const pos = draft.performanceObligations;
  const patch = (id: string, values: Partial<PoDraft>) =>
    onChange({
      ...draft,
      performanceObligations: pos.map((po) => (po.id === id ? { ...po, ...values } : po)),
    });

  return (
    <Section
      title="Step 5 — Determine Revenue Recognition"
      description="Select the recognition method and supporting dates for each performance obligation. Revenue amounts are produced by the deterministic engine."
    >
      <div className="space-y-4">
        {pos.length === 0 ? <Notice>Create performance obligations in Step 2B first.</Notice> : null}
        {pos.map((po) => (
          <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-semibold">{po.name || `Performance obligation ${po.seq}`}</p>
            <Field label="Recognition method">
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
                <option value="over_time_ratable">Over time — daily ratable</option>
                <option value="point_in_time">Point in time</option>
              </select>
            </Field>

            {po.recognitionMethod === "over_time_ratable" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Service start date (inclusive)">
                  <input
                    type="date"
                    className={inputClass}
                    value={po.serviceStart}
                    onChange={(e) => patch(po.id, { serviceStart: e.target.value })}
                  />
                </Field>
                <Field label="Service end date (inclusive)">
                  <input
                    type="date"
                    className={inputClass}
                    value={po.serviceEnd}
                    onChange={(e) => patch(po.id, { serviceEnd: e.target.value })}
                  />
                </Field>
              </div>
            ) : null}

            {po.recognitionMethod === "point_in_time" ? (
              <Field label="Recognition date">
                <input
                  type="date"
                  className={inputClass}
                  value={po.recognitionDate}
                  onChange={(e) => patch(po.id, { recognitionDate: e.target.value })}
                />
              </Field>
            ) : null}

            <Field label="Recognition rationale">
              <textarea
                className={inputClass}
                rows={2}
                value={po.recognitionRationale}
                onChange={(e) => patch(po.id, { recognitionRationale: e.target.value })}
              />
            </Field>
          </div>
        ))}

        <Notice>
          Phase 2 supports daily-ratable over-time recognition and point-in-time recognition only.
          Other measures of progress are not implemented.
        </Notice>
      </div>
    </Section>
  );
}
