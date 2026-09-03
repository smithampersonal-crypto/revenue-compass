import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { analyzePhase1, formatCents } from "@/lib/asc606";
import { ENGINE_CHECK_SCENARIOS } from "@/lib/engine-check-scenarios";

export const Route = createFileRoute("/engine-check")({
  head: () => ({
    meta: [
      { title: "Engine Check — ASC 606 Deterministic Output Review" },
      {
        name: "description",
        content:
          "Internal validation view comparing the ASC 606 engine's allocation and revenue schedule output against independently prepared workpapers.",
      },
      { property: "og:title", content: "Engine Check — ASC 606 Deterministic Output Review" },
      {
        property: "og:description",
        content: "Internal ASC 606 engine output review for fictional demonstration contracts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EngineCheck,
});

const th = "border border-border px-2 py-1 text-left font-semibold";
const td = "border border-border px-2 py-1 tabular-nums";

function EngineCheck() {
  const [key, setKey] = useState(ENGINE_CHECK_SCENARIOS[0]!.key);
  const scenario = ENGINE_CHECK_SCENARIOS.find((s) => s.key === key)!;
  const analysis = useMemo(() => analyzePhase1(scenario.input), [scenario]);

  const { validation, allocation, revenueSchedule, totals } = analysis;
  const poIds = scenario.input.performanceObligations.map((po) => po.id);
  const poNames = new Map(scenario.input.performanceObligations.map((po) => [po.id, po.name]));

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">ASC 606 Engine Check</h1>
        <p className="text-muted-foreground">
          Internal validation view. All contracts are fictional. Every number below is produced by the
          deterministic Phase 1 engine; this page performs no accounting arithmetic.
        </p>
        <select
          className="border border-border bg-background px-2 py-1"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label="Scenario"
        >
          {ENGINE_CHECK_SCENARIOS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <p>{scenario.note}</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Engine Inputs</h2>
        <p>
          Customer: {scenario.input.customerName} · Contract: {scenario.input.contractNumber} ·
          Transaction price: {formatCents(scenario.input.transactionPriceCents)} (USD)
        </p>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Seq</th>
              <th className={th}>Performance Obligation</th>
              <th className={th}>SSP</th>
              <th className={th}>Recognition Method</th>
              <th className={th}>Dates</th>
            </tr>
          </thead>
          <tbody>
            {scenario.input.performanceObligations.map((po) => (
              <tr key={po.id}>
                <td className={td}>{po.seq}</td>
                <td className={td}>{po.name}</td>
                <td className={td}>{formatCents(po.sspCents)}</td>
                <td className={td}>{po.recognitionMethod}</td>
                <td className={td}>
                  {po.recognitionMethod === "point_in_time"
                    ? po.recognitionDate
                    : `${po.serviceStart} → ${po.serviceEnd}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Validation Results</h2>
        <p className="font-semibold">
          {validation.status === "passed"
            ? "Engine Validation Passed"
            : "Engine Validation Requires Attention"}
        </p>
        <ul className="space-y-1">
          {validation.results.map((r) => (
            <li key={r.id}>
              {r.passed ? "PASS" : r.severity === "blocking" ? "BLOCKING" : "WARNING"} · {r.id} —{" "}
              {r.message}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">SSP Allocation</h2>
        {allocation === null ? (
          <p>No valid allocation — blocking validation failures prevent calculation.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Performance Obligation</th>
                <th className={th}>SSP</th>
                <th className={th}>Relative SSP %</th>
                <th className={th}>Allocated Transaction Price</th>
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
                <td className={td}>{formatCents(allocation[0]!.totalSspCents)}</td>
                <td className={td}>100.0000%</td>
                <td className={td}>{formatCents(totals.allocatedCents ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Revenue Schedule</h2>
        {revenueSchedule === null ? (
          <p>No valid revenue schedule — blocking validation failures prevent calculation.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Month</th>
                {poIds.map((id) => (
                  <th className={th} key={id}>
                    {poNames.get(id)}
                  </th>
                ))}
                <th className={th}>Total Monthly Revenue</th>
                <th className={th}>Cumulative Revenue</th>
              </tr>
            </thead>
            <tbody>
              {revenueSchedule.byMonth.map((row) => (
                <tr key={row.month}>
                  <td className={td}>{row.month}</td>
                  {poIds.map((id) => (
                    <td className={td} key={id}>
                      {formatCents(row.perPo[id] ?? 0)}
                    </td>
                  ))}
                  <td className={td}>{formatCents(row.totalCents)}</td>
                  <td className={td}>{formatCents(row.cumulativeCents)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total</td>
                {poIds.map((id) => (
                  <td className={td} key={id} />
                ))}
                <td className={td}>{formatCents(revenueSchedule.totalCents)}</td>
                <td className={td} />
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Calculation Detail</h2>
        {allocation === null || revenueSchedule === null ? (
          <p>No calculation detail — the engine produced no outputs.</p>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1">
              {allocation.map((row) => (
                <li key={row.poId}>
                  <span className="font-medium">{row.name}</span> · {row.explanation.template} ·{" "}
                  {JSON.stringify(row.explanation.inputs)}
                </li>
              ))}
            </ul>
            <ul className="space-y-1">
              {revenueSchedule.byPo.map((row) => (
                <li key={`${row.poId}-${row.month}`}>
                  <span className="font-medium">
                    {poNames.get(row.poId)} · {row.month}
                  </span>{" "}
                  · {row.explanation.template} · {JSON.stringify(row.explanation.inputs)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Reconciliation</h2>
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className={td}>Transaction Price</td>
              <td className={td}>{formatCents(totals.transactionPriceCents)}</td>
            </tr>
            <tr>
              <td className={td}>Allocated Consideration</td>
              <td className={td}>
                {totals.allocatedCents === null ? "—" : formatCents(totals.allocatedCents)}
              </td>
            </tr>
            <tr>
              <td className={td}>Scheduled Revenue</td>
              <td className={td}>
                {totals.revenueCents === null ? "—" : formatCents(totals.revenueCents)}
              </td>
            </tr>
            <tr>
              <td className={td}>Difference</td>
              <td className={td}>
                {totals.allocatedCents === null || totals.revenueCents === null
                  ? "Not calculated"
                  : formatCents(
                      totals.transactionPriceCents - totals.allocatedCents === 0 &&
                        totals.allocatedCents - totals.revenueCents === 0
                        ? 0
                        : totals.transactionPriceCents - totals.revenueCents,
                    )}
              </td>
            </tr>
            <tr>
              <td className={td}>Status</td>
              <td className={td}>
                {totals.allocatedCents === null || totals.revenueCents === null
                  ? "Not reconciled — engine produced no outputs"
                  : totals.transactionPriceCents === totals.allocatedCents &&
                      totals.allocatedCents === totals.revenueCents
                    ? "Reconciled"
                    : "Out of balance"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
