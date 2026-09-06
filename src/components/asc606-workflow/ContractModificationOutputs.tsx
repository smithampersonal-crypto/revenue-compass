/**
 * Phase 5C read-only modification presentation. Every amount shown here is
 * produced by the deterministic contract-modification engine; this component
 * performs no accounting arithmetic.
 */

import { formatCents } from "@/lib/asc606";
import type { ContractModificationAnalysis } from "@/lib/asc606-contract-modifications";

import { Section, td, th } from "./fields";

export function ContractModificationOutputs({
  modification,
}: {
  modification: ContractModificationAnalysis;
}) {
  const { classification, totals, reconciliation, allocationLayers, historical, catchUpEvents } =
    modification;

  return (
    <Section
      title="Contract modification"
      description="Derived ASC 606 modification treatment, preserved historical revenue, and the allocation applied from the effective date forward."
    >
      {classification ? (
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-semibold">Treatment: </span>
            {classification.label}
          </p>
          <p className="text-muted-foreground">{classification.rationale}</p>
          <p>
            <span className="font-semibold">Separate-contract test (ASC 606-10-25-12): </span>
            {classification.separateContractTestPassed ? "Met" : "Not met"}
          </p>
          {classification.separateContractFailures.length > 0 ? (
            <ul className="list-disc pl-5 text-muted-foreground">
              {classification.separateContractFailures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
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
        <div key={layer.basis} className="overflow-x-auto">
          <h3 className="mb-2 text-base font-semibold">
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
                <th className={th}>Revised cumulative</th>
                <th className={th}>Previously recognized</th>
                <th className={th}>Catch-up</th>
              </tr>
            </thead>
            <tbody>
              {catchUpEvents.map((event) => (
                <tr key={event.id}>
                  <td className={td}>{event.poId}</td>
                  <td className={td}>{event.effectiveDate}</td>
                  <td className={td}>{formatCents(event.revisedCumulativeCents)}</td>
                  <td className={td}>{formatCents(event.previouslyRecognizedCents)}</td>
                  <td className={td}>{formatCents(event.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {modification.groups.length > 1 ? (
        <div className="space-y-1 text-sm">
          <h3 className="text-base font-semibold">Contracts presented separately</h3>
          <ul className="list-disc pl-5">
            {modification.groups.map((group) => (
              <li key={group.id}>
                {group.label} — {formatCents(group.transactionPriceCents)}
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
