# Phase 9G-R3 L — Citation anchor endpoint-selection correction

## Scope
- Clarify the canonical trusted citation instructions so `anchorIds` is explicitly an enumeration, never a start/end pair.
- Preserve the existing schema v5, materializer behavior, fail-closed issue codes, diagnostic logging, quotas, and accounting behavior.
- Advance prompt provenance from `arc.ai.prompt.v6` to `arc.ai.prompt.v7`.

## Implementation
1. Add the explicit-list rule beside the existing contiguous-anchor rule, including the required valid three-ID example and invalid endpoint-only example.
2. State that spans needing more than three anchors must be narrowed to genuinely supporting consecutive evidence, or cited visually only for genuinely visual/layout evidence; never fabricate a middle ID.
3. Change the server-owned default prompt version to `arc.ai.prompt.v7` and update version assertions/fixtures that represent the production default. Keep `arc.ai.schema.v5` unchanged.
4. Add production-boundary regression assertions proving the actual canonical instructions contain the explicit-list, examples, and no-omitted-intermediate-anchor language.
5. Keep the endpoint-pair materializer regression unchanged and verify it still fails as `anchor_range_reversed`.

## Verification and delivery
- Run focused prompt and citation tests, then all repository gates: tests, typecheck, lint, production build, and bundle audit.
- Check the hosted environment/version configuration so the deployed revision reports prompt v7.
- Confirm both GitHub verification jobs; do not change dependencies or workflows.
- Package the exact reviewed source revision, verify its SHA-256 twice, and provide the revision for manual browser acceptance without making another model call.
