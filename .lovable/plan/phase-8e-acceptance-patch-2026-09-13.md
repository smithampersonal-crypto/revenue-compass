# ARC Phase 8E — Acceptance Patch
## Migrated PDF Access, My Contracts Upload, Existing-Customer Save, and Draft Deletion

> **For Lovable / agentic implementation:** Use test-driven development. Write the failing regression first for each task, verify that it fails for the intended reason, make the minimum implementation change, rerun the focused test, then run the complete ARC verification suite.
>
> This is a **Phase 8E acceptance patch**, not Phase 8F. Do not begin scheduled cleanup, AI/OCR, persistent PDF text extraction, embeddings, Excel export, or any accounting-engine work.

## Goal

Close the four remaining Phase 8E product gaps:

1. A PDF uploaded in a temporary/guest analysis must remain Viewable/Downloadable after that same analysis is saved into an authenticated account.
2. **My Contracts → Add a contract** must provide an **Upload Contract PDF** path using ARC's existing Phase 8B/8E temporary-document pipeline.
3. **Save to My Contracts** must allow a signed-in user to save an unsaved analysis under an existing customer rather than always creating a duplicate customer.
4. Draft, unfinalized saved analyses must have an appropriate destructive action from **My Contracts → Saved analyses**:
   - Revision 1 with no finalized history: **Delete draft**
   - Later amendment draft with finalized history: **Discard draft**

## Architecture

Keep the accepted document architecture intact:

- `source_documents` remains the durable metadata row.
- Private object bytes stay in `arc-source-documents`.
- Guest/unsaved ownership uses `guest_workspace_id`.
- Saved ownership uses `contract_id`.
- Guest → account save moves the same document rows to the Contract; it does **not** copy/re-upload blobs.
- `revision_source_documents` remains the normalized saved-revision provenance relationship.
- Storage deletion remains durable through `storage_deletion_queue`.
- Browser actions pass IDs only. Authorization remains server/database authoritative.

Do not create a second PDF upload implementation for My Contracts.

## Existing code to preserve

Current relevant areas include:

- `src/routes/_authenticated/workspace.tsx`
  - My Contracts UI
  - Add customer
  - Add contract
  - Saved analyses
- `src/components/arc/GuestSavePanel.tsx`
  - explicit unsaved-analysis → My Contracts flow
- `src/lib/arc/persistence/guest.functions.ts`
- `src/lib/arc/persistence/guest.handlers.ts`
- `src/lib/arc/persistence/workspace.functions.ts`
- `src/lib/arc/documents/documents.handlers.ts`
- `src/lib/arc/documents/documents.store.server.ts`
- `src/lib/arc/documents/GuestSourceDocumentsWorkspace.tsx`
- `src/lib/arc/documents/workspace.store.server.ts`
- `supabase/tests/phase8e_guest_documents.sql`
- Phase 8E/8B document integration tests
- existing amendment discard lifecycle

Use the repository's exact current paths if any file has moved.

---

# Task 1 — Prove and fix migrated PDF authenticated access

## Problem

ARC accepts a valid PDF in a temporary workspace. Phase 8E migration moves the same `source_documents` row from `guest_workspace_id` to `contract_id`.

After saving the analysis into an authenticated account, the same PDF must still support **View** and **Download**.

The accepted PDF itself is not the issue: this must work for any Phase 8B-valid text PDF.

The current unit coverage proves guest document access, migration ownership, and authenticated document access separately. It does **not** prove the complete ownership-transition seam.

## First action: reproduce before changing implementation

Write a failing integration regression that exercises this exact lifecycle:

```text
temporary workspace exists
-> valid PDF/document row belongs to guest workspace
-> guest credential can obtain a signed read URL
-> migrate workspace into authenticated owner
-> source document keeps SAME id
-> source document keeps SAME storage_object_path
-> source document now has contract_id
-> guest_workspace_id is null
-> authenticated owner requests View/Download for SAME document id
-> signed read URL succeeds
-> retired guest credential can no longer request the document
```

Do not replace this with separate mocks that merely assert two independent functions were called.

The regression must cross the actual migration/authenticated-read boundary far enough to identify which layer fails.

## Trace the failing boundary

Before changing code, determine which assertion fails:

```text
A. document migration row ownership
B. owner derivation through document -> contract -> customer
C. authenticated document lookup
D. signed URL creation
E. browser/client state after navigation
```

Report the identified root cause in the completion report.

