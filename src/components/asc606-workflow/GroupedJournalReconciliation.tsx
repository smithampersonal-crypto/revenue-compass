import type { GroupedJournalAnalysis } from "@/lib/asc606-journals";

import { Section, td } from "./fields";

/**
 * Combined reconciliation summary only. Each contract's journal entries are
 * generated and reconciled independently by the engine; no combined journal is
 * created and no contract is netted against another.
 */
export function GroupedJournalReconciliation({ grouped }: { grouped: GroupedJournalAnalysis }) {
  return (
    <Section
      title="Combined journal reconciliation"
      description="Each contract's journal entries are generated and reconciled independently. No combined journal is created and no contract is netted against another."
    >
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr>
            <td className={td}>Contract groups</td>
            <td className={td}>{grouped.groups.length}</td>
          </tr>
          {grouped.groups.map((group) => (
            <tr key={group.groupId}>
              <td className={td}>{group.label}</td>
              <td className={td}>
                {group.analysis.reconciliation.reconciled === true
                  ? "Reconciled"
                  : "Not reconciled"}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={td}>Overall grouped reconciliation</td>
            <td className={td}>{grouped.reconciled === true ? "Reconciled" : "Not reconciled"}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
