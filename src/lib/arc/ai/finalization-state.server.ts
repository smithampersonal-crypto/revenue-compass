/**
 * Phase 9F Task 13 — the narrow trusted read the finalization gate needs.
 *
 * Server-only. The browser can never supply AI review state or run state: the
 * AI persistence tables grant nothing to `anon` or `authenticated`, so this
 * service-role read is the single source of the finalization decision's facts.
 *
 * Deliberately narrow: the review items and whether a run can still apply a
 * result. Nothing else about the AI run is exposed to the lifecycle layer.
 */

import type { AiFinalizationState } from "@/lib/arc/persistence/revisions.handlers";

const ACTIVE_STAGES = [
  "created",
  "extracting",
  "preflight_ready",
  "analyzing",
  "validating",
  "applying",
];

/** Null means "no AI sidecar": a manual-only analysis finalizes exactly as before. */
export async function readAiFinalizationState(
  revisionId: string,
): Promise<AiFinalizationState | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("ai_analysis_state")
    .select("review_items")
    .eq("revision_id", revisionId)
    .maybeSingle();
  if (error) throw new Error("That revision could not be finalized.");
  if (!data) return null;

  const active = await supabaseAdmin
    .from("ai_runs")
    .select("id", { count: "exact", head: true })
    .eq("revision_id", revisionId)
    .in("stage", ACTIVE_STAGES);
  if (active.error) throw new Error("That revision could not be finalized.");

  const reviewItems = Array.isArray(data.review_items)
    ? (data.review_items as Array<{ state: string; reason?: string; targetKey?: string }>)
    : [];

  return { reviewItems, hasActiveRun: (active.count ?? 0) > 0 };
}
