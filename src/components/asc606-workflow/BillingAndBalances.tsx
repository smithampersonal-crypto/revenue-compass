import {
  createCashCollectionDraft,
  createConsiderationEventDraft,
  nextId,
  nextSeq,
  type CashCollectionDraft,
  type ConsiderationAmountSource,
  type ConsiderationEventDraft,
  type ContractBalanceWorkflowResult,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Field, inputClass, IssueList, Notice, Section } from "./fields";

/**
 * Post-ASC-606 accounting workpaper stage. React collects input strings and
 * displays deterministic engine output; it performs no balance accounting.
 * The balance workflow result and contract groups are evaluated once by the
 * Contract Balances parent and passed in.
 */
export function BillingAndBalances({
  draft,
  onChange,
  balances,
  contractGroups,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
  balances: ContractBalanceWorkflowResult;
  contractGroups: WorkflowAnalysisResult["contractGroups"];
}) {
  const { considerationEvents, cashCollections } = draft.contractBalances;
  // Phase 5B: a billing amount may be taken directly from the deterministic
  // variable-consideration engine instead of being re-entered.
  const vcComponents = draft.hasVariableConsideration ? draft.variableConsiderationComponents : [];
  const result = balances;
  // Phase 5C: when a modification produced more than one contract, each billing
  // event must name the contract it belongs to. The list of contracts is engine
  // output; React only renders it.
  const needsContractLink = contractGroups.length > 1;

  const setEvents = (events: ConsiderationEventDraft[]) =>
    onChange({
      ...draft,
      contractBalances: { ...draft.contractBalances, considerationEvents: events },
    });
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
              <span className="font-semibold">Unbilled AR</span> — an unconditional right exists,
              but the customer has not yet been invoiced.
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
                {needsContractLink ? (
                  <Field label="Contract">
                    <select
                      className={inputClass}
                      value={event.contractGroupId ?? ""}
                      onChange={(e) => updateEvent(event.id, { contractGroupId: e.target.value })}
                    >
                      <option value="">Select a contract…</option>
                      {contractGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {vcComponents.length > 0 ? (
                  <Field label="Amount source">
                    <select
                      className={inputClass}
                      value={event.amountSource ?? "manual"}
                      onChange={(e) =>
                        updateEvent(event.id, {
                          amountSource: e.target.value as ConsiderationAmountSource,
                        })
                      }
                    >
                      <option value="manual">Entered amount</option>
                      <option value="estimated_component">
                        Variable-consideration component (engine amount)
                      </option>
                      <option value="usage_period">Usage month (engine amount)</option>
                    </select>
                  </Field>
                ) : null}

                {(event.amountSource ?? "manual") === "manual" ? (
                  <Field label="Amount (USD)">
                    <input
                      className={inputClass}
                      value={event.amountInput}
                      onChange={(e) => updateEvent(event.id, { amountInput: e.target.value })}
                      placeholder="60,000.00"
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Variable-consideration component">
                      <select
                        className={inputClass}
                        value={event.sourceComponentId ?? ""}
                        onChange={(e) =>
                          updateEvent(event.id, { sourceComponentId: e.target.value || null })
                        }
                      >
                        <option value="">Select a component…</option>
                        {vcComponents.map((component) => (
                          <option key={component.id} value={component.id}>
                            {component.description || component.id}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {event.amountSource === "usage_period" ? (
                      <Field label="Usage month">
                        <input
                          type="month"
                          className={inputClass}
                          value={event.sourceMonth ?? ""}
                          onChange={(e) => updateEvent(event.id, { sourceMonth: e.target.value })}
                        />
                      </Field>
                    ) : null}
                  </>
                )}
                <Field label="Unconditional right date">
                  <input
                    type="date"
                    className={inputClass}
                    value={event.unconditionalRightDate}
                    onChange={(e) =>
                      updateEvent(event.id, { unconditionalRightDate: e.target.value })
                    }
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
        title="Resolve these items to complete the contract-balance workpaper"
        issues={result.validation.blocking}
      />
      <IssueList
        title="Contract-balance warnings"
        tone="warning"
        issues={result.validation.warnings}
      />
    </div>
  );
}
