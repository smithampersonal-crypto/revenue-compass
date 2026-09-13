// @vitest-environment jsdom
/**
 * Phase 8C — Source Documents workspace behaviour.
 *
 * These tests exercise real user behaviour against the shared persistence
 * state: no ASC 606 engine behaviour is involved or changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import type { SourceDocumentSummaryDto } from "@/lib/arc/documents/types";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    createFileRoute: () => (options: unknown) => options,
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

const load = vi.fn();
const save = vi.fn();

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: (args: unknown) => save(args),
  finalizeRevision: vi.fn(),
  listRevisionHistory: vi.fn(),
  startNewRevision: vi.fn(),
  resetAmendmentDraft: vi.fn(),
  discardAmendmentDraft: vi.fn(),
}));

const loadWorkspace = vi.fn();
const attach = vi.fn();
const detach = vi.fn();
const editDetails = vi.fn();
const archive = vi.fn();
const hardDelete = vi.fn();

vi.mock("@/lib/arc/documents/workspace.functions", () => ({
  loadDocumentWorkspace: (args: unknown) => loadWorkspace(args),
  attachSourceDocument: (args: unknown) => attach(args),
  removeSourceDocument: (args: unknown) => detach(args),
  updateSourceDocumentDetails: (args: unknown) => editDetails(args),
  setSourceDocumentArchived: (args: unknown) => archive(args),
  deleteSourceDocument: (args: unknown) => hardDelete(args),
}));

const initiate = vi.fn();
const finalize = vi.fn();
const readUrl = vi.fn();

vi.mock("@/lib/arc/documents/documents.functions", () => ({
  initiateDocumentUpload: (args: unknown) => initiate(args),
  finalizeDocumentUpload: (args: unknown) => finalize(args),
  getDocumentReadUrl: (args: unknown) => readUrl(args),
}));

const uploadBytes = vi.fn();
vi.mock("@/lib/arc/documents/upload-client", () => ({
  uploadPdfToSignedTarget: (...args: unknown[]) => uploadBytes(...args),
}));

const { AnalysisProvider, useAnalysis } = await import("@/components/arc/analysis-context");
const { Route } = await import("@/routes/analysis/documents");

const DocumentsArea = (Route as unknown as { component: () => JSX.Element }).component;

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const DOC_A = "aaaaaaaa-1111-4111-8111-111111111111";
const DOC_B = "bbbbbbbb-2222-4222-8222-222222222222";
const DRAFT = createDemoDraftIfKnown("horizon")!;

function revision(overrides: Record<string, unknown> = {}) {
  return {
    contractId: CONTRACT_ID,
    contractTitle: "Saved contract",
    contractNumber: null,
    customerName: "Northwind",
    analysisId: "44444444-4444-4444-8444-444444444444",
    revisionId: REVISION_ID,
    revisionNumber: 2,
    status: "draft",
    lockVersion: 4,
    schemaVersion: "arc.workflow.v1",
    readOnly: false,
    draft: DRAFT,
    snapshot: null,
    supersedesRevisionId: null,
    ...overrides,
  };
}

function document(overrides: Partial<SourceDocumentSummaryDto> = {}): SourceDocumentSummaryDto {
  return {
    id: DOC_A,
    displayName: "Master Agreement",
    originalFilename: "master-agreement.pdf",
    documentType: "Master Agreement",
    effectiveDate: "2026-01-01",
    byteSize: 204_800,
    pageCount: 12,
    createdAt: "2026-09-01T00:00:00.000Z",
    archived: false,
    selected: true,
    inFinalizedHistory: false,
    metadataLocked: false,
    canDelete: true,
    ...overrides,
  };
}

function workspace(documents: SourceDocumentSummaryDto[], revisionOverrides = {}) {
  return {
    revision: {
      revisionId: REVISION_ID,
      revisionNumber: 2,
      status: "draft" as const,
      lockVersion: 4,
      canEditSources: true,
      ...revisionOverrides,
    },
    selected: documents.filter((entry) => entry.selected),
    library: documents,
  };
}

/** Lets a test make an ordinary accounting edit and observe the autosave. */
function AccountingEdit() {
  const { setDraft } = useAnalysis();
  return (
    <button
      type="button"
      onClick={() =>
        setDraft((previous) => ({
          ...previous,
          contract: { ...previous.contract, contractId: `edit-${Date.now()}` },
        }))
      }
    >
      Make accounting edit
    </button>
  );
}

