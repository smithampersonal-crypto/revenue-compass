/**
 * Phase 5C grouped journal entries.
 *
 * Each contract presentation group runs through the SAME approved journal
 * engine independently, including its own replay against that group's Phase 3
 * month-end balances. Entries are aggregated only after every group reconciles.
 */

import type { ContractBalanceInput } from "@/lib/asc606-balances";

import { analyzeJournalEntries } from "./index";
import type { JournalAnalysis, JournalEntry } from "./types";

export interface JournalGroupInput {
  groupId: string;
  label: string;
  input: ContractBalanceInput;
}

export interface JournalGroupResult {
  groupId: string;
  label: string;
  analysis: JournalAnalysis;
}

export interface GroupedJournalEntry extends JournalEntry {
  groupId: string;
  groupLabel: string;
}

export interface GroupedJournalAnalysis {
  groups: JournalGroupResult[];
  /** Combined, deterministically ordered entries; null when a group is blocked. */
  entries: GroupedJournalEntry[] | null;
  reconciled: boolean | null;
}

export function analyzeGroupedJournalEntries(
  groups: readonly JournalGroupInput[],
): GroupedJournalAnalysis {
  const results: JournalGroupResult[] = groups.map((group) => ({
    groupId: group.groupId,
    label: group.label,
    analysis: analyzeJournalEntries(group.input),
  }));

  if (results.some((r) => r.analysis.entries === null || r.analysis.reconciliation.reconciled !== true)) {
    return { groups: results, entries: null, reconciled: null };
  }

  const entries: GroupedJournalEntry[] = results.flatMap((result) =>
    result.analysis.entries!.map((entry) => ({
      ...entry,
      id: `${result.groupId}::${entry.id}`,
      groupId: result.groupId,
      groupLabel: result.label,
    })),
  );

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.groupId !== b.groupId) return a.groupId.localeCompare(b.groupId);
    return a.id.localeCompare(b.id);
  });

  return { groups: results, entries, reconciled: true };
}
