import {
  analyzeContractBalanceWorkflow,
  createCashCollectionDraft,
  createConsiderationEventDraft,
  nextId,
  nextSeq,
  type CashCollectionDraft,
  type ConsiderationEventDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { ContractBalanceOutputs } from "./ContractBalanceOutputs";
import { Field, inputClass, IssueList, Notice, Section, td, th } from "./fields";

/**
 * Post-ASC-606 accounting workpaper stage. React collects input strings and
 * displays deterministic engine output; it performs no balance accounting.
 */
export function BillingAndBalances({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const { considerationEvents, cashCollections } = draft.contractBalances;
  const result = analyzeContractBalanceWorkflow(draft);

  const setEvents = (events: ConsiderationEventDraft[]) =>
    onChange({ ...draft, contractBalances: { ...draft.contractBalances, considerationEvents: events } });
  const setCash = (rows: CashCollectionDraft[]) =>
    onChange({ ...draft, contractBalances: { ...draft.contractBalances, cashCollections: rows } });

  const updateEvent = (id: string, patch: Partial<ConsiderationEventDraft>) =>
    setEvents(considerationEvents.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const updateCash = (id: string, patch: Partial<CashCollectionDraft>) =>
    setCash(cashCollections.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-6">
      <Section
        title="Billing & Contract Balances"
        description="A post-ASC-606 accounting workpaper. The five-step revenue analysis above is unaffected by anything entered here."
      >
        <Notice>
          <p className="font-semibold">How these balances are determined</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <span className="font-semibold">Contract asset</span> — revenue recognized exceeds
              unconditional rights to consideration.
            </li>
            <li>
              <span className="font-semibold">Unbilled AR</span> — an unconditional right exists, but
              the customer has not yet been invoiced.
            </li>
            <li>
              <span className="font-semibold">Billed AR</span> — an unconditional right exists, the
              invoice has been issued, and the amount remains unpaid.
            </li>
            <li>
              <span className="font-semibold">Contract liability (deferred revenue)</span> —
              unconditional rights exceed revenue recognized.
            </li>
          </ul>
        </Notice>
        <Notice tone="warning">
          This stage assumes cash collections occur on or after both the invoice date and the date
          the right to consideration becomes unconditional. Customer deposits and other advance cash
          receipts are not yet supported.
        </Notice>
      </Section>

      <Section
        title="Consideration events (billing events)"
        description="The unconditional-right date drives receivable and contract-balance accounting. The invoice date identifies when an unconditional receivable becomes billed."
      >
        <div className="space-y-4">
          {considerationEvents.length === 0 ? (
            <Notice>No billing events have been entered yet.</Notice>
          ) : null}
          {considerationEvents.map((event) => (
            <div key={event.id} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  Event {event.seq} · {event.id}
                </p>
                <button
                  type="button"
                  className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => setEvents(considerationEvents.filter((e) => e.id !== event.id))}
                >
                  Remove billing event
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Amount (USD)">
                  <input
                    className={inputClass}
                    value={event.amountInput}
                    onChange={(e) => updateEvent(event.id, { amountInput: e.target.value })}
                    placeholder="60,000.00"
                  />
                </Field>
                <Field label="Unconditional right date">
                  <input
                    type="date"
                    className={inputClass}
                    value={event.unconditionalRightDate}
                    onChange={(e) => updateEvent(event.id, { unconditionalRightDate: e.target.value })}
                  />
                </Field>
                <Field label="Invoice date">
                  <input
                    type="date"
                    className={inputClass}
                    value={event.invoiceDate}
                    onChange={(e) => updateEvent(event.id, { invoiceDate: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="rounded-md border border-primary bg-primary px-3 py-1 text-sm text-primary-foreground"
            onClick={() =>
              setEvents([
                ...considerationEvents,
                createConsiderationEventDraft(
                  nextSeq(considerationEvents),
                  nextId("ce", considerationEvents),
                ),
              ])
            }
          >
            Add billing event
          </button>
        </div>
      </Section>

      <Section
        title="Cash collections"
        description="Each cash row applies to exactly one billing event. Enter separate rows when one customer payment settles several invoices."
      >
        <div className="space-y-4">
          {cashCollections.length === 0 ? (
            <Notice>No cash collections have been entered yet.</Notice>
          ) : null}
          {cashCollections.map((collection) => (
            <div key={collection.id} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  Collection {collection.seq} · {collection.id}
                </p>
                <button
                  type="button"
                  className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => setCash(cashCollections.filter((c) => c.id !== collection.id))}
                >
                  Remove collection
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Related billing event">
                  <select
                    className={inputClass}
                    value={collection.considerationEventId ?? ""}
                    onChange={(e) =>
                      updateCash(collection.id, {
                        considerationEventId: e.target.value === "" ? null : e.target.value,
                      })
                    }
                  >
                    <option value="">Select a billing event</option>
                    {considerationEvents.map((event) => (
                      <option key={event.id} value={event.id}>
                        Event {event.seq} · {event.id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount (USD)">
                  <input
                    className={inputClass}
                    value={collection.amountInput}
                    onChange={(e) => updateCash(collection.id, { amountInput: e.target.value })}
                    placeholder="60,000.00"
                  />
                </Field>
                <Field label="Collection date">
                  <input
                    type="date"
                    className={inputClass}
                    value={collection.collectionDate}
                    onChange={(e) => updateCash(collection.id, { collectionDate: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="rounded-md border border-primary bg-primary px-3 py-1 text-sm text-primary-foreground"
            onClick={() =>
              setCash([
                ...cashCollections,
                createCashCollectionDraft(nextSeq(cashCollections), nextId("cc", cashCollections)),
              ])
            }
          >
            Add collection
          </button>
        </div>
      </Section>

      <IssueList
        title="Resolve these items before the contract-balance workpaper can be finalized"
        issues={result.validation.blocking}
      />
      <IssueList title="Contract-balance warnings" tone="warning" issues={result.validation.warnings} />

      {result.finalized && result.analysis ? (
        <ContractBalanceOutputs analysis={result.analysis} />
      ) : (
        <Section title="Contract-balance preview">
          <Notice tone="danger">
            {result.blockedReason ??
              "Billing and contract-balance workpaper has not been finalized."}
          </Notice>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Output</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>Billing schedule</td>
                <td className={td}>Not presented</td>
              </tr>
              <tr>
                <td className={td}>Monthly contract-balance rollforward</td>
                <td className={td}>Not presented</td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