function renderWorkspace(options: { sample?: string; guest?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider
        sample={options.sample}
        {...(options.sample || options.guest
          ? {}
          : { contractId: CONTRACT_ID, revisionId: REVISION_ID })}
        guest={options.guest ?? false}
      >
        <DocumentsArea />
        <AccountingEdit />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(revision());
  save.mockResolvedValue({
    ok: true,
    lockVersion: 99,
    savedAt: new Date().toISOString(),
  });
  loadWorkspace.mockResolvedValue(workspace([document()]));
  readUrl.mockResolvedValue({ url: "https://signed.example/doc.pdf", expiresInSeconds: 900 });
  vi.stubGlobal("open", vi.fn());
});

describe("Source Documents workspace", () => {
  it("renders the selected set and the contract library for a saved draft", async () => {
    renderWorkspace();
    expect(await screen.findByText("Selected for Revision 2")).toBeInTheDocument();
    expect(screen.getByText("Contract Document Library")).toBeInTheDocument();
    expect(screen.getByText("Documents supporting this draft analysis.")).toBeInTheDocument();
  });

  it("renders a finalized source set read-only", async () => {
    load.mockResolvedValue(revision({ status: "finalized", readOnly: true }));
    loadWorkspace.mockResolvedValue(
      workspace([document()], { status: "finalized", canEditSources: false }),
    );
    renderWorkspace();

    expect(
      await screen.findByText(
        "Sources used for finalized Revision 2. This source set is part of the finalized analysis and cannot be changed.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload PDF" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add from Contract Library" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove from revision" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View PDF" }).length).toBeGreaterThan(0);
  });

  it("treats zero selected sources as a normal state", async () => {
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    renderWorkspace();
    expect(
      await screen.findByText("No source documents are selected for this revision."),
    ).toBeInTheDocument();
  });

  it("adds a library document and advances the shared revision lock exactly once", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    attach.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Add to revision" }));

    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
    expect(attach).toHaveBeenCalledWith({
      data: { revisionId: REVISION_ID, sourceDocumentId: DOC_A, expectedLockVersion: 4 },
    });
  });

  it("makes the new lock version visible to the next accounting autosave", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    attach.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Add to revision" }));
    await waitFor(() => expect(attach).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Make accounting edit" }));
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 5000 });
    expect(save.mock.calls[0]![0].data.expectedLockVersion).toBe(5);
  });

  it("reloads authoritative state when an add is stale", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    attach.mockResolvedValue({
      ok: false,
      reason: "conflict",
      message: "This revision changed since this page was loaded",
    });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Add to revision" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed since this page");
  });

  it("removes only the association and advances the lock once", async () => {
    const user = userEvent.setup();
    detach.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Remove from revision" }));
    await waitFor(() => expect(detach).toHaveBeenCalledTimes(1));
    expect(detach).toHaveBeenCalledWith({
      data: { revisionId: REVISION_ID, sourceDocumentId: DOC_A, expectedLockVersion: 4 },
    });
    expect(hardDelete).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it("keeps the lock unchanged when a remove is a server-side no-op", async () => {
    const user = userEvent.setup();
    detach.mockResolvedValue({ ok: true, lockVersion: 4 });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Remove from revision" }));
    await waitFor(() => expect(detach).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Make accounting edit" }));
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 5000 });
    expect(save.mock.calls[0]![0].data.expectedLockVersion).toBe(4);
  });

  it("reloads authoritative state when a remove is stale", async () => {
    const user = userEvent.setup();
    detach.mockResolvedValue({
      ok: false,
      reason: "conflict",
      message: "This revision changed since this page was loaded",
    });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Remove from revision" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("uploads a new PDF and shows it in the revision", async () => {
    const user = userEvent.setup();
    initiate.mockResolvedValue({
      intentId: "33333333-3333-4333-8333-333333333333",
      bucket: "arc-source-documents",
      path: "pending/x.pdf",
      token: "token",
      expiresAt: new Date().toISOString(),
    });
    finalize.mockResolvedValue({
      ok: true,
      sourceDocumentId: DOC_B,
      duplicate: false,
      associated: true,
      associationConflict: false,
      lockVersion: 5,
    });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Upload PDF" }));
    await user.upload(
      screen.getByLabelText(/PDF file/i),
      new File(["%PDF-1.7"], "order-form.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload to Revision 2" }));

    await waitFor(() => expect(finalize).toHaveBeenCalled());
    expect(uploadBytes).toHaveBeenCalledTimes(1);
    expect(initiate.mock.calls[0]![0].data.displayName).toBe("order-form");
    expect(await screen.findByRole("status")).toHaveTextContent("added to Revision 2");
  });

  it("reuses an existing document for a duplicate upload", async () => {
    const user = userEvent.setup();
    initiate.mockResolvedValue({
      intentId: "33333333-3333-4333-8333-333333333333",
      bucket: "arc-source-documents",
      path: "pending/x.pdf",
      token: "token",
      expiresAt: new Date().toISOString(),
    });
    finalize.mockResolvedValue({
      ok: true,
      sourceDocumentId: DOC_A,
      duplicate: true,
      associated: true,
      associationConflict: false,
      lockVersion: 5,
    });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Upload PDF" }));
    await user.upload(
      screen.getByLabelText(/PDF file/i),
      new File(["%PDF-1.7"], "master-agreement.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload to Revision 2" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "This PDF was already in this contract and has been added to Revision 2.",
    );
    expect(screen.getAllByText("Master Agreement").length).toBe(2);
  });

  it("keeps an accepted upload in the library when association loses the lock race", async () => {
    const user = userEvent.setup();
    initiate.mockResolvedValue({
      intentId: "33333333-3333-4333-8333-333333333333",
      bucket: "arc-source-documents",
      path: "pending/x.pdf",
      token: "token",
      expiresAt: new Date().toISOString(),
    });
    finalize.mockResolvedValue({
      ok: true,
      sourceDocumentId: DOC_B,
      duplicate: false,
      associated: false,
      associationConflict: true,
      lockVersion: null,
    });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Upload PDF" }));
    await user.upload(
      screen.getByLabelText(/PDF file/i),
      new File(["%PDF-1.7"], "order-form.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload to Revision 2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "accepted into the Contract Document Library",
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("shows a validation rejection without recording anything", async () => {
    const user = userEvent.setup();
    initiate.mockResolvedValue({
      intentId: "33333333-3333-4333-8333-333333333333",
      bucket: "arc-source-documents",
      path: "pending/x.pdf",
      token: "token",
      expiresAt: new Date().toISOString(),
    });
    finalize.mockResolvedValue({
      ok: false,
      code: "password_protected",
      message: "This PDF is password-protected.",
    });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Upload PDF" }));
    await user.upload(
      screen.getByLabelText(/PDF file/i),
      new File(["%PDF-1.7"], "locked.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload to Revision 2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("password-protected");
  });

  it("requests a signed link with the document id only, and never stores it", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click((await screen.findAllByRole("button", { name: "View PDF" }))[0]!);
    await waitFor(() => expect(readUrl).toHaveBeenCalled());
    expect(readUrl).toHaveBeenCalledWith({
      data: { sourceDocumentId: DOC_A, disposition: "view" },
    });

    await user.click(screen.getAllByRole("button", { name: "Download" })[0]!);
    await waitFor(() => expect(readUrl).toHaveBeenCalledTimes(2));
    expect(readUrl.mock.calls[1]![0].data.disposition).toBe("download");

    expect(JSON.stringify(globalThis.localStorage)).not.toContain("signed.example");
    expect(save).not.toHaveBeenCalled();
  });

  it("edits document details while they are still editable", async () => {
    const user = userEvent.setup();
    editDetails.mockResolvedValue({ ok: true, lockVersion: null });
    renderWorkspace();

    const library = (await screen.findByText("Contract Document Library")).closest("section")!;
    await user.click(within(library).getByRole("button", { name: "Edit details" }));
    const name = screen.getByLabelText(/Document name/i);
    await user.clear(name);
    await user.type(name, "Master Agreement (executed)");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(editDetails).toHaveBeenCalled());
    expect(editDetails.mock.calls[0]![0].data.displayName).toBe("Master Agreement (executed)");
  });

  it("locks details for a document used by finalized history", async () => {
    loadWorkspace.mockResolvedValue(
      workspace([document({ inFinalizedHistory: true, metadataLocked: true, canDelete: false })]),
    );
    renderWorkspace();

    const library = (await screen.findByText("Contract Document Library")).closest("section")!;
    expect(within(library).getByRole("button", { name: "Edit details" })).toBeDisabled();
    expect(
      screen.getByText(
        /details are locked because it is part of finalized analysis history/i,
      ),
    ).toBeInTheDocument();
  });

  it("hides archived documents until they are requested", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(
      workspace([
        document({ selected: false }),
        document({
          id: DOC_B,
          displayName: "Old exhibit",
          archived: true,
          selected: false,
        }),
      ]),
    );
    renderWorkspace();

    expect(await screen.findByText("Master Agreement")).toBeInTheDocument();
    expect(screen.queryByText("Old exhibit")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Show archived documents"));
    expect(screen.getByText("Old exhibit")).toBeInTheDocument();
  });

  it("keeps an archived document visible inside a historical source set", async () => {
    loadWorkspace.mockResolvedValue(
      workspace(
        [document({ archived: true, selected: true, inFinalizedHistory: true, canDelete: false })],
        { status: "superseded", canEditSources: false },
      ),
    );
    load.mockResolvedValue(revision({ status: "superseded", readOnly: true }));
    renderWorkspace();

    const selected = (await screen.findByText("Selected for Revision 2")).closest("section")!;
    expect(within(selected).getByText("Master Agreement")).toBeInTheDocument();
  });

  it("archives and unarchives through the trusted operation", async () => {
    const user = userEvent.setup();
    archive.mockResolvedValue({ ok: true, lockVersion: null });
    renderWorkspace();

    await user.click((await screen.findAllByRole("button", { name: "Archive" }))[0]!);
    await waitFor(() => expect(archive).toHaveBeenCalled());
    expect(archive).toHaveBeenCalledWith({ data: { sourceDocumentId: DOC_A, archived: true } });
  });

  it("permanently deletes an eligible document after confirmation", async () => {
    const user = userEvent.setup();
    hardDelete.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderWorkspace();

    await user.click((await screen.findAllByRole("button", { name: "Delete permanently" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(hardDelete).toHaveBeenCalled());
    expect(hardDelete.mock.calls[0]![0].data.sourceDocumentId).toBe(DOC_A);
  });

  it("refuses permanent deletion for a document in finalized history", async () => {
    loadWorkspace.mockResolvedValue(
      workspace([document({ inFinalizedHistory: true, metadataLocked: true, canDelete: false })]),
    );
    renderWorkspace();

    expect(
      (await screen.findAllByRole("button", { name: "Delete permanently" }))[0]!,
    ).toBeDisabled();
    expect(
      screen.getByText(/supports finalized analysis history and cannot be permanently deleted/i),
    ).toBeInTheDocument();
  });

  it("reloads instead of claiming success when deletion is ambiguous", async () => {
    const user = userEvent.setup();
    hardDelete.mockRejectedValue(new Error("network"));
    renderWorkspace();

    await user.click((await screen.findAllByRole("button", { name: "Delete permanently" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("never creates persistent document ownership for a sample analysis", async () => {
    renderWorkspace({ sample: "horizon" });

    expect(
      await screen.findByText("Source Documents are available for saved analyses."),
    ).toBeInTheDocument();
    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(initiate).not.toHaveBeenCalled();
  });
});