Do **not** assume `findOwnedDocument()` is wrong just because it is the first obvious seam. Fix the proven boundary.

## Security invariants

After the fix:

- authenticated User A can read User A's migrated PDF;
- authenticated User B cannot read it;
- the retired guest credential cannot read it;
- no storage path is exposed to the browser;
- same `source_document.id`;
- same `storage_object_path`;
- same SHA-256;
- no replacement row;
- no blob copy/re-upload.

Add both **View** and **Download** coverage if they use distinguishable handler behavior.

---

# Task 2 — Save an unsaved analysis under an existing customer

## Product behavior

A signed-in user saving an unsaved analysis should not be forced to create another Customer.

Update the save panel to present two explicit choices when authenticated:

```text
Save to My Contracts

Customer
(•) Existing customer
    [ Customer dropdown ]

( ) Create new customer
    [ Customer name ]

Contract title
[ ... ]

Contract number
[ ... if currently part of the saved draft behavior ... ]

[ Save to My Contracts ]
```

If the account has no customers, default to **Create new customer**.

The current draft's customer name may be used as a starting value for a new Customer, but it must not silently create a new row when the user selected an existing Customer.

## Lightweight customer choices

Do not load the full My Contracts hierarchy merely to populate this selector if a smaller caller-scoped query is cleaner.

A suitable interface is:

```ts
export interface CustomerChoiceDto {
  id: string;
  name: string;
}

export const listCustomerChoices = ...
```

The server must return only customers owned by the authenticated caller.

## Migration request

Extend the save request with an optional existing customer ID:

```ts
{
  contractTitle: string;
  expectedLockVersion: number;
  existingCustomerId?: string;
  newCustomerName?: string;
}
```

Do not trust `existingCustomerId`.

The trusted migration transaction must verify:

```text
existing customer exists
AND existing customer.owner_user_id = authenticated user
```

before attaching the new Contract.

### Exactly one customer mode

The server/database contract must enforce one of:

```text
existingCustomerId != null
newCustomerName == null/blank
```

or:

```text
existingCustomerId == null
newCustomerName is nonblank
```

Reject ambiguous requests that supply both or neither.

## Database migration strategy

Use a new additive migration.

Preserve the existing guest-migration retry/idempotency semantics.

Do not leave two conflicting live implementations where response-loss retry could choose a different Customer on the second call.

A good structure is:

```text
credential/token wrapper
-> validates expected guest lock / existing migrated result
-> trusted migration transaction accepts one customer mode
-> if workspace already migrated, returns the ORIGINAL saved IDs
```

If the existing migration RPC signature is already deployed and changing it would leave an unwanted overload, add a new clearly named trusted RPC and have the application use it. Keep old functions only when required for migration compatibility/tests.

## Idempotency requirement

This must be true:

```text
first request:
  existingCustomerId = Customer A
  migration commits
  response is lost

retry:
  request reaches migrated guest workspace
  returns original Customer A / Contract / Analysis / Revision
  does NOT create Customer B
  does NOT create a second Contract
```

The same rule applies to "Create new customer".

## Tests

Add database and application regressions proving:

1. save under owned existing customer;
2. no new `customers` row is inserted in existing-customer mode;
3. create-new mode still creates one customer;
4. another user's customer ID is rejected;
5. both modes supplied is rejected;
6. neither mode supplied is rejected;
7. response-loss retry returns the original saved hierarchy;
8. document migration behavior remains exact;
9. selected guest PDFs become Revision 1 sources;
10. unselected guest PDFs become Contract-library documents only.

---

# Task 3 — Add "Upload Contract PDF" to My Contracts

## Product design

In:

```text
My Contracts
  Add a contract
```

provide two clear creation paths:

```text
Create manually
Upload Contract PDF
```

Do not build a second upload dialog/pipeline.

The upload path must reuse the same temporary workspace + private Phase 8B upload pipeline already used by Home/Source Documents.

## Customer selection

The existing **Customer** selector in Add a contract is useful context.

When the user chooses **Upload Contract PDF**:

- retain the selected customer as a **preselection hint** for the later Save to My Contracts panel;
- do not treat a URL-provided/browser-provided customer ID as authorization;
- the save transaction must still perform the ownership check described in Task 2.

If carrying the hint through route search is the smallest implementation, add an optional search value such as:

```ts
customer?: string
```

to `/analysis`.

It is only a UI hint.

The server remains authoritative.

## Upload flow

