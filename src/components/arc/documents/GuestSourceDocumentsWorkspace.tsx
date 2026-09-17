/**
 * Phase 8E — Source Documents for a temporary (unsaved) analysis.
 *
 * There is no contract yet, so there is no contract library: there are only
 * the PDFs this visitor uploaded, and the subset included in the analysis.
 * Every mutation is a trusted server operation carrying the shared temporary
 * lock version, and every accepted lock version is handed straight back to the
 * persistence state the accounting autosave uses.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useRef, useState } from "react";

import { Notice, Section } from "@/components/asc606-workflow/fields";
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
import { SourceDocumentUploadDialog } from "@/components/arc/documents/SourceDocumentUploadDialog";
import {
  attachGuestSourceDocument,
  deleteGuestSourceDocument,
  finalizeGuestDocumentUpload,
  getGuestDocumentReadUrl,
  initiateGuestDocumentUpload,
  loadGuestDocumentWorkspace,
  removeGuestSourceDocument,
} from "@/lib/arc/documents/guest-documents.functions";
import { uploadPdfToSignedTarget } from "@/lib/arc/documents/upload-client";
import type {
  GuestDocumentWorkspaceDto,
  SourceDocumentSummaryDto,
  SourceMutationResult,
} from "@/lib/arc/documents/types";

export const GUEST_DOCUMENTS_QUERY_KEY = ["arc-guest-source-documents"] as const;

function fileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function GuestDocumentRow({
  document,
  busy,
  onView,
  onDownload,
  onAdd,
  onRemove,
  onDelete,
}: {
  document: SourceDocumentSummaryDto;
  busy: boolean;
  onView: () => void;
  onDownload: () => void;
  onAdd?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  onDelete: () => void;
}) {
  const details = [
    document.documentType,
    document.effectiveDate ? `Effective ${document.effectiveDate}` : null,
    document.originalFilename,
    `${document.pageCount} pages`,
    fileSize(document.byteSize),
  ].filter(Boolean) as string[];

  return (
    <li className="rounded-md border border-border/70 bg-card/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{document.displayName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{details.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onView}>
            View PDF
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDownload}>
            Download
          </Button>
          {onAdd ? (
            <Button type="button" size="sm" disabled={busy} onClick={onAdd}>
              Add to this analysis
            </Button>
          ) : null}
          {onRemove ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRemove}>
              Remove from this analysis
            </Button>
          ) : null}
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
            Delete permanently
          </Button>
        </div>
      </div>
    </li>
  );
}

export function GuestSourceDocumentsWorkspace({
  autoOpenUpload = false,
}: {
  autoOpenUpload?: boolean;
}) {
  const { persistence, ai } = useAnalysis();
  const queryClient = useQueryClient();

  const load = useServerFn(loadGuestDocumentWorkspace);
  const attach = useServerFn(attachGuestSourceDocument);
  const detach = useServerFn(removeGuestSourceDocument);
  const hardDelete = useServerFn(deleteGuestSourceDocument);
  const readUrl = useServerFn(getGuestDocumentReadUrl);
  const initiate = useServerFn(initiateGuestDocumentUpload);
  const finalize = useServerFn(finalizeGuestDocumentUpload);

  const workspace = useQuery({
    queryKey: GUEST_DOCUMENTS_QUERY_KEY,
    retry: false,
    queryFn: (): Promise<GuestDocumentWorkspaceDto> => load(),
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(autoOpenUpload);
  const [deleting, setDeleting] = useState<SourceDocumentSummaryDto | null>(null);

  const refreshDocuments = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: GUEST_DOCUMENTS_QUERY_KEY });
    await workspace.refetch();
  }, [queryClient, workspace]);

  const recoveringRef = useRef(false);
  const [recovering, setRecovering] = useState(false);

  const reloadAuthoritative = useCallback(
    async (message?: string) => {
      recoveringRef.current = true;
      setRecovering(true);
      if (message) {
        setNotice(null);
        setProblem(message);
      }
      setUploadOpen(false);
      setDeleting(null);
      // Initiated first: the shared temporary lock is never left authoritative.
      persistence.reload();
      try {
        await refreshDocuments();
      } catch {
        // Retained documents stay visible; the workspace reload already ran.
      }
      recoveringRef.current = false;
      setRecovering(false);
    },
    [persistence, refreshDocuments],
  );

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
      if (typeof lockVersion !== "number") {
        return {
          ok: false as const,
          reason: "failed" as const,
          message: "This analysis is still loading. Please try again in a moment.",
        };
      }
      const payload = { sourceDocumentId: input.documentId, expectedLockVersion: lockVersion };
      return input.action === "add"
        ? ((await attach({ data: payload })) as SourceMutationResult)
        : ((await detach({ data: payload })) as SourceMutationResult);
    },
  });

  const openSignedUrl = useCallback(
    async (document: SourceDocumentSummaryDto, disposition: "view" | "download") => {
      try {
        const result = await readUrl({ data: { sourceDocumentId: document.id, disposition } });
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
      if (recoveringRef.current) return;
      let result: SourceMutationResult;
      try {
        result = await selection.mutateAsync({ documentId: document.id, action });
      } catch {
        // The outcome is unknown: ARC claims neither that the analysis changed
        // nor that it did not, and refetches the authoritative state.
        await reloadAuthoritative(
          action === "add"
            ? "ARC could not confirm whether that document was added to this analysis, so it has reloaded the current version."
            : "ARC could not confirm whether that document was removed from this analysis, so it has reloaded the current version.",
        );
        return;
      }
      await applyOutcome(
        result,
        action === "add"
          ? `${document.displayName} was added to this analysis.`
          : `${document.displayName} was removed from this analysis.`,
      );
    },
    [selection, applyOutcome, reloadAuthoritative],
  );

  const data = workspace.data;
  const library = data?.library ?? [];
  const selected = data?.selected ?? [];
  const others = library.filter((document) => !document.selected);
  const authoritative = typeof lockVersion === "number" && !persistence.readOnly;
  const sourceLocked = ai.locks.sourceDocuments;
  const busy = selection.isPending || !authoritative || recovering || sourceLocked;

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

      <Section
        title="Included in this analysis"
        description="The PDFs supporting this analysis. They are kept with the temporary workspace for nine hours, and move with the analysis when you save it to My Contracts."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => setUploadOpen(true)}>
            Upload PDF
          </Button>
        </div>

        {workspace.isLoading ? (
          <Notice>Loading source documents…</Notice>
        ) : workspace.isError ? (
          <Notice>Source documents could not be loaded. Please reload the page.</Notice>
        ) : selected.length === 0 ? (
          <Notice>No source documents are included in this analysis yet.</Notice>
        ) : (
          <ul className="space-y-3">
            {selected.map((document) => (
              <GuestDocumentRow
                key={document.id}
                document={document}
                busy={busy}
                onView={() => void openSignedUrl(document, "view")}
                onDownload={() => void openSignedUrl(document, "download")}
                onRemove={() => void runSelection(document, "remove")}
                onDelete={() => setDeleting(document)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Other uploaded PDFs"
        description="Uploaded to this temporary workspace but not included in the analysis."
      >
        {others.length === 0 ? (
          <Notice>Every PDF you have uploaded is included in this analysis.</Notice>
        ) : (
          <ul className="space-y-3">
            {others.map((document) => (
              <GuestDocumentRow
                key={document.id}
                document={document}
                busy={busy}
                onView={() => void openSignedUrl(document, "view")}
                onDownload={() => void openSignedUrl(document, "download")}
                onAdd={() => void runSelection(document, "add")}
                onDelete={() => setDeleting(document)}
              />
            ))}
          </ul>
        )}
      </Section>

      {uploadOpen ? (
        <SourceDocumentUploadDialog
          submitLabel="Upload to this analysis"
          onClose={() => setUploadOpen(false)}
          onUpload={async (input) => {
            // The shared temporary lock must be authoritative before an upload
            // may claim a place in this analysis.
            if (recoveringRef.current || sourceLocked || typeof lockVersion !== "number") {
              return "This analysis is still loading. Please try again in a moment.";
            }

            const intent = await initiate({
              data: {
                originalFilename: input.file.name,
                displayName: input.displayName,
                declaredByteSize: input.file.size,
                ...(input.documentType ? { documentType: input.documentType } : {}),
                ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}),
              },
            });
            await uploadPdfToSignedTarget(intent, input.file);

            // Finalization is retry-safe by design: the same intent replays
            // into the recorded outcome, so a lost response is retried once
            // with the identical intent — never a second copy of the bytes.
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
                await reloadAuthoritative(
                  "ARC could not confirm whether that upload was recorded, so it has reloaded the current version.",
                );
                return null;
              }
            }

            if (!outcome.ok) return outcome.message;

            if (typeof outcome.lockVersion === "number") {
              persistence.applyLockVersion(outcome.lockVersion);
            }

            if (outcome.associationConflict) {
              await reloadAuthoritative(
                "This PDF was uploaded, but this analysis changed since the page was loaded, so it was not included. ARC has reloaded the current version — you can add it from Other uploaded PDFs.",
              );
              return null;
            }

            setProblem(null);
            setNotice(
              outcome.duplicate
                ? "This PDF was already uploaded to this analysis and is included."
                : `${input.displayName} was added to this analysis.`,
            );
            await refreshDocuments();
            return null;
          }}
        />
      ) : null}

      {deleting ? (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {deleting.displayName} permanently?</DialogTitle>
              <DialogDescription>
                This removes the PDF from this temporary workspace for good. This cannot be undone.
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
                  if (recoveringRef.current || sourceLocked) return;
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
                    await reloadAuthoritative(
                      "ARC could not confirm whether that document was deleted, so it has reloaded the current version.",
                    );
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
