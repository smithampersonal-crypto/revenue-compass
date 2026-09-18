// @vitest-environment jsdom
/**
 * Phase 8E — Source Documents on a temporary (unsaved) analysis.
 *
 * These tests exercise the visitor's real behaviour against the shared
 * temporary lock version. No ASC 606 engine behaviour is involved or changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
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

const resume = vi.fn();
const saveGuest = vi.fn();

vi.mock("@/lib/arc/persistence/guest.functions", () => ({
  resumeGuestWorkspace: (args: unknown) => resume(args),
  saveGuestDraft: (args: unknown) => saveGuest(args),
}));

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
  finalizeRevision: vi.fn(),
  listRevisionHistory: vi.fn(),
  startNewRevision: vi.fn(),
  resetAmendmentDraft: vi.fn(),
  discardAmendmentDraft: vi.fn(),
}));

const loadWorkspace = vi.fn();
const attach = vi.fn();
const detach = vi.fn();
const hardDelete = vi.fn();
const readUrl = vi.fn();
const initiate = vi.fn();
const finalize = vi.fn();

vi.mock("@/lib/arc/documents/guest-documents.functions", () => ({
  loadGuestDocumentWorkspace: (args?: unknown) => loadWorkspace(args),
  attachGuestSourceDocument: (args: unknown) => attach(args),
  removeGuestSourceDocument: (args: unknown) => detach(args),
  deleteGuestSourceDocument: (args: unknown) => hardDelete(args),
  getGuestDocumentReadUrl: (args: unknown) => readUrl(args),
  initiateGuestDocumentUpload: (args: unknown) => initiate(args),
  finalizeGuestDocumentUpload: (args: unknown) => finalize(args),
}));

const uploadBytes = vi.fn();
vi.mock("@/lib/arc/documents/upload-client", () => ({
  uploadPdfToSignedTarget: (...args: unknown[]) => uploadBytes(...args),
}));

const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { GuestSourceDocumentsWorkspace } =
  await import("@/components/arc/documents/GuestSourceDocumentsWorkspace");

const DOC_A = "aaaaaaaa-1111-4111-8111-111111111111";
const DOC_B = "bbbbbbbb-2222-4222-8222-222222222222";
const DRAFT = createDemoDraftIfKnown("horizon")!;
const EXPIRES = "2026-09-13T12:00:00.000Z";

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

function workspace(documents: SourceDocumentSummaryDto[]) {
  return {
    lockVersion: 4,
    expiresAt: EXPIRES,
    selected: documents.filter((entry) => entry.selected),
    library: documents,
  };
}

function guestTree(props: {
  autoOpenUpload?: boolean;
  onAutoOpenUploadConsumed?: () => void;
  client: QueryClient;
}) {
  const { client, ...rest } = props;
  return (
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} guest>
        <GuestSourceDocumentsWorkspace {...rest} />
      </AnalysisProvider>
    </QueryClientProvider>
  );
}

function renderGuest(
  props: { autoOpenUpload?: boolean; onAutoOpenUploadConsumed?: () => void } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(guestTree({ ...props, client }));
  return {
    ...view,
    rerenderGuest: (next: { autoOpenUpload?: boolean; onAutoOpenUploadConsumed?: () => void }) =>
      view.rerender(guestTree({ ...next, client })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resume.mockResolvedValue({
    kind: "guest",
    draft: DRAFT,
    lockVersion: 4,
    schemaVersion: "arc.workflow.v1",
    expiresAt: EXPIRES,
  });
  saveGuest.mockResolvedValue({ ok: true, lockVersion: 99, savedAt: new Date().toISOString() });
  loadWorkspace.mockResolvedValue(workspace([document()]));
  attach.mockResolvedValue({ ok: true, lockVersion: 5 });
  detach.mockResolvedValue({ ok: true, lockVersion: 5 });
  hardDelete.mockResolvedValue({ ok: true, lockVersion: 5 });
  readUrl.mockResolvedValue({ url: "https://signed.example/doc.pdf", expiresInSeconds: 900 });
  vi.stubGlobal("open", vi.fn());
});

describe("Temporary workspace source documents", () => {
  it("uses temporary-workspace wording and never a contract library", async () => {
    renderGuest();
    expect(await screen.findByText("Included in this analysis")).toBeInTheDocument();
    expect(screen.getByText("Other uploaded PDFs")).toBeInTheDocument();
    expect(screen.queryByText("Contract Document Library")).not.toBeInTheDocument();
  });

  it("treats an empty analysis as a normal state", async () => {
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    renderGuest();
    expect(
      await screen.findByText("No source documents are included in this analysis yet."),
    ).toBeInTheDocument();
  });

  it("adds an uploaded PDF with the shared temporary lock version", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    attach.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderGuest();

    await user.click(await screen.findByRole("button", { name: "Add to this analysis" }));

    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
    expect(attach).toHaveBeenCalledWith({
      data: { sourceDocumentId: DOC_A, expectedLockVersion: 4 },
    });
  });

  it("hands the new lock version to the next accounting autosave", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValueOnce(workspace([document({ selected: false })]));
    loadWorkspace.mockResolvedValue(workspace([document({ selected: true })]));
    attach.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderGuest();

    await user.click(await screen.findByRole("button", { name: "Add to this analysis" }));
    await waitFor(() => expect(attach).toHaveBeenCalled());

    // A later document change reads the lock the server accepted, not the
    // one the page was loaded with.
    await user.click(await screen.findByRole("button", { name: "Remove from this analysis" }));
    await waitFor(() => expect(detach).toHaveBeenCalled());
    expect(detach.mock.calls[0]![0].data.expectedLockVersion).toBe(5);
  });

  it("removes an included PDF", async () => {
    const user = userEvent.setup();
    detach.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderGuest();

    await user.click(await screen.findByRole("button", { name: "Remove from this analysis" }));
    await waitFor(() => expect(detach).toHaveBeenCalledTimes(1));
    expect(detach).toHaveBeenCalledWith({
      data: { sourceDocumentId: DOC_A, expectedLockVersion: 4 },
    });
  });

  it("reloads the authoritative analysis when a change is stale", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    attach.mockResolvedValue({
      ok: false,
      reason: "conflict",
      message: "This analysis changed since the page was loaded.",
    });
    renderGuest();

    await user.click(await screen.findByRole("button", { name: "Add to this analysis" }));

    expect(
      await screen.findByText("This analysis changed since the page was loaded."),
    ).toBeInTheDocument();
    await waitFor(() => expect(loadWorkspace.mock.calls.length).toBeGreaterThan(1));
  });

  it("never claims nothing happened when the change could not be confirmed", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(workspace([document({ selected: false })]));
    attach.mockRejectedValue(new Error("network"));
    renderGuest();

    await user.click(await screen.findByRole("button", { name: "Add to this analysis" }));

    expect(
      await screen.findByText(
        "ARC could not confirm whether that document was added to this analysis, so it has reloaded the current version.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(loadWorkspace.mock.calls.length).toBeGreaterThan(1));
  });

  it("asks before deleting a PDF permanently and then deletes it", async () => {
    const user = userEvent.setup();
    hardDelete.mockResolvedValue({ ok: true, lockVersion: 5 });
    renderGuest();

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));
    expect(await screen.findByText("Delete Master Agreement permanently?")).toBeInTheDocument();

    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(hardDelete).toHaveBeenCalledTimes(1));
    expect(hardDelete).toHaveBeenCalledWith({
      data: { sourceDocumentId: DOC_A, expectedLockVersion: 4 },
    });
  });

  it("opens the upload dialog straight away when arriving from the landing page", async () => {
    renderGuest({ autoOpenUpload: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload to this analysis" })).toBeInTheDocument();
  });

  it("keeps an uploaded PDF and explains it when the analysis moved on", async () => {
    const user = userEvent.setup();
    loadWorkspace.mockResolvedValue(workspace([document({ id: DOC_B, selected: true })]));
    initiate.mockResolvedValue({
      intentId: "cccccccc-3333-4333-8333-333333333333",
      uploadUrl: "https://signed.example/upload",
      token: "token",
    });
    uploadBytes.mockResolvedValue(undefined);
    finalize.mockResolvedValue({
      ok: true,
      lockVersion: 7,
      associationConflict: true,
      duplicate: false,
    });
    renderGuest({ autoOpenUpload: true });

    const file = new File(["%PDF-1.7"], "new-order.pdf", { type: "application/pdf" });
    await user.upload(await screen.findByLabelText(/PDF file/i), file);
    await user.click(screen.getByRole("button", { name: "Upload to this analysis" }));

    expect(
      await screen.findByText(
        "This PDF was uploaded, but this analysis changed since the page was loaded, so it was not included. ARC has reloaded the current version — you can add it from Other uploaded PDFs.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Task 6 — guest upload intent is a one-shot route intent", () => {
  it("opens the upload dialog when the intent arrives after mount, then reports it consumed", async () => {
    const consumed = vi.fn();
    const view = renderGuest({ autoOpenUpload: false, onAutoOpenUploadConsumed: consumed });
    expect(await screen.findByText("Included in this analysis")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();

    view.rerenderGuest({ autoOpenUpload: true, onAutoOpenUploadConsumed: consumed });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));

    // The consumed intent leaves the dialog open.
    view.rerenderGuest({ autoOpenUpload: false, onAutoOpenUploadConsumed: consumed });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("re-opens the guest upload dialog after a cancel and a second Analyze click", async () => {
    const user = userEvent.setup();
    const consumed = vi.fn();
    const view = renderGuest({ autoOpenUpload: true, onAutoOpenUploadConsumed: consumed });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    view.rerenderGuest({ autoOpenUpload: false, onAutoOpenUploadConsumed: consumed });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    view.rerenderGuest({ autoOpenUpload: true, onAutoOpenUploadConsumed: consumed });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(initiate).not.toHaveBeenCalled();
  });
});
