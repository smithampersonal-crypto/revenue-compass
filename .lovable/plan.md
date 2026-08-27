# ASC 606 SaaS Revenue Recognition — MVP Plan

## 1. Understanding

A portfolio-grade web app that takes the facts of a fixed-fee SaaS contract, walks an accountant through the five ASC 606 steps, and produces deterministic outputs: SSP allocation, a monthly revenue schedule, a deferred revenue / contract asset waterfall, illustrative journal entries, documented judgments, and reconciliation checks. No AI in the math. All data fictional. Look and feel: dense, light, table-first accounting software.

## 2. Architecture in plain English

Three clearly separated layers:

1. **Inputs (facts + judgments)** — what the accountant types: contract terms, promises, SSPs, distinctness conclusions, billing schedule, judgment notes.
2. **Engine (pure calculations)** — plain TypeScript functions that take inputs and return schedules. No database calls, no AI, no UI code inside. This is what makes results testable and auditable.
3. **Presentation (pages, tables, tabs)** — displays engine output; never does arithmetic itself.

```text
Contract inputs ──> ASC 606 engine (pure functions) ──> Schedules / JEs / checks
   (later: AI extraction feeds inputs only, never the engine)
```

**Storage recommendation (default):** build Phase 1–4 with in-memory/local data and seeded sample contracts, then add Lovable Cloud (managed Postgres) in a later phase to persist contracts. Reason: the engine and UI can be finished and verified without any backend complexity, and the schema is designed up front so the switch is additive, not a rewrite. Lovable Cloud gives you a real Postgres you can query with SQL for the SQL-demonstration goal.

**Stack:** React + TanStack Router (already set up), TypeScript, Tailwind, engine in `src/lib/asc606/`, unit tests with Vitest.

## 3. Pages and flow

- `/` **Dashboard** — short portfolio intro, disclaimer, list of sample contracts, "Create Contract" button.
- `/contracts/new` **Five-step wizard** — Step 1 Contract criteria → Step 2 Promises & POs → Step 3 Transaction price & billing → Step 4 Allocation (calculated, read-only) → Step 5 Recognition pattern. Progress rail on the left; state held in one contract draft object so back/forward never loses data; live validation panel visible throughout.
- `/contracts/$id` **Results** — tabs: Summary · Performance Obligations · Allocation · Revenue Schedule · Waterfall · Journal Entries · Judgments · Validation.
- `/methodology` — plain-English explanation of the engine's conventions (day-count, mid-month handling, rounding), useful for interviews.

## 4. Data model

```text
contracts(id, customer_name, contract_number, start_date, end_date,
          total_transaction_price, currency, step1_criteria (5 booleans),
          step1_notes, status, created_at)

contract_promises(id, contract_id, description, category, ssp,
                  is_distinct, distinct_rationale, is_separate_po)

performance_obligations(id, contract_id, promise_id, name, ssp,
                        allocation_pct, allocated_price,
                        recognition_method ('over_time_ratable'|'point_in_time'),
                        service_start, service_end, poc_date)

billing_events(id, contract_id, billing_date, amount, description)

revenue_schedule(id, contract_id, po_id, period_month, revenue_amount)   -- engine output

accounting_judgments(id, contract_id, issue, conclusion, reasoning, asc_citation)

journal_entries(id, contract_id, period_month, line_no, account, debit, credit, memo)
```

Notes: money stored as integer cents to avoid floating-point drift; `revenue_schedule` and `journal_entries` are derived and always regenerable from inputs.

## 5. Engine structure (`src/lib/asc606/`)

- `types.ts` — input/output types.
- `money.ts` — cents arithmetic, rounding, largest-remainder penny reconciliation so totals tie exactly.
- `allocation.ts` — relative SSP: `pct = ssp / totalSSP`, allocate transaction price, force the sum to equal the total by assigning the residual penny to the largest PO.
- `recognition.ts` — per PO: point-in-time → full amount in the recognition month; over-time ratable → allocated price × (days in month ∩ service period) ÷ total service days, aggregated by calendar month.
- `waterfall.ts` — per month: beginning balance + billings − revenue = ending balance; positive ending = contract liability, negative = contract asset.
- `journalEntries.ts` — derives JE lines from billings and revenue per month.
- `validation.ts` — all reconciliation checks, returns a list of `{id, severity, message, passed}`; "All Accounting Checks Passed" when every check passes.
- Each file gets a Vitest test file with the sample contract plus edge cases (mid-month start, one-day PO, uneven pennies).

## 6. Build order

1. Design system + shell (light, neutral, dense tables) and Dashboard with the sample contract.
2. Engine + unit tests (allocation → recognition → waterfall → JEs → validation), verified before any wizard UI.
3. Results page tabs driven by the engine using the seeded sample contract.
4. Five-step wizard with live validation, writing into the same contract object.
5. Judgments editor + validation status banner.
6. Lovable Cloud persistence (schema above, CRUD, list of saved contracts), plus 2–3 more sample contracts.
7. Polish: CSV export of schedules, print-friendly results, methodology page.

## 7. Assumptions to confirm

- **Day-count convention:** actual calendar days (a 31-day month gets more revenue than a 30-day one). Alternative is equal monthly amounts with stub-month proration. Default: actual days.
- **Rounding:** cents, largest-remainder so schedules tie exactly to the penny.
- **Sample contract:** SaaS $120,000 SSP over-time 1/1/27–12/31/27, Training $20,000 SSP point-in-time 1/15/27, total consideration $120,000 → allocation SaaS $102,857.14 / Training $17,142.86 (implicit $20,000 discount allocated on relative SSP).
- **Billing:** AR is recorded on the billing date; cash receipts are out of scope for V1.
- **Reporting periods:** calendar months only, no fiscal-calendar option.
- **Contract asset presentation:** single net contract balance per contract (not per PO) in V1.

## 8. Explicitly postponed

PDF upload and AI extraction; variable consideration; usage pricing; material rights and renewal options; modifications; financing components; FX; refunds and terminations; SSP estimation techniques; authentication and multi-user; ERP integration; multi-entity or fiscal calendars.

## 9. Risks for a non-developer

- **Penny reconciliation** is the most common source of "off by $0.01" failures — handled centrally in `money.ts`, never ad hoc.
- **Date/timezone bugs** (a 1/1 date rendering as 12/31) — dates handled as plain `YYYY-MM-DD` strings, never JS `Date` with timezones.
- **Logic leaking into UI** — if arithmetic ever appears inside a component, the tests stop protecting you; the engine boundary must stay strict.
- **Scope creep** into variable consideration or modifications; each would substantially change the engine.
- **Database step** is where most non-developers get stuck; it's deliberately last and additive.

## 10. Phases

- **Phase 0** — design system, shell, dashboard skeleton.
- **Phase 1** — engine + unit tests against the sample contract.
- **Phase 2** — Results page (all eight tabs), read-only, sample data.
- **Phase 3** — five-step wizard with state preservation and live validation.
- **Phase 4** — judgments, validation banner, additional sample contracts.
- **Phase 5** — Lovable Cloud persistence and saved-contract list.
- **Phase 6** — exports, print view, methodology page, final polish.

Each phase ends in a working, reviewable app.
