import { formatCents } from "@/lib/asc606";
import { formatBasisPoints } from "@/lib/asc606-material-rights";
import {
  analyzeContractBalanceWorkflow,
  derivePromiseDistinct,
  MATERIAL_RIGHT_STATUS_LABELS,
  PO_CLASSIFICATION_LABELS,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { analyzeJournalEntries } from "@/lib/asc606-journals";

import { ContractBalanceOutputs } from "./ContractBalanceOutputs";
import { JournalEntryOutputs } from "./JournalEntryOutputs";
import { IssueList, judgmentLabel, Notice, Section, td, th } from "./fields";

export function AnalysisResults({
  draft,
  result,
}: {
  draft: WorkflowDraft;
  result: WorkflowAnalysisResult;
}) {
  const { analysis, lifecycle, allocation, revenueSchedule, step1Conclusion, workflowValidation } =
    result;
  const balances = analyzeContractBalanceWorkflow(draft);
  const poName = new Map(draft.performanceObligations.map((po) => [po.id, po.name || po.id]));
  // Revenue-schedule columns come from engine-supplied source metadata when the
  // lifecycle engine ran; otherwise from the performance obligations.
  const columns =
    result.revenueSources.length > 0
      ? result.revenueSources.map((source) => ({ id: source.id, name: source.name }))
      : draft.performanceObligations.map((po) => ({
          id: po.id,
          name: poName.get(po.id) ?? po.id,
        }));
  const journalAnalysis =
    balances.finalized && balances.engineInput
      ? analyzeJournalEntries(balances.engineInput)
      : null;

  return (
    <div className="space-y-6">
      <Section title="Contract conclusion">
        <Notice tone={step1Conclusion === "qualified" ? "muted" : "danger"}>
          <p className="font-semibold">
            {step1Conclusion === "qualified"
              ? "Step 1: the arrangement qualifies as a contract under ASC 606."
              : step1Conclusion === "not_qualified"
                ? "Step 1: the arrangement does not qualify as a contract under ASC 606."
                : "Step 1: the contract criteria are incomplete."}
          </p>
          {result.blockedReason ? <p className="mt-1">{result.blockedReason}</p> : null}
        </Notice>
        <p className="text-sm">
          <span className="font-semibold">Customer:</span> {draft.contract.customerName || "—"} ·{" "}
          <span className="font-semibold">Contract:</span> {draft.contract.contractNumber || "—"} ·{" "}
          <span className="font-semibold">Currency:</span> USD
        </p>
      </Section>

      <IssueList
        title="Workflow items requiring attention"
        issues={workflowValidation.blocking}
      />
      <IssueList
        title="Workflow warnings"
        tone="warning"
        issues={workflowValidation.warnings}
      />
      <IssueList
        title="Engine input could not be assembled"
        issues={result.adapterErrors.map((message, index) => ({ id: String(index), message }))}
      />

      <Section title="Promise analysis">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>Promise</th>
              <th className={th}>Capable of being distinct</th>
              <th className={th}>Distinct within context</th>
              <th className={th}>Derived conclusion</th>
              <th className={th}>Rationale</th>
            </tr>
          </thead>
          <tbody>
            {draft.promises.map((promise) => {
              const distinct = derivePromiseDistinct(promise);
              return (
                <tr key={promise.id}>
                  <td className={td}>{promise.description || promise.id}</td>
                  <td className={td}>{judgmentLabel(promise.capableOfBeingDistinct)}</td>
                  <td className={td}>{judgmentLabel(promise.distinctWithinContractContext)}</td>
                  <td className={td}>
                    {distinct === null ? "Incomplete" : distinct ? "Distinct" : "Not distinct"}
                  </td>
                  <td className={td}>{promise.distinctRationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Performance obligations">
        <div className="space-y-3">
          {draft.performanceObligations.map((po) => (
            <div key={po.id} className="rounded-md border border-border p-3 text-sm">
              <p className="font-semibold">{po.name || po.id}</p>
              <p>
                <span className="font-medium">Assigned promises: </span>
                {draft.promises
                  .filter((p) => p.performanceObligationId === po.id)
                  .map((p) => p.description || p.id)
                  .join("; ") || "None"}
              </p>
              <p>
                <span className="font-medium">Classification: </span>
                {po.classification ? PO_CLASSIFICATION_LABELS[po.classification] : "Not selected"}
              </p>
              <p>
                <span className="font-medium">Classification rationale: </span>
                {po.classificationRationale || "—"}
              </p>
              <p>
                <span className="font-medium">SSP (entered): </span>
                {po.sspInput || "—"}
              </p>
              <p>
                <span className="font-medium">SSP basis: </span>
                {po.sspBasis || "—"}
              </p>
              <p>
                <span className="font-medium">Recognition: </span>
                {po.recognitionMethod === "over_time_ratable"
                  ? `Over time — daily ratable, ${po.serviceStart} to ${po.serviceEnd}`
                  : po.recognitionMethod === "point_in_time"
                    ? `Point in time on ${po.recognitionDate}`
                    : "Not selected"}
              </p>
              <p>
                <span className="font-medium">Recognition rationale: </span>
                {po.recognitionRationale || "—"}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {allocation ? (
        <Section title="SSP allocation (engine output)">
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
              {allocation.map((row) => (
                <tr key={row.poId}>
                  <td className={td}>{row.name}</td>
                  <td className={td}>{formatCents(row.sspCents)}</td>
                  <td className={td}>{row.relativeSspPercent.toFixed(4)}%</td>
                  <td className={td}>{formatCents(row.allocatedCents)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total</td>
                <td className={td}>{formatCents(allocation[0]?.totalSspCents ?? 0)}</td>
                <td className={td}>100.0000%</td>
                <td className={td}>
                  {formatCents(
                    analysis?.totals.allocatedCents ??
                      lifecycle?.totals.originalAllocatedCents ??
                      0,
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          {lifecycle ? (
            <Notice>
              The original transaction price is allocated once at inception across the standard
              performance obligations and the material rights. This allocation is never re-performed
              when an option is exercised or expires.
            </Notice>
          ) : null}
        </Section>
      ) : (
        <Section title="SSP allocation">
          <Notice tone="danger">No finalized SSP allocation is presented.</Notice>
        </Section>
      )}

      {lifecycle ? (
        <Section
          title="Material rights (engine output)"
          description="Customer options that convey a material right, their inception measurement and their lifecycle outcome."
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Material right</th>
                <th className={th}>Underlying good or service</th>
                <th className={th}>Economic benefit</th>
                <th className={th}>Exercise probability</th>
                <th className={th}>Estimated SSP</th>
                <th className={th}>Allocated</th>
                <th className={th}>Outcome</th>
                <th className={th}>Unscheduled consideration</th>
              </tr>
            </thead>
            <tbody>
              {lifecycle.materialRights.map((right) => (
                <tr key={right.poId}>
                  <td className={td}>{right.name}</td>
                  <td className={td}>{right.underlyingGoodOrServiceName}</td>
                  <td className={td}>{formatCents(right.benefitAmountCents)}</td>
                  <td className={td}>{formatBasisPoints(right.exerciseProbabilityBps)}</td>
                  <td className={td}>{formatCents(right.estimatedSspCents)}</td>
                  <td className={td}>{formatCents(right.allocatedCents)}</td>
                  <td className={td}>
                    {MATERIAL_RIGHT_STATUS_LABELS[right.status]}
                    {right.exerciseDate ? ` on ${right.exerciseDate}` : ""}
                    {right.expirationDate ? ` on ${right.expirationDate}` : ""}
                  </td>
                  <td className={td}>{formatCents(right.unscheduledCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {revenueSchedule ? (
        <Section title="Revenue schedule (engine output)">
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
        </Section>
      ) : (
        <Section title="Revenue schedule">
          <Notice tone="danger">No finalized revenue schedule is presented.</Notice>
        </Section>
      )}

      {result.engineValidation ? (
        <Section title="Engine validation">
          <p className="text-sm font-semibold">
            {result.engineValidation.status === "passed"
              ? "Engine Validation Passed"
              : "Engine Validation Requires Attention"}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {result.engineValidation.results.map((check) => (
              <li key={check.id}>
                {check.passed ? "PASS" : check.severity === "blocking" ? "BLOCKING" : "WARNING"} —{" "}
                {check.id}: {check.message}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Reconciliation">
        {analysis ? (
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr>
                <td className={td}>Transaction price</td>
                <td className={td}>{formatCents(analysis.totals.transactionPriceCents)}</td>
              </tr>
              <tr>
                <td className={td}>Allocated consideration</td>
                <td className={td}>
                  {analysis.totals.allocatedCents === null
                    ? "Not available"
                    : formatCents(analysis.totals.allocatedCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Scheduled revenue</td>
                <td className={td}>
                  {analysis.totals.revenueCents === null
                    ? "Not available"
                    : formatCents(analysis.totals.revenueCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Allocation difference</td>
                <td className={td}>
                  {analysis.reconciliation.allocationDifferenceCents === null
                    ? "Not available"
                    : formatCents(analysis.reconciliation.allocationDifferenceCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Revenue difference</td>
                <td className={td}>
                  {analysis.reconciliation.revenueDifferenceCents === null
                    ? "Not available"
                    : formatCents(analysis.reconciliation.revenueDifferenceCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Status</td>
                <td className={td}>
                  {analysis.reconciliation.reconciled === null
                    ? "Not available"
                    : analysis.reconciliation.reconciled
                      ? "Reconciled"
                      : "Not reconciled"}
                </td>
              </tr>
            </tbody>
          </table>
        ) : lifecycle ? (
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr>
                <td className={td}>Original transaction price</td>
                <td className={td}>
                  {formatCents(lifecycle.totals.originalTransactionPriceCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Consideration on exercised options</td>
                <td className={td}>{formatCents(lifecycle.totals.exerciseConsiderationCents)}</td>
              </tr>
              <tr>
                <td className={td}>Total lifecycle consideration</td>
                <td className={td}>{formatCents(lifecycle.totals.lifecycleConsiderationCents)}</td>
              </tr>
              <tr>
                <td className={td}>Scheduled revenue</td>
                <td className={td}>
                  {lifecycle.totals.scheduledRevenueCents === null
                    ? "Not available"
                    : formatCents(lifecycle.totals.scheduledRevenueCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Unscheduled material-right consideration</td>
                <td className={td}>
                  {lifecycle.totals.unscheduledMaterialRightCents === null
                    ? "Not available"
                    : formatCents(lifecycle.totals.unscheduledMaterialRightCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Scheduled plus unscheduled</td>
                <td className={td}>
                  {lifecycle.reconciliation.scheduledPlusUnscheduledCents === null
                    ? "Not available"
                    : formatCents(lifecycle.reconciliation.scheduledPlusUnscheduledCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Difference</td>
                <td className={td}>
                  {lifecycle.reconciliation.differenceCents === null
                    ? "Not available"
                    : formatCents(lifecycle.reconciliation.differenceCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Status</td>
                <td className={td}>
                  {lifecycle.reconciliation.reconciled === null
                    ? "Not available"
                    : lifecycle.reconciliation.reconciled
                      ? "Reconciled"
                      : "Not reconciled"}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Notice tone="danger">No reconciliation is presented as valid.</Notice>
        )}
      </Section>

      {balances.finalized && balances.analysis ? (
        <>
          <Section
            title="Billing, receivables and contract balances"
            description="A separate post-ASC-606 workpaper. It does not affect the five-step revenue analysis above."
          >
            <Notice>
              Contract asset and contract liability are determined from cumulative revenue versus
              cumulative unconditional rights to consideration; invoicing and cash affect only the
              receivable presentation.
            </Notice>
          </Section>
          <ContractBalanceOutputs analysis={balances.analysis} />
        </>
      ) : (
        <Section title="Billing, receivables and contract balances">
          <Notice tone="warning">
            The billing and contract-balance workpaper is incomplete, so no billing schedule or
            contract-balance rollforward is presented. The ASC 606 five-step revenue analysis above
            is unaffected.
          </Notice>
          {balances.blockedReason ? (
            <p className="text-sm text-muted-foreground">{balances.blockedReason}</p>
          ) : null}
          <IssueList
            title="Outstanding billing and contract-balance items"
            tone="warning"
            issues={balances.validation.blocking}
          />
        </Section>
      )}

      {journalAnalysis ? (
        <JournalEntryOutputs analysis={journalAnalysis} poNames={poName} />
      ) : (
        <Section title="Journal Entries">
          <Notice tone="warning">
            Journal entries are not available until the Billing &amp; Contract Balances workpaper is
            finalized.
          </Notice>
        </Section>
      )}
    </div>
  );
}