Expected user journey:

```text
My Contracts
-> select Customer A
-> Upload Contract PDF
-> normal temporary ASC 606 analysis opens
-> existing shared PDF upload flow opens
-> PDF is uploaded to the guest/unsaved workspace
-> analysis remains editable
-> Save to My Contracts panel defaults to Existing Customer = Customer A
-> user confirms
-> same PDF rows migrate to the new Contract under Customer A
-> no re-upload
```

If no customer was selected, open the same upload flow without a preselection.

Do not create a permanent empty Contract merely to obtain a `contract_id` before the PDF upload succeeds.

## UI requirements

On My Contracts:

- keep manual contract creation;
- add an obvious **Upload Contract PDF** control in the Add a contract section;
- button is keyboard accessible;
- do not hide it on hover;
- explain briefly that ARC keeps the PDF with the analysis but does not yet automatically create accounting judgments from it.

Do not imply AI contract extraction exists in Phase 8E.

## Tests

Add UI regressions proving:

```text
Upload Contract PDF appears in Add a contract
click preserves selected customer hint
temporary analysis opens
shared upload route/workspace is used
Save to My Contracts preselects the hinted customer
```

Also prove a malicious/foreign customer hint is harmless because the server rejects ownership during save.

---

# Task 4 — Add safe draft deletion/discard actions to My Contracts

## Product semantics

The Saved analyses list needs contextual destructive actions.

### A. Initial Revision 1 draft with no finalized history

Show:

```text
Delete draft
```

This deletes the saved Contract analysis hierarchy because there is no historical accounting record to preserve.

The **Customer row remains**.

### B. Amendment draft when finalized history exists

Show:

```text
Discard draft
```

Use the already-accepted amendment-draft lifecycle.

This removes only the active amendment draft and returns the Contract to its existing finalized revision.

Do not delete the Contract or its source-document library in this case.

## Do not infer safety only in the browser

The database/server must verify whether the Contract is eligible for full draft deletion.

For **Delete draft**, require all of the following under the trusted transaction:

```text
caller owns the Contract
analysis exists for Contract
current_finalized_revision_id IS NULL
NO analysis_revisions status in ('finalized', 'superseded')
draft exists
draft.revision_number = 1
```

If historical revision rows exist, fail closed.

Do not use the UI label as authority.

## Storage cleanup for initial draft deletion

Deleting the Contract cascades:

```text
contract
-> analysis
-> draft revision
-> revision_source_documents
-> source_documents
-> upload intents
```

The relational cascade is not enough because private Storage objects live outside PostgreSQL.

Before deleting the Contract, enqueue every relevant private path in `storage_deletion_queue`.

At minimum consider:

```text
source_documents.storage_bucket + storage_object_path
document_upload_intents.pending_object_path
document_upload_intents.permanent_object_path when populated
```

Use the existing bucket/path unique queue semantics so duplicate queue attempts are idempotent.

Queue before relational ownership disappears.

Do not directly depend on immediate Storage deletion for correctness.

Physical deletion remains the existing durable cleanup responsibility.

## Transaction

Create a trusted RPC for initial-draft Contract deletion.

A suitable conceptual result is:

```ts
{
  deletedContractId: string
}
```

The transaction must be all-or-nothing:

```text
authorize
-> verify no history
-> lock required rows
-> queue storage paths
-> delete Contract
-> cascades remove relational draft/document rows
-> return
```

If queue insertion fails, do not delete the Contract.

## Concurrency

A simultaneous Finalize must not allow the initial draft to be deleted after it becomes history.

Use row locks and revalidation.

Recommended lock direction:

```text
Contract / Analysis
-> active Draft Revision
-> relevant source-document rows in deterministic id order
```

Then re-check no finalized/superseded history before deleting.

Do not introduce a lock order that conflicts with the accepted Phase 8D revision -> source-document ordering.

## UI confirmation

`Delete draft` needs a destructive confirmation dialog.

Suggested copy:

```text
Delete this draft analysis?

This draft has never been finalized. Deleting it will remove the saved contract analysis and its uploaded source documents. The customer will remain.

This cannot be undone.
```

For amendment drafts, use the existing Discard semantics/copy rather than pretending the entire Contract will be deleted.

## Workspace list model

`listWorkspace()` currently reports:

```ts
kind: "draft" | "finalized" | "none"
revisionId
revisionNumber
nextRevisionNumber
```

Extend its DTO only as necessary to let the UI distinguish:

