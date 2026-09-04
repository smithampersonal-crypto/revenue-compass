import { formatCents } from "@/lib/asc606";
import { formatBasisPoints, materialRightSspCents } from "@/lib/asc606-material-rights";
import {
  parsePercentToBps,
  parseUsdToCents,
  previewAllocation,
  type PoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, IssueList, Notice, Section, td, th } from "./fields";

/** Display-only helper: the estimated SSP is calculated by the engine. */
function estimatedMaterialRightSsp(po: PoDraft): string {
  const benefit = parseUsdToCents(po.benefitAmountInput);
  const probability = parsePercentToBps(po.exerciseProbabilityInput);
  if (!benefit.ok || !probability.ok) return "Not yet measurable";
  return `${formatCents(benefit.cents)} × ${formatBasisPoints(probability.bps)} = ${formatCents(
    materialRightSspCents(benefit.cents, probability.bps),
  )}`;
}

export function Step4Allocation({
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

  const preview = previewAllocation(draft);

  return (
    <Section
      title="Step 4 — Allocate the Transaction Price"
      description="Enter the standalone selling price and its basis for each performance obligation. Allocation is produced by the deterministic engine and is never editable."
    >
      <div className="space-y-4">
        {pos.length === 0 ? <Notice>Create performance obligations in Step 2B first.</Notice> : null}
        {pos.map((po) => (
          <div key={po.id} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <Field label={`SSP (USD) — ${po.name || `PO ${po.seq}`}`}>
              <input
                className={inputClass}
                inputMode="decimal"
                value={po.sspInput}
                onChange={(e) => patch(po.id, { sspInput: e.target.value })}
              />
            </Field>
            <Field label="SSP basis / documentation">
              <textarea
                className={inputClass}
                rows={2}
                value={po.sspBasis}
                onChange={(e) => patch(po.id, { sspBasis: e.target.value })}
              />
            </Field>
          </div>
        ))}

        <h3 className="text-sm font-semibold">Engine allocation (read-only)</h3>
        {preview.rows ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Performance obligation</th>
                <th className={th}>SSP</th>
                <th className={th}>Relative SSP %</th>
                <th className={th}>Allocated transaction price</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.poId}>
                  <td className={td}>{row.name}</td>
                  <td className={td}>{formatCents(row.sspCents)}</td>
                  <td className={td}>{row.relativeSspPercent.toFixed(4)}%</td>
                  <td className={td}>{formatCents(row.allocatedCents)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total</td>
                <td className={td}>{formatCents(preview.totalSspCents ?? 0)}</td>
                <td className={td}>100.0000%</td>
                <td className={td}>{formatCents(preview.totalAllocatedCents ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <IssueList
            title="Allocation is not available yet"
            issues={preview.issues.map((message, index) => ({ id: String(index), message }))}
          />
        )}

        <Notice>
          Phase 2 supports the relative standalone-selling-price allocation methodology only.
          Variable-consideration allocation exceptions, discount allocation exceptions, residual SSP
          methods and material-right option valuation are not supported.
        </Notice>
      </div>
    </Section>
  );
}
