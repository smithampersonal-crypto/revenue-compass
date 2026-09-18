/**
 * Phase 9G — Task 7. The accountant-facing AI review queue.
 *
 * Presentation only. Every fact shown here — which items exist, their
 * severity, their evidence, whether they are resolved and how — is the
 * server-owned review state read through the safe Task 3 DTO. This component
 * never derives severity, never resolves an item locally, never writes review
 * state and never treats provenance as approval.
 *
 * Two deliberate absences: there is no bulk or generic dismissal, and a
 * persisted payload that could not be read completely offers no action at all.
 */

import { useRef, useState } from "react";
import { AlertTriangle, CircleHelp, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import {
  MANUAL_RED_REASON_OPTIONS,
  REVIEW_NOTE_MAX_LENGTH,
  citationLabel,
  describeReviewTarget,
  resolutionSummary,
  reviewSectionLabel,
  reviewStateLabel,
} from "@/lib/arc/ai/review-presentation";
import type { ManualRedReason } from "@/lib/arc/ai/review-state";

import { Notice, Section } from "@/components/asc606-workflow/fields";

function Citations({ item }: { item: AiReviewItemDto }) {
  if (item.citations.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {item.citations.map((citation, index) => (
        <li key={index} className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium">
            <FileText className="size-3" aria-hidden="true" />
            {citationLabel(citation)}
          </span>
          {citation.excerpt ? (
            <blockquote className="mt-1 border-l-2 border-border pl-2 italic">
              {citation.excerpt}
            </blockquote>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ResolveForm({
  item,
  busy,
  onSubmit,
  onCancel,
}: {
  item: AiReviewItemDto;
  busy: boolean;
  onSubmit: (input: { reason: ManualRedReason; note: string | null }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<ManualRedReason | null>(null);
  const [note, setNote] = useState("");
  const noteId = `ai-review-note-${item.id}`;

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason === null) return;
        onSubmit({ reason, note: note.trim() === "" ? null : note.trim() });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">Why is this item resolved?</legend>
        {MANUAL_RED_REASON_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-xs">
            <input
              type="radio"
              className="mt-1"
              name={`ai-review-reason-${item.id}`}
              value={option.value}
              checked={reason === option.value}
              onChange={() => setReason(option.value)}
            />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-muted-foreground">{option.helper}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={noteId} className="text-xs font-semibold">
          Note (optional)
        </label>
        <textarea
          id={noteId}
          className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-xs"
          maxLength={REVIEW_NOTE_MAX_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || reason === null}>
          Record resolution
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReviewItemRow({
  item,
  busy,
  pendingItemId,
  claim,
  ai,
  onOpenTarget,
}: {
  item: AiReviewItemDto;
  busy: boolean;
  /** Presentation-only single-flight ownership, owned by the panel. */
  pendingItemId: string | null;
  claim: (itemId: string, run: () => Promise<unknown>) => void;
  ai: AiWorkspaceController;
  onOpenTarget?: ((reviewItemId: string) => void) | undefined;
}) {
  const [resolving, setResolving] = useState(false);
  const target = describeReviewTarget(item.targetKey, item.section);
  // A review action already in flight must not be issued twice: the second
  // request would carry a fingerprint the first one has already superseded.
  const pendingHere = pendingItemId === item.id;
  const actionBusy = busy || pendingItemId !== null;

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {reviewSectionLabel(item.section)} · {target.label}
          </p>
          <p className="mt-1 text-sm">{item.reason}</p>
        </div>
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-medium">
          {item.severity === "red" ? (
            <AlertTriangle className="size-3" aria-hidden="true" />
          ) : (
            <CircleHelp className="size-3" aria-hidden="true" />
          )}
          {reviewStateLabel(item)}
        </span>
      </div>

      <Citations item={item} />

      <div className="mt-3 flex flex-wrap gap-2">
        {onOpenTarget ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenTarget(item.id)}>
            Go to {target.kind === "exact" ? "field" : "section"}
          </Button>
        ) : null}
        {item.severity === "yellow" ? (
          <Button
            type="button"
            size="sm"
            disabled={actionBusy}
            aria-busy={pendingHere}
            onClick={() => {
              claim(item.id, async () => {
                await ai.affirmReviewItem({
                  reviewItemId: item.id,
                  expectedReviewFingerprint: item.reviewFingerprint,
                  method: "individual",
                });
              });
            }}
          >
            Confirm
          </Button>
        ) : resolving ? null : (
          <Button
            type="button"
            size="sm"
            disabled={actionBusy}
            onClick={() => setResolving(true)}
          >
            Resolve
          </Button>
        )}
      </div>

      {resolving ? (
        <ResolveForm
          item={item}
          busy={actionBusy}
          onCancel={() => setResolving(false)}
          onSubmit={({ reason, note }) => {
            claim(item.id, async () => {
              await ai.resolveReviewIssue({
                reviewItemId: item.id,
                expectedReviewFingerprint: item.reviewFingerprint,
                reason,
                note,
              });
            });
          }}
        />
      ) : null}
    </li>
  );
}

export function AiReviewPanel({
  ai,
  onOpenTarget,
}: {
  ai: AiWorkspaceController;
  /**
   * Asks the host to open the persisted target. Navigation and route intent
   * belong to the analysis route, never to this panel.
   */
  onOpenTarget?: ((reviewItemId: string) => void) | undefined;
}) {
  // Presentation-only action ownership. It never marks an item resolved,
  // never removes it optimistically and never authors a timestamp or a
  // fingerprint: the refreshed authoritative workspace still decides.
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const claim = (itemId: string, run: () => Promise<unknown>) => {
    if (pendingRef.current !== null) return;
    pendingRef.current = itemId;
    setPendingItemId(itemId);
    void Promise.resolve(run()).finally(() => {
      if (pendingRef.current !== itemId) return;
      pendingRef.current = null;
      setPendingItemId(null);
    });
  };

  const workspace = ai.workspace;
  // Never run means nothing to review. The panel stays silent rather than
  // implying the accountant has an outstanding AI obligation.
  if (!workspace || !workspace.hasAnalysis) return null;

  const malformed = workspace.reviewPayloadMalformed;
  const outstanding = workspace.reviewItems.filter((item) => item.state !== "resolved");
  const resolved = workspace.reviewItems.filter((item) => item.state === "resolved");
  // A run in flight is about to replace this review state, so no action is
  // offered against a queue that is being rewritten.
  const busy = ai.active || ai.actionState !== "idle";

  return (
    <div role="region" aria-label="AI review">
      <Section
        title="AI review"
        description="Items the AI analysis asks you to confirm or resolve. These are separate from the deterministic workflow items below."
      >
        {malformed ? (
          <Notice tone="danger">
            The saved AI review state could not be read, so review actions are unavailable. Run the
            analysis again to rebuild it.
          </Notice>
        ) : outstanding.length === 0 ? (
          <Notice tone="muted">No AI review items are outstanding.</Notice>
        ) : (
          <ul className="space-y-3">
            {outstanding.map((item) => (
              <ReviewItemRow
                key={item.id}
                item={item}
                busy={busy}
                pendingItemId={pendingItemId}
                claim={claim}
                ai={ai}
                onOpenTarget={onOpenTarget}
              />
            ))}
          </ul>
        )}

        {!malformed && resolved.length > 0 ? (
          <div role="group" aria-label="Resolved AI review items" className="mt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resolved
            </h3>
            <ul className="space-y-2">
              {resolved.map((item) => (
                <li key={item.id} className="rounded-md border border-border/60 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {reviewSectionLabel(item.section)}
                  </p>
                  <p className="mt-1">{item.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {resolutionSummary(item.resolution) ?? "Resolved"}
                    {item.resolution &&
                    item.resolution.kind === "manual_red" &&
                    item.resolution.note
                      ? ` — ${item.resolution.note}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
