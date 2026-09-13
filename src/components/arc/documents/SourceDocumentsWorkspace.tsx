/**
 * Phase 8C — the authenticated Source Documents workspace.
 *
 * Two authoritative lists: the exact subset selected for the loaded revision,
 * and the whole contract library. Every mutation is a trusted server operation
 * and every accepted lock version is handed straight back to the shared
 * persistence state the accounting autosave uses.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Notice, Section, inputClass } from "@/components/asc606-workflow/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAnalysis } from "@/components/arc/analysis-context";
import {
  finalizeDocumentUpload,
  getDocumentReadUrl,
  initiateDocumentUpload,
} from "@/lib/arc/documents/documents.functions";
import { uploadPdfToSignedTarget } from "@/lib/arc/documents/upload-client";
import {
  attachSourceDocument,
  deleteSourceDocument,
  loadDocumentWorkspace,
  removeSourceDocument,
  setSourceDocumentArchived,
  updateSourceDocumentDetails,
} from "@/lib/arc/documents/workspace.functions";
import {
  SOURCE_DOCUMENT_TYPES,
  type DocumentWorkspaceDto,
  type SourceDocumentSummaryDto,
  type SourceDocumentType,
  type SourceMutationResult,
} from "@/lib/arc/documents/types";

const UPLOAD_HELP = "Text-based PDFs only. Maximum 10 MB and 500 pages.";

function fileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function uploadedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

function defaultDisplayName(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim() || filename;
}

interface RowActions {
  onView: (document: SourceDocumentSummaryDto) => void;
  onDownload: (document: SourceDocumentSummaryDto) => void;
  onAdd?: ((document: SourceDocumentSummaryDto) => void) | undefined;
  onRemove?: ((document: SourceDocumentSummaryDto) => void) | undefined;
  onEdit?: ((document: SourceDocumentSummaryDto) => void) | undefined;
  onArchive?: ((document: SourceDocumentSummaryDto) => void) | undefined;
  onDelete?: ((document: SourceDocumentSummaryDto) => void) | undefined;
  busy: boolean;
}

function DocumentRow({
  document,
  actions,
}: {
  document: SourceDocumentSummaryDto;
  actions: RowActions;
}) {
  const details = [
    document.documentType,
    document.effectiveDate ? `Effective ${document.effectiveDate}` : null,
    document.originalFilename,
    `${document.pageCount} pages`,
    fileSize(document.byteSize),
    `Uploaded ${uploadedOn(document.createdAt)}`,
  ].filter(Boolean) as string[];

  return (
    <li className="rounded-md border border-border/70 bg-card/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{document.displayName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{details.join(" · ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {document.selected ? "Selected for this revision" : "Not selected for this revision"}
            {document.archived ? " · Archived" : ""}
            {document.inFinalizedHistory ? " · Used by finalized history" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.onView(document)}
          >
            View PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.onDownload(document)}
          >
            Download
          </Button>
          {actions.onAdd ? (
            <Button
              type="button"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onAdd?.(document)}
            >
              Add to revision
            </Button>
          ) : null}
          {actions.onRemove ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onRemove?.(document)}
            >
              Remove from revision
            </Button>
          ) : null}
          {actions.onEdit ? (
            document.metadataLocked ? (
              <Button type="button" variant="outline" size="sm" disabled>
                Edit details
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => actions.onEdit?.(document)}
              >
                Edit details
              </Button>
            )
          ) : null}
          {actions.onArchive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onArchive?.(document)}
            >
              {document.archived ? "Unarchive" : "Archive"}
            </Button>
          ) : null}
          {actions.onDelete ? (
            document.canDelete ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={actions.busy}
                onClick={() => actions.onDelete?.(document)}
              >
                Delete permanently
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled>
                Delete permanently
              </Button>
            )
          ) : null}
        </div>
      </div>
      {actions.onEdit && document.metadataLocked ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This document&rsquo;s details are locked because it is part of finalized analysis history.
        </p>
      ) : null}
      {actions.onDelete && !document.canDelete ? (
        <p className="mt-1 text-xs text-muted-foreground">
          This document supports finalized analysis history and cannot be permanently deleted.
          Archive it instead.
        </p>
      ) : null}
    </li>
  );
}

export function SourceDocumentsWorkspace() {
  const { persistence } = useAnalysis();
  const revision = persistence.revision;
  const queryClient = useQueryClient();

  const load = useServerFn(loadDocumentWorkspace);
  const attach = useServerFn(attachSourceDocument);
  const detach = useServerFn(removeSourceDocument);
  const editDetails = useServerFn(updateSourceDocumentDetails);
  const setArchived = useServerFn(setSourceDocumentArchived);
  const hardDelete = useServerFn(deleteSourceDocument);
  const readUrl = useServerFn(getDocumentReadUrl);
  const initiate = useServerFn(initiateDocumentUpload);
  const finalize = useServerFn(finalizeDocumentUpload);

  /**
   * An explicit reload briefly clears the loaded revision. The workspace keeps
   * the ids it already knows so the page does not collapse into the
   * not-available state (and lose its concurrency message) mid-reload.
   */
  const [known, setKnown] = useState<{
    contractId: string;
    revisionId: string;
    revisionNumber: number;
    status: "draft" | "finalized" | "superseded";
  } | null>(null);

  useEffect(() => {
    if (!revision) return;
    setKnown({
      contractId: revision.contractId,
      revisionId: revision.revisionId,
      revisionNumber: revision.revisionNumber,
      status: revision.status,
    });
  }, [revision]);

  const contractId = revision?.contractId ?? known?.contractId ?? null;
  const revisionId = revision?.revisionId ?? known?.revisionId ?? null;

  const queryKey = useMemo(
    () => ["arc-source-documents", contractId, revisionId] as const,
    [contractId, revisionId],
  );

  const workspace = useQuery({
    queryKey,
    enabled: Boolean(contractId && revisionId),
    retry: false,
    queryFn: (): Promise<DocumentWorkspaceDto> =>
      load({ data: { contractId: contractId!, revisionId: revisionId! } }),
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDocumentSummaryDto | null>(null);
  const [deleting, setDeleting] = useState<SourceDocumentSummaryDto | null>(null);

  const refreshDocuments = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    await workspace.refetch();
  }, [queryClient, queryKey, workspace]);

  /** A stale expected lock is never treated as success: reload everything. */
  const reloadAuthoritative = useCallback(async () => {
    await refreshDocuments();
    persistence.reload();
  }, [refreshDocuments, persistence]);

  const applyOutcome = useCallback(
    async (result: SourceMutationResult, successMessage: string | null): Promise<boolean> => {
      if (result.ok) {
        if (typeof result.lockVersion === "number") {
          persistence.applyLockVersion(result.lockVersion);
        }
        setProblem(null);
        if (successMessage) setNotice(successMessage);
        await refreshDocuments();
        return true;
      }
      setNotice(null);
      setProblem(result.message);
      if (result.reason === "conflict") await reloadAuthoritative();
      else await refreshDocuments();
      return false;
    },
    [persistence, refreshDocuments, reloadAuthoritative],
  );

  const lockVersion = persistence.lockVersion;

  const selection = useMutation({
    mutationFn: async (input: { documentId: string; action: "add" | "remove" }) => {
      if (!revisionId || typeof lockVersion !== "number") {
        return {
          ok: false as const,
          reason: "failed" as const,
          message: "This analysis is still loading. Please try again in a moment.",
        };
      }
      const payload = {
        revisionId,
        sourceDocumentId: input.documentId,
        expectedLockVersion: lockVersion,
      };
      return input.action === "add"
        ? ((await attach({ data: payload })) as SourceMutationResult)
        : ((await detach({ data: payload })) as SourceMutationResult);
    },
  });

  const openSignedUrl = useCallback(
    async (document: SourceDocumentSummaryDto, disposition: "view" | "download") => {
      try {
        // Only the document id leaves the browser, and the signed link it
        // returns is used immediately and never stored anywhere.
        const result = await readUrl({
          data: { sourceDocumentId: document.id, disposition },
        });
        setProblem(null);
        globalThis.window?.open(result.url, "_blank", "noopener,noreferrer");
      } catch {
        setProblem("That document could not be opened. Please try again.");
      }
    },
    [readUrl],
  );

  const runSelection = useCallback(
    async (document: SourceDocumentSummaryDto, action: "add" | "remove") => {
      const result = await selection.mutateAsync({ documentId: document.id, action });
      await applyOutcome(
        result,
        action === "add"
          ? `${document.displayName} was added to this revision.`
          : `${document.displayName} was removed from this revision.`,
      );
    },
    [selection, applyOutcome],
  );

  if (!contractId || !revisionId) {
    return (
      <Section title="Source documents" description="Supporting documentation for this analysis.">
        <Notice>Source Documents are available for saved analyses.</Notice>
      </Section>
    );
  }

  const data = workspace.data;
  const revisionNumber = data?.revision.revisionNumber ?? known?.revisionNumber ?? 1;
  const editable = Boolean(data?.revision.canEditSources) && !persistence.readOnly;
  const status = data?.revision.status ?? known?.status ?? "draft";

  const selectedDescription = editable
    ? "Documents supporting this draft analysis."
    : status === "finalized"
      ? `Sources used for finalized Revision ${revisionNumber}. This source set is part of the finalized analysis and cannot be changed.`
      : `Sources recorded for superseded Revision ${revisionNumber}. This historical source set cannot be changed.`;

  const library = (data?.library ?? []).filter(
    (document) => showArchived || !document.archived || document.selected,
  );
  const addable = (data?.library ?? []).filter(
    (document) => !document.selected && !document.archived,
  );

  const busy = selection.isPending;

  return (
    <div className="space-y-8">
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <Section title={`Selected for Revision ${revisionNumber}`} description={selectedDescription}>
        {editable ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => setUploadOpen(true)}>
              Upload PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setAddOpen(true)}
            >
              Add from Contract Library
            </Button>
          </div>
        ) : null}

        {workspace.isLoading ? (
          <Notice>Loading source documents…</Notice>
        ) : workspace.isError ? (
          <Notice>Source documents could not be loaded. Please reload the page.</Notice>
        ) : (data?.selected.length ?? 0) === 0 ? (
          <Notice>No source documents are selected for this revision.</Notice>
        ) : (
          <ul className="space-y-3">
            {data!.selected.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                actions={{
                  busy,
                  onView: (item) => void openSignedUrl(item, "view"),
                  onDownload: (item) => void openSignedUrl(item, "download"),
                  onRemove: editable ? (item) => void runSelection(item, "remove") : undefined,
                }}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Contract Document Library"
        description="Every PDF owned by this contract, whether selected for the current revision or not."
      >
        <label className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived documents
        </label>

        {library.length === 0 ? (
          <Notice>No documents have been uploaded to this contract yet.</Notice>
        ) : (
          <ul className="space-y-3">
            {library.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                actions={{
                  busy,
                  onView: (item) => void openSignedUrl(item, "view"),
                  onDownload: (item) => void openSignedUrl(item, "download"),
                  onAdd:
                    editable && !document.selected
                      ? (item) => void runSelection(item, "add")
                      : undefined,
                  onEdit: (item) => setEditing(item),
                  onArchive: async (item) => {
                    const result = (await setArchived({
                      data: { sourceDocumentId: item.id, archived: !item.archived },
                    })) as SourceMutationResult;
                    await applyOutcome(
                      result,
                      item.archived
                        ? `${item.displayName} was returned to the active library.`
                        : `${item.displayName} was archived.`,
                    );
                  },
                  onDelete: (item) => setDeleting(item),
                }}
              />
            ))}
          </ul>
        )}
      </Section>

      {uploadOpen ? (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          revisionNumber={revisionNumber}
          onUpload={async (input) => {
            // The shared revision lock must be authoritative before an upload
            // may claim a place in this revision. A reload in flight never
            // silently degrades into an unversioned finalization.
            if (typeof lockVersion !== "number") {
              return "This analysis is still loading. Please try again in a moment.";
            }

            const intent = await initiate({
              data: {
                contractId,
                revisionId,
                originalFilename: input.file.name,
                displayName: input.displayName,
                ...(input.documentType ? { documentType: input.documentType } : {}),
                ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}),
              },
            });
            await uploadPdfToSignedTarget(intent, input.file);

            // Finalization is retry-safe by design (Phase 8B): the same intent
            // replays into the recorded outcome. A lost response is therefore
            // retried once with the identical intent and expected lock version,
            // never with a second intent or a second copy of the bytes.
            const finalizePayload = {
              intentId: intent.intentId,
              expectedLockVersion: lockVersion,
            };
            let outcome;
            try {
              outcome = await finalize({ data: finalizePayload });
            } catch {
              try {
                outcome = await finalize({ data: finalizePayload });
              } catch {
                setNotice(null);
                setProblem(
                  "ARC could not confirm whether that upload was recorded, so it has reloaded the current version.",
                );
                await reloadAuthoritative();
                return null;
              }
            }

            if (!outcome.ok) return outcome.message;

            if (typeof outcome.lockVersion === "number") {
              persistence.applyLockVersion(outcome.lockVersion);
            }

            if (outcome.associationConflict) {
              setProblem(
                `This PDF was accepted into the Contract Document Library, but this revision changed since the page was loaded, so it was not added to Revision ${revisionNumber}. ARC has reloaded the current version — you can add it from the library.`,
              );
              setNotice(null);
              await reloadAuthoritative();
              return null;
            }

            setProblem(null);
            setNotice(
              outcome.duplicate
                ? `This PDF was already in this contract and has been added to Revision ${revisionNumber}.`
                : `${input.displayName} was added to Revision ${revisionNumber}.`,
            );
            await refreshDocuments();
            return null;
          }}
        />
      ) : null}

      {addOpen ? (
        <Dialog open onOpenChange={(open) => !open && setAddOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add from Contract Library</DialogTitle>
              <DialogDescription>
                Active contract documents that are not yet selected for Revision {revisionNumber}.
              </DialogDescription>
            </DialogHeader>
            {addable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every active contract document is already selected for this revision.
              </p>
            ) : (
              <ul className="space-y-2">
                {addable.map((document) => (
                  <li key={document.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm">{document.displayName}</span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setAddOpen(false);
                        await runSelection(document, "add");
                      }}
                    >
                      Add {document.displayName}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {editing ? (
        <EditDetailsDialog
          document={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const result = (await editDetails({
              data: { sourceDocumentId: editing.id, ...input },
            })) as SourceMutationResult;
            const ok = await applyOutcome(result, `${input.displayName} was updated.`);
            if (ok) setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {deleting.displayName} permanently?</DialogTitle>
              <DialogDescription>
                This removes the PDF from this contract for good. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  const target = deleting;
                  setDeleting(null);
                  try {
                    const result = (await hardDelete({
                      data: {
                        sourceDocumentId: target.id,
                        expectedLockVersion:
                          target.selected && typeof lockVersion === "number" ? lockVersion : null,
                      },
                    })) as SourceMutationResult;
                    await applyOutcome(result, `${target.displayName} was deleted permanently.`);
                  } catch {
                    // An ambiguous transport failure never claims nothing changed.
                    setNotice(null);
                    setProblem(
                      "ARC could not confirm whether that document was deleted, so it has reloaded the current version.",
                    );
                    await reloadAuthoritative();
                  }
                }}
              >
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function EditDetailsDialog({
  document,
  onClose,
  onSave,
}: {
  document: SourceDocumentSummaryDto;
  onClose: () => void;
  onSave: (input: {
    displayName: string;
    documentType: SourceDocumentType | null;
    effectiveDate: string | null;
  }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(document.displayName);
  const [documentType, setDocumentType] = useState<string>(document.documentType ?? "");
  const [effectiveDate, setEffectiveDate] = useState<string>(document.effectiveDate ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit document details</DialogTitle>
          <DialogDescription>
            The file itself, its page count and its size never change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            Document name
            <input
              className={inputClass}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Document type
            <select
              className={inputClass}
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
            >
              <option value="">Not specified</option>
              {SOURCE_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Effective date
            <input
              type="date"
              className={inputClass}
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || displayName.trim() === ""}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  displayName: displayName.trim(),
                  documentType: (documentType || null) as SourceDocumentType | null,
                  effectiveDate: effectiveDate || null,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            Save details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({
  revisionNumber,
  onClose,
  onUpload,
}: {
  revisionNumber: number;
  onClose: () => void;
  /** Resolves with a user-facing rejection message, or null on success. */
  onUpload: (input: {
    file: File;
    displayName: string;
    documentType: SourceDocumentType | null;
    effectiveDate: string | null;
  }) => Promise<string | null>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [documentType, setDocumentType] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>("");
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const [rejection, setRejection] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload PDF</DialogTitle>
          <DialogDescription>{UPLOAD_HELP}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            PDF file
            <input
              type="file"
              accept="application/pdf"
              className={inputClass}
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && displayName.trim() === "") {
                  setDisplayName(defaultDisplayName(picked.name));
                }
              }}
            />
          </label>
          <label className="block text-sm">
            Document name
            <input
              className={inputClass}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Document type
            <select
              className={inputClass}
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
            >
              <option value="">Not specified</option>
              {SOURCE_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Effective date
            <input
              type="date"
              className={inputClass}
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </label>
          {state === "uploading" ? (
            <p role="status" className="text-sm text-muted-foreground">
              Uploading and checking this PDF…
            </p>
          ) : null}
          {rejection ? (
            <p role="alert" className="text-sm text-destructive">
              {rejection}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!file || displayName.trim() === "" || state === "uploading"}
            onClick={async () => {
              if (!file) return;
              setRejection(null);
              setState("uploading");
              try {
                const message = await onUpload({
                  file,
                  displayName: displayName.trim(),
                  documentType: (documentType || null) as SourceDocumentType | null,
                  effectiveDate: effectiveDate || null,
                });
                if (message) setRejection(message);
                else onClose();
              } catch {
                setRejection("That file could not be uploaded. Please try again.");
              } finally {
                setState("idle");
              }
            }}
          >
            Upload to Revision {revisionNumber}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
