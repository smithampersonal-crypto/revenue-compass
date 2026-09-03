import { formatCents } from "@/lib/asc606";
import { parseUsdToCents, type WorkflowDraft } from "@/lib/asc606-workflow";

import { Field, inputClass, Notice, Section } from "./fields";

export function Step3TransactionPrice({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const parsed = parseUsdToCents(draft.transactionPriceInput);

  return (
    <Section
      title="Step 3 — Determine the Transaction Price"
      description="Fixed consideration in USD."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fixed transaction price (USD)" hint="Example: 120,000.00">
          <input
            className={inputClass}
            inputMode="decimal"
            value={draft.transactionPriceInput}
            onChange={(e) => onChange({ ...draft, transactionPriceInput: e.target.value })}
          />
        </Field>
        <Field label="Transaction price notes (optional)">
          <textarea
            className={inputClass}
            rows={2}
            value={draft.transactionPriceNotes}
            onChange={(e) => onChange({ ...draft, transactionPriceNotes: e.target.value })}
          />
        </Field>
      </div>

      {draft.transactionPriceInput.trim() === "" ? null : parsed.ok ? (
        <p className="text-sm">
          Interpreted as <span className="font-semibold">{formatCents(parsed.cents)}</span>.
        </p>
      ) : (
        <Notice tone="danger">{parsed.error}</Notice>
      )}

      <Notice>
        Phase 2 supports fixed consideration only. Variable consideration, significant financing
        components, material rights, nonrefundable upfront-fee accounting, refunds, and similar
        advanced transaction-price issues are not yet supported.
      </Notice>
    </Section>
  );
}