```text
initial draft with no history
vs
amendment draft over finalized history
```

Prefer an explicit server-derived flag/state over reconstructing historical safety from scattered client assumptions.

For example:

```ts
draftAction: "delete-initial-draft" | "discard-amendment" | null
```

The action remains advisory for rendering; the destructive RPC must revalidate everything.

## Tests

Database regressions must prove:

1. owner can delete initial Revision 1 draft;
2. another user cannot;
3. Customer survives;
4. Contract is deleted;
5. Analysis/draft associations are deleted by cascade;
6. every source-document permanent path was queued first;
7. pending upload paths are not orphaned;
8. document rows are gone after Contract deletion;
9. finalized/superseded history blocks full Contract deletion;
10. amendment draft cannot use initial-draft deletion;
11. existing amendment Discard preserves Contract + finalized revisions + Contract documents;
12. failed queueing prevents relational deletion;
13. concurrent-state revalidation fails closed if history appeared.

Application regressions must prove:

```text
Revision 1 draft -> Delete draft visible
finalized-only -> no Delete draft
Revision 2+ draft over finalized history -> Discard draft visible
Delete draft confirmation cancel -> no mutation
Delete draft confirm -> workspace list refreshes and row disappears
Discard draft -> existing finalized contract remains and reloads
```

---

# Task 5 — End-to-end acceptance regressions

Add a focused Phase 8E integration set that proves the user journeys rather than only implementation helpers.

## Journey A — guest PDF becomes authenticated PDF

```text
upload guest PDF
view works as guest
save under account
same doc id/path/hash
view works as authenticated owner
download works as authenticated owner
old guest access fails
```

## Journey B — My Contracts PDF-first save under existing customer

```text
Customer A already exists
My Contracts -> Upload Contract PDF
upload succeeds in unsaved workspace
Save to My Contracts defaults to Customer A
confirm
no second customer created
new Contract belongs to Customer A
document moves without copy
Revision 1 source selection is correct
```

## Journey C — initial saved draft deletion

```text
saved Revision 1 draft
one or more PDFs
Delete draft
confirm
Contract row disappears from My Contracts
Customer remains
document paths are queued
```

## Journey D — amendment discard

```text
Revision 1 finalized
Revision 2 draft exists
My Contracts shows Discard draft
discard
Revision 1 remains finalized/current
Contract documents remain
Revision 2 associations disappear with draft
```

---

# Scope exclusions

Do **not** implement in this patch:

- OCR
- AI contract extraction
- AI accounting judgments
- persistent extracted/page text
- vector embeddings
- Excel export
- scheduled deletion worker changes beyond using the existing queue
- account deletion redesign
- Phase 8F cleanup expansion
- changes to deterministic `src/lib/asc606*`
- sample accounting changes
- source document duplication/snapshot rows
- automatic migration merely because a user signs in
- a second PDF upload subsystem

Do not change Home-page product behavior in this patch unless required for a shared bug fix. The approved correction here is specifically the four acceptance gaps above.

---

# Required verification

Run the repository's canonical focused tests while implementing, then run fresh full verification.

At minimum:

```bash
bun run db:test
bun run verify
```

Also run the focused test files for:

- guest migration;
- document access;
- My Contracts/workspace;
- guest save panel;
- Phase 8E guest documents;
- draft lifecycle/deletion.

Use the actual package scripts/paths from the repository where they differ.

Require **both GitHub Actions jobs green** on the exact final version.

## Completion report must include

Return all of the following:

1. **Migrated PDF root cause** — exact failing boundary found.
2. Exact regression proving guest -> authenticated View/Download.
3. Confirmation same document ID/path/hash survives migration.
4. Confirmation old guest credential loses access.
5. Existing-customer migration design and authorization behavior.
6. Confirmation response-loss retry cannot duplicate Customer/Contract/documents.
7. My Contracts Upload Contract PDF behavior.
8. Initial Revision 1 Delete draft behavior.
9. Amendment Discard draft behavior.
10. Exact storage paths queued before initial Contract deletion.
11. Exact new database assertion count.
12. Exact relevant application-test count.
13. Total application tests/files.
14. Typecheck result.
15. Lint result.
16. Build result.
17. Bundle audit result.
18. Full database suite result.
19. Confirmation no deterministic ASC 606 engine/sample/Phase 8F changes.
20. Updated repository ZIP for director review.

Then stop.

Do not begin Phase 8F.
