/** Restrained textual status for an accordion header, e.g. "2 issues". */
export function issueStatus(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "1 issue" : `${count} issues`;
}
