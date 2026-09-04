import { formatCents, type RecognitionMethod } from "@/lib/asc606";
import type { MaterialRightStatus } from "@/lib/asc606-material-rights";
import {
  materialRightStepPreviews,
  MATERIAL_RIGHT_STATUS_LABELS,
  type PoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, Notice, Section } from "./fields";

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
  const money = (cents: number | null) => (cents === null ? "Not yet determinable" : formatCents(cents));
  const patch = (id: string, values: Partial<PoDraft>) =>
    onChange({
      ...draft,
      performanceObligations: pos.map((po) => (po.id === id ? { ...po, ...values } : po)),
    });

  const recognitionFields = (po: PoDraft, label: string) => (
    <>
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
    </>
  );

  return (
    <Section
      title="Step 5 — Determine Revenue Recognition"
      description="Select the recognition method and supporting dates for each performance obligation. Revenue amounts are produced by the deterministic engine."
    >
      <div className="space-y-4">
        {pos.length === 0 ? <Notice>Create performance obligations in Step 2B first.</Notice> : null}
        {pos.map((po) => (
          <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-semibold">
              {po.name || `Performance obligation ${po.seq}`}
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
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          value={po.exerciseConsiderationInput}
                          onChange={(e) =>
                            patch(po.id, { exerciseConsiderationInput: e.target.value })
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

        <Notice>
          Daily-ratable over-time recognition and point-in-time recognition are supported. Other
          measures of progress are not implemented.
        </Notice>
      </div>
    </Section>
  );
}
