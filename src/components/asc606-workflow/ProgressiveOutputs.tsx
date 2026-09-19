/**
 * Phase 9G-R3 Part 2, Stage F — minimum UI for the progressive states.
 *
 * Presentation only: every amount and every state shown here is produced by
 * the deterministic engine. Nothing is recalculated in the component.
 */

import { formatCents } from "@/lib/asc606";
import {
  analyzeProgressiveContract,
  PENDING_REASON_LABELS,
  type CalculationState,
} from "@/lib/asc606-progressive";
import { toProgressiveContractInput, type WorkflowDraft } from "@/lib/asc606-workflow";

import { Notice, Section } from "./fields";

const STATE_LABELS: Record<CalculationState, string> = {
  complete: "Complete",
  provisional: "Provisional — awaiting confirmation",
  pending: "Partial — awaiting future facts",
  blocked: "Cannot be calculated yet",
};

function StateBadge({ state }: { state: CalculationState }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
      {STATE_LABELS[state]}
    </span>
  );
}

export function ProgressiveOutputs({ draft }: { draft: WorkflowDraft }) {
  let analysis: ReturnType<typeof analyzeProgressiveContract>;
  try {
    analysis = analyzeProgressiveContract(toProgressiveContractInput(draft));
  } catch {
    return null;
  }

  const { allocation, vc, recognition, billing, balances, journals, provisional } = analysis;

  return (
    <Section
      title="Progressive results"
      description="Everything that can be determined today is calculated now. A fact that has not happened yet limits only the output that depends on it."
    >
      <div className="space-y-4" data-testid="progressive-outputs">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Overall</span>
          <StateBadge state={analysis.state} />
        </div>

        {/* ---- Step 4 allocation, including provisional SSPs -------------- */}
        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-semibold">Allocation</p>
          {allocation === null ? (
            <Notice>{analysis.blocked[0]?.message ?? "Allocation is not yet calculable."}</Notice>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {allocation.map((row) => {
                const isProvisional = provisional.some((note) => note.poId === row.poId);
                return (
                  <li key={row.poId} className="flex justify-between gap-3">
                    <span>
                      {row.name}
                      {isProvisional ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          provisional standalone selling price
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums">{formatCents(row.allocatedCents)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            General pool {formatCents(analysis.generalPoolCents)} · specifically allocated{" "}
            {vc.specificPo.length} · service-period amounts {vc.seriesPeriod.length}
          </p>
        </div>

        {/* ---- Step 5 schedule and pending components --------------------- */}
        <div className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Revenue schedule</p>
            {recognition ? <StateBadge state={recognition.state} /> : null}
          </div>
          {recognition && recognition.schedule.byMonth.length > 0 ? (
            <p className="mt-1 text-sm">
              {recognition.schedule.firstMonth} – {recognition.schedule.lastMonth} ·{" "}
              {formatCents(recognition.schedule.totalCents)} scheduled
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No revenue is scheduled yet.</p>
          )}
          {recognition && recognition.pending.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {recognition.pending.map((component, index) => (
                <li
                  key={`${component.poId}-${component.reason}-${index}`}
                  className="flex justify-between gap-3"
                >
                  <span>
                    {component.poName} — {PENDING_REASON_LABELS[component.reason]}
                  </span>
                  <span className="tabular-nums">{formatCents(component.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* ---- Billing, independent of recognition readiness -------------- */}
        <div className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Billing schedule</p>
            <StateBadge state={billing.state} />
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {billing.events.map((event) => (
              <li key={event.id} className="flex justify-between gap-3">
                <span>
                  {event.date} — {event.description}
                </span>
                <span className="tabular-nums">{formatCents(event.amountCents)}</span>
              </li>
            ))}
          </ul>
          {billing.pendingRules.map((rule) => (
            <p key={rule.componentId} className="mt-1 text-xs text-muted-foreground">
              {rule.description} — {PENDING_REASON_LABELS[rule.reason]}. No amount is billable yet.
            </p>
          ))}
        </div>

        {/* ---- Balances and journals -------------------------------------- */}
        {balances ? (
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Contract balances</p>
              <StateBadge state={balances.state} />
            </div>
            <p className="mt-1 text-sm">
              Billed {formatCents(balances.totalBilledCents)} · revenue{" "}
              {formatCents(balances.totalRevenueCents)} · unresolved{" "}
              {formatCents(balances.pendingCents)}
            </p>
          </div>
        ) : null}

        {journals ? (
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Journal entries</p>
              <StateBadge state={journals.state} />
            </div>
            <p className="mt-1 text-sm">
              {journals.entries.length} known entries · {journals.pendingEvents.length} awaiting an
              accounting event
            </p>
            {journals.pendingEvents.map((event) => (
              <p key={event.id} className="text-xs text-muted-foreground">
                {event.poName} — {event.label} ({formatCents(event.amountCents)})
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
