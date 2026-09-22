import { AiReviewTarget } from "@/components/arc/AiReviewTarget";
import { formatCents } from "@/lib/asc606";
import { formatBasisPoints, materialRightSspCents } from "@/lib/asc606-material-rights";
import {
  parsePercentToBps,
  parseUsdToCents,
  performanceObligationDisplayLabel,
  previewAllocation,
  type PoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import {
  Field,
  inputClass,
  IssueList,
  NarrativeTextarea,
  Notice,
  Section,
  td,
  th,
  UsdMoneyInput,
} from "./fields";

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
      title="Allocation Inputs"
      description="Enter the standalone selling price and its basis for each performance obligation. Allocation is produced by the deterministic engine and is never editable."
    >
      <div className="space-y-4">
        {pos.length === 0 ? (
          <Notice>Create performance obligations in Step 2B first.</Notice>
        ) : null}
        {pos.map((po) =>
          po.kind === "material_right" ? (
            <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-semibold">
                {performanceObligationDisplayLabel(po)} — Material Right
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Economic benefit of the option (USD)">
                  <UsdMoneyInput
                    value={po.benefitAmountInput}
                    onValueChange={(next) => patch(po.id, { benefitAmountInput: next })}
                  />
                </Field>
                <Field label="Exercise probability at inception (%)">
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={po.exerciseProbabilityInput}
                    onChange={(e) => patch(po.id, { exerciseProbabilityInput: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="SSP Basis / Documentation">
                <NarrativeTextarea
                  value={po.sspBasis}
                  onChange={(e) => patch(po.id, { sspBasis: e.target.value })}
                />
              </Field>
              <p className="text-sm">
                <span className="font-semibold">Estimated SSP (engine): </span>
                {estimatedMaterialRightSsp(po)}
              </p>
            </div>
          ) : (
            <div key={po.id} className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-semibold">{performanceObligationDisplayLabel(po)}</p>
              <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                <AiReviewTarget targetKey={`po:${po.id}.sspInput`}>
                  <Field label="SSP (USD)">
                    <UsdMoneyInput
                      value={po.sspInput}
                      onValueChange={(next) => patch(po.id, { sspInput: next })}
                    />
                  </Field>
                </AiReviewTarget>
                <AiReviewTarget targetKey={`po:${po.id}.sspBasis`}>
                  <Field label="SSP Basis / Documentation">
                    <NarrativeTextarea
                      value={po.sspBasis}
                      onChange={(e) => patch(po.id, { sspBasis: e.target.value })}
                    />
                  </Field>
                </AiReviewTarget>
              </div>
            </div>
          ),
        )}

        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Transaction Price Allocation</h3>
          <p className="text-xs text-muted-foreground">
            {preview.variable
              ? "Deterministically calculated from the accountant's inputs. This table shows the general relative-SSP layer before any applicable specific allocation below and is not directly editable."
              : "Deterministically calculated from the accountant's inputs and not directly editable."}
          </p>
        </div>
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
            title="Allocation Is Not Available Yet"
            issues={preview.issues.map((message, index) => ({ id: String(index), message }))}
          />
        )}

        {preview.variable && preview.variable.finalAllocations ? (
          <>
            <h3 className="text-sm font-semibold">
              Variable Consideration Allocated to a Specific Performance Obligation
            </h3>
            {preview.variable.specific.length === 0 ? (
              <Notice>
                No variable consideration is allocated under the allocation exception. Every
                included amount is in the general pool above.
              </Notice>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>Variable consideration</th>
                    <th className={th}>Performance obligation</th>
                    <th className={th}>Amount allocated</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.variable.specific.map((row) => (
                    <tr key={row.componentId}>
                      <td className={td}>{row.description}</td>
                      <td className={td}>{row.poName}</td>
                      <td className={td}>{formatCents(row.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="text-sm font-semibold">Final Allocation at Inception</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Performance obligation</th>
                  <th className={th}>Allocated transaction price</th>
                </tr>
              </thead>
              <tbody>
                {preview.variable.finalAllocations.map((row) => (
                  <tr key={row.poId}>
                    <td className={td}>{row.name}</td>
                    <td className={td}>{formatCents(row.amountCents)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={td}>Initial transaction price</td>
                  <td className={td}>
                    {preview.variable.initialTransactionPriceCents === null
                      ? "Not yet measurable"
                      : formatCents(preview.variable.initialTransactionPriceCents)}
                  </td>
                </tr>
              </tbody>
            </table>
            <Notice>
              Usage-based consideration is recognized as the usage occurs and is never forecast, so
              it is not included in this inception allocation. Later changes in estimate are shown
              in full in the Revenue Schedule area.
            </Notice>
          </>
        ) : null}

        {draft.hasVariableConsideration && !preview.variable?.finalAllocations ? (
          <Notice>
            This contract contains variable consideration. The table above is the engine's relative
            standalone-selling-price allocation. Amounts allocated specifically to a single
            performance obligation or to a service period, and every later change in estimate, are
            shown in full in the Revenue Schedule area.
          </Notice>
        ) : null}

        <Notice>
          The relative standalone-selling-price allocation methodology is supported, including
          material rights measured as economic benefit × exercise probability and the
          variable-consideration allocation exceptions. Discount allocation exceptions and residual
          SSP methods are not supported.
        </Notice>
      </div>
    </Section>
  );
}
