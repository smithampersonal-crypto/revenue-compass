/**
 * Phase 8E — the one Upload PDF dialog.
 *
 * Signed-in contracts, temporary workspaces and the Home entry point all use
 * this component, so the accepted file rules, the metadata offered and the
 * wording are identical everywhere. It never talks to the server itself: the
 * caller owns the upload, so each surface keeps its own trusted boundary.
 */

import { useState } from "react";

import { inputClass } from "@/components/asc606-workflow/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SOURCE_DOCUMENT_TYPES, type SourceDocumentType } from "@/lib/arc/documents/types";

export const UPLOAD_HELP = "Text-based PDFs only. Maximum 10 MB and 500 pages.";

export function defaultDisplayName(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim() || filename;
}

export interface SourceDocumentUploadInput {
  file: File;
  displayName: string;
  documentType: SourceDocumentType | null;
  effectiveDate: string | null;
}

export function SourceDocumentUploadDialog({
  submitLabel,
  onClose,
  onUpload,
}: {
  /** For example "Upload to Revision 2" or "Upload to this analysis". */
  submitLabel: string;
  onClose: () => void;
  /** Resolves with a user-facing rejection message, or null on success. */
  onUpload: (input: SourceDocumentUploadInput) => Promise<string | null>;
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
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
