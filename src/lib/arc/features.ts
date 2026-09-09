/**
 * Build-time feature flags for public destinations that are not finished yet.
 *
 * When a flag is false the corresponding navigation item is hidden and the
 * route renders nothing user-facing, so the application never exposes a
 * visibly unfinished experience. These flags carry no accounting meaning.
 */
export const FEATURES = {
  /** Source Documents area (upload / provenance shell). */
  SOURCE_DOCUMENTS: true,
  /** Guidance Library public route (not built yet). */
  GUIDANCE_LIBRARY: false,
  /** Expanded case-study index beyond the existing samples. */
  CASE_STUDIES_EXPANDED: false,
} as const;

export type FeatureName = keyof typeof FEATURES;
