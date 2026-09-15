/**
 * Phase 9B — browser-safe AI evidence/package DTO types.
 *
 * Nothing here imports the PDF parser, the OpenAI SDK, Supabase service-role
 * code or any storage helper. Only shapes and deterministic thresholds live in
 * this module.
 */

import type { GuidancePack } from "@/lib/arc/guidance/types";

export type AiPageReadability = "text" | "low_text" | "no_text";

/**
 * The single configuration location for readability classification.
 *   0 meaningful characters      -> no_text
 *   1..49 meaningful characters  -> low_text
 *   50+ meaningful characters    -> text
 *
 * These are diagnostics only: a low-text or zero-text page never rejects a PDF
 * that already passed Phase 8 validation.
 */
export const READABILITY_THRESHOLDS = { text: 50 } as const;

export function classifyReadability(meaningfulCharacters: number): AiPageReadability {
  if (meaningfulCharacters <= 0) return "no_text";
  return meaningfulCharacters >= READABILITY_THRESHOLDS.text ? "text" : "low_text";
}

export interface AiPageEvidence {
  pageNumber: number;
  text: string;
  meaningfulCharacters: number;
  readability: AiPageReadability;
}

export interface AiDocumentEvidence {
  documentId: string;
  displayName: string;
  originalFilename: string;
  sha256: string;
  byteSize: number;
  pageCount: number;
  pages: AiPageEvidence[];
}

/**
 * Accounting context seam. Phase 9B accepts these from its caller and carries
 * them into the proposed request; Phase 9C/9D own how they are produced.
 */
export interface CurrentAccountingContext {
  manuallyEnteredFacts: Record<string, string | number | boolean | null>;
  draftFingerprint: string;
}

export interface PriorAccountingContext {
  sourceRevisionId: string;
  performanceObligations: Array<Record<string, unknown>>;
  transactionPriceInput: string;
  recognitionSummary: Array<Record<string, unknown>>;
  modificationSummary: Array<Record<string, unknown>>;
  revenueRecognizedThroughDate: string | null;
  remainingConsiderationInput: string | null;
}

export interface AiRequestPackage {
  sources: AiDocumentEvidence[];
  guidance: GuidancePack;
  currentContext: CurrentAccountingContext;
  priorContext: PriorAccountingContext | null;
  /** Responses API input items, including each original PDF exactly once. */
  openAiInput: unknown[];
  combinedFileBytes: number;
}

export type AiPreflightFailureCode =
  | "no_sources"
  | "unreadable_source"
  | "storage_unavailable"
  | "combined_bytes_exceeded"
  | "input_tokens_exceeded";

export type AiPreflightResult =
  | { ok: true; package: AiRequestPackage; inputTokens: number }
  | {
      ok: false;
      code: AiPreflightFailureCode;
      message: string;
      combinedFileBytes?: number;
      inputTokens?: number;
    };

export const AI_PREFLIGHT_MESSAGES: Record<AiPreflightFailureCode, string> = {
  no_sources: "Select at least one source PDF before running an AI analysis.",
  unreadable_source: "One of the selected PDFs could not be read. Please re-upload it.",
  storage_unavailable: "The selected documents are temporarily unavailable. Please try again.",
  combined_bytes_exceeded:
    "The selected PDFs are too large for one AI analysis. Remove a document and try again — ARC never analyzes part of a contract.",
  input_tokens_exceeded:
    "The selected PDFs are too long for one AI analysis. Remove a document and try again — ARC never shortens a contract to fit.",
};
