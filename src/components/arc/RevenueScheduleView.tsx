import { formatCents } from "@/lib/asc606";
import type { WorkflowAnalysisResult, WorkflowDraft } from "@/lib/asc606-workflow";

import { MaterialRightLifecycleOutputs } from "@/components/asc606-workflow/MaterialRightLifecycleOutputs";
import { Notice, Section, td, th } from "@/components/asc606-workflow/fields";
import { VariableConsiderationOutputs } from "@/components/asc606-workflow/VariableConsiderationOutputs";

/**
 * Revenue Schedule parent area.
 *
 * Renders the authoritative `result.revenueSchedule` using the engine-supplied
 * `result.revenueSources` identities, plus the supporting engine output that
 * directly explains that schedule (variable consideration and material-right
 * lifecycle). No amount is derived in React.
 */
export function RevenueScheduleView({
  draft,
  result,
}: {
  draft: WorkflowDraft;
  result: WorkflowAnalysisResult;
}) {
  const { revenueSchedule } = result;
  const columns =
    result.revenueSources.length > 0
      ? result.revenueSources.map((source) => ({ id: source.id, name: source.name }))
      : draft.performanceObligations.map((po) => ({ id: po.id, name: po.name || po.id }));

  return (
    <div className="space-y-6">
      {revenueSchedule ? (
        <Section title="Revenue schedule (engine output)">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Month</th>
                  {columns.map((column) => (
                    <th key={column.id} className={th}>
                      {column.name}
                    </th>
                  ))}
                  <th className={th}>Total monthly revenue</th>
                  <th className={th}>Cumulative revenue</th>
                </tr>
              </thead>
              <tbody>
                {revenueSchedule.byMonth.map((row) => (
                  <tr key={row.month}>
                    <td className={td}>{row.month}</td>
                    {columns.map((column) => (
                      <td key={column.id} className={td}>
                        {formatCents(row.perPo[column.id] ?? 0)}
                      </td>
                    ))}
                    <td className={td}>{formatCents(row.totalCents)}</td>
                    <td className={td}>{formatCents(row.cumulativeCents)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={td}>Total</td>
                  {columns.map((column) => (
                    <td key={column.id} className={td} />
                  ))}
                  <td className={td}>{formatCents(revenueSchedule.totalCents)}</td>
                  <td className={td} />
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      ) : (
        <Section title="Revenue schedule">
          <Notice tone="warning">
            No revenue schedule is available until the outstanding analysis items are resolved.
          </Notice>
        </Section>
      )}

      {result.variableConsideration ? (
        <div className="space-y-6 rounded-lg border border-dashed border-border p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Supporting analysis — Variable Consideration
          </h2>
          <VariableConsiderationOutputs
            vc={result.variableConsideration}
            showReconciliation={false}
          />
        </div>
      ) : null}

      {result.lifecycle ? (
        <div className="space-y-6 rounded-lg border border-dashed border-border p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Supporting analysis — Material Rights
          </h2>
          <MaterialRightLifecycleOutputs lifecycle={result.lifecycle} />
        </div>
      ) : null}
    </div>
  );
}
