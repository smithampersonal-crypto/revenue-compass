/**
 * Phase 5C read-only modification presentation. Every amount, identity, label
 * and conclusion shown here is produced by the deterministic
 * contract-modification engine; this component performs no accounting
 * arithmetic and derives no judgment.
 */

import { formatCents } from "@/lib/asc606";
import {
  MIXED_POLICY_LABELS,
  type ContractModificationAnalysis,
} from "@/lib/asc606-contract-modifications";

import { Section, td, th } from "./fields";

export function ContractModificationOutputs({
  modification,
}: {
  modification: ContractModificationAnalysis;
}) {
  const {
    event,
    historicalCutoffDate,
    classification,
    totals,
    reconciliation,
    allocationLayers,
    historical,
    catchUpEvents,
    segments,
    groups,
    revenueSources,
  } = modification;

  return (
    <Section
      title="Contract modification results (engine output)"
      description="Derived ASC 606 modification treatment, preserved historical revenue, and the allocation applied from the effective date forward."
    >
      <div className="space-y-1 text-sm">
        <h3 className="text-base font-semibold">Modification and scope</h3>
        <p>
          <span className="font-semibold">Modification effective date: </span>
          {event?.modificationDate ?? "—"}
        </p>
        <p>
          <span className="font-semibold">Historical cutoff date: </span>
          {historicalCutoffDate ?? "—"}
        </p>
        <p>
          <span className="font-semibold">Scope change: </span>
          {event?.scopeChangeDescription || "—"}
        </p>
        <p>
          <span className="font-semibold">Change in consideration recorded: </span>
          {event ? formatCents(totals.considerationChangeCents) : "—"}
        </p>
      </div>

      {classification ? (
        <div className="space-y-1 text-sm">
          <h3 className="text-base font-semibold">Judgments and derived treatment</h3>
          <p>
            <span className="font-semibold">Approved and enforceable: </span>
            {classification.approvedAndEnforceable ? "Yes" : "No"}
          </p>
          {classification.approvalRationale ? (
            <p className="text-muted-foreground">{classification.approvalRationale}</p>
          ) : null}
          <p>
            <span className="font-semibold">Treatment: </span>
            {classification.label}
          </p>
          <p className="text-muted-foreground">{classification.rationale}</p>
          <p>
            <span className="font-semibold">Separate-contract test (ASC 606-10-25-12): </span>
            {classification.separateContractTestPassed ? "Met" : "Not met"}
          </p>
          {classification.separateContractCriteria.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>Criterion</th>
                    <th className={th}>Result</th>
                    <th className={th}>Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {classification.separateContractCriteria.map((criterion) => (
                    <tr key={criterion.id}>
                      <td className={td}>{criterion.label}</td>
                      <td className={td}>{criterion.passed ? "Met" : "Not met"}</td>
                      <td className={td}>{criterion.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {classification.mixedAllocationPolicy ? (
            <>
              <p>
                <span className="font-semibold">Mixed-modification policy: </span>
                {MIXED_POLICY_LABELS[classification.mixedAllocationPolicy]}
              </p>
              {classification.mixedAllocationPolicyRationale ? (
                <p className="text-muted-foreground">
                  {classification.mixedAllocationPolicyRationale}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Original transaction price" value={totals.originalTransactionPriceCents} />
        <Row label="Change in consideration" value={totals.considerationChangeCents} />
        <Row label="Lifecycle consideration" value={totals.lifecycleConsiderationCents} />
        <Row
          label="Revenue recognized before the effective date"
          value={totals.historicalRevenueCents}
        />
        {totals.remainingTransactionPriceCents !== null ? (
          <Row
            label="Remaining transaction price allocated"
            value={totals.remainingTransactionPriceCents}
          />
        ) : null}
        {totals.updatedTotalTransactionPriceCents !== null ? (
          <Row
            label="Updated total transaction price allocated"
            value={totals.updatedTotalTransactionPriceCents}
          />
        ) : null}
        <Row label="Cumulative catch-up recognized" value={totals.catchUpCents} />
        <Row
          label="Revenue recognized after the effective date"
          value={totals.futureRevenueCents}
        />
        <Row label="Total scheduled revenue" value={totals.scheduledRevenueCents} />
      </dl>

      <p className="text-sm">
        <span className="font-semibold">Reconciliation: </span>
        {reconciliation.reconciled === true
          ? `Historical revenue plus catch-up plus future revenue equals lifecycle consideration (${formatCents(
              reconciliation.historicalPlusCatchUpPlusFutureCents ?? 0,
            )}).`
          : "Not reconciled — no authoritative modification result is presented."}
      </p>

      {historical.length > 0 ? (
        <div className="overflow-x-auto">
          <h3 className="mb-2 text-base font-semibold">
            Revenue preserved through the day before the effective date
          </h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Performance obligation</th>
                <th className={th}>Progress</th>
                <th className={th}>Revenue recognized</th>
              </tr>
            </thead>
            <tbody>
              {historical.map((row) => (
                <tr key={row.poId}>
                  <td className={td}>{row.name}</td>
                  <td className={td}>
                    {row.progressDays !== null && row.totalDays !== null
                      ? `${row.progressDays} of ${row.totalDays} days`
                      : "—"}
                  </td>
                  <td className={td}>{formatCents(row.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {allocationLayers?.map((layer) => (
        <div key={layer.basis} className="space-y-2 overflow-x-auto">
          <h3 className="text-base font-semibold">
            {layer.label} — {formatCents(layer.transactionPriceCents)}
          </h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Performance obligation</th>
                <th className={th}>Standalone selling price</th>
                <th className={th}>Allocated</th>
              </tr>
            </thead>
            <tbody>
              {layer.rows.map((row) => (
                <tr key={row.poId}>
                  <td className={td}>{row.name}</td>
                  <td className={td}>{formatCents(row.sspCents)}</td>
                  <td className={td}>{formatCents(row.allocatedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {layer.sspEvidence.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Standalone selling price used</th>
                  <th className={th}>Amount</th>
                  <th className={th}>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {layer.sspEvidence.map((evidence) => (
                  <tr key={`${layer.basis}-${evidence.poId}`}>
                    <td className={td}>{evidence.name}</td>
                    <td className={td}>{formatCents(evidence.sspCents)}</td>
                    <td className={td}>{evidence.basis ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ))}

      {catchUpEvents.length > 0 ? (
        <div className="overflow-x-auto">
          <h3 className="mb-2 text-base font-semibold">Cumulative catch-up adjustments</h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Performance obligation</th>
                <th className={th}>Effective date</th>
                <th className={th}>Entitlement basis</th>
                <th className={th}>Revised cumulative</th>
                <th className={th}>Previously recognized</th>
                <th className={th}>Catch-up</th>
              </tr>
            </thead>
            <tbody>
              {catchUpEvents.map((event) => (
                <tr key={event.id}>
                  <td className={td}>{event.poName}</td>
                  <td className={td}>{event.effectiveDate}</td>
                  <td className={td}>{formatCents(event.entitlementBasisCents)}</td>
                  <td className={td}>{formatCents(event.revisedCumulativeCents)}</td>
                  <td className={td}>{formatCents(event.previouslyRecognizedCents)}</td>
                  <td className={td}>{formatCents(event.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {revenueSources.length > 0 ? (
        <div className="overflow-x-auto">
          <h3 className="mb-2 text-base font-semibold">Revenue source audit trail</h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Source</th>
                <th className={th}>Source ID</th>
                <th className={th}>Type</th>
                <th className={th}>Original PO</th>
                <th className={th}>Modified PO</th>
                <th className={th}>Modification</th>
                <th className={th}>Segment</th>
                <th className={th}>Contract group</th>
                <th className={th}>Effective date</th>
              </tr>
            </thead>
            <tbody>
              {revenueSources.map((source) => (
                <tr key={source.id}>
                  <td className={td}>{source.name}</td>
                  <td className={td}>{source.id}</td>
                  <td className={td}>{source.sourceType}</td>
                  <td className={td}>{source.originalPoId ?? "—"}</td>
                  <td className={td}>{source.modificationPoId ?? "—"}</td>
                  <td className={td}>{source.modificationId ?? "—"}</td>
                  <td className={td}>{source.segmentId ?? "—"}</td>
                  <td className={td}>{source.groupId ?? "—"}</td>
                  <td className={td}>{source.effectiveDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {segments.length > 0 ? (
        <div className="overflow-x-auto">
          <h3 className="mb-2 text-base font-semibold">Accounting segments</h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Segment</th>
                <th className={th}>Segment ID</th>
                <th className={th}>Contract group</th>
                <th className={th}>From</th>
                <th className={th}>To</th>
                <th className={th}>Consideration</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.id}>
                  <td className={td}>{segment.label}</td>
                  <td className={td}>{segment.id}</td>
                  <td className={td}>{segment.groupId}</td>
                  <td className={td}>{segment.startDate ?? "—"}</td>
                  <td className={td}>{segment.endDate ?? "—"}</td>
                  <td className={td}>{formatCents(segment.considerationCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="space-y-1 text-sm">
          <h3 className="text-base font-semibold">Contract presentation groups</h3>
          <ul className="list-disc pl-5">
            {groups.map((group) => (
              <li key={group.id}>
                {group.label} ({group.id}) — {formatCents(group.transactionPriceCents)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1">
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatCents(value)}</dd>
    </div>
  );
}
