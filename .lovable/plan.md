# AI Progress Bar — Full-Track Activity Refinement

## Scope

Refine only the active progress-bar presentation. Preserve the authoritative four-stage model, headlines, confirmed checkpoints, execution lifecycle, timing, and accounting behavior.

## Implementation

1. Make the animated activity layer span the full progress track in every active stage.
2. Move its pulse smoothly from the left edge to the right edge, fading before its invisible reset.
3. Keep the confirmed fill tied exactly to the existing stage checkpoints.
4. Preserve a restrained static active cue when reduced motion is requested.
5. Ensure the completed state has a 100% confirmed fill and no moving activity cue wherever the existing completion presentation is rendered.

## Verification

1. Update focused presentation tests to prove confirmed progress remains stage-driven.
2. Prove the activity layer remains full-track across stage changes and is not bounded by checkpoints.
3. Prove the presenter introduces no timers, orchestration calls, accounting changes, or lifecycle state.
4. Verify reduced-motion styling disables the sweep while retaining its static cue.
5. Run the focused progress and controller/orchestration regression suites, then inspect the current build signal.

## Guardrails

- No AI execution, API, orchestration, stage-transition, completion, request-lifecycle, or accounting changes.
- No unrelated presentation changes.
- Stop after this refinement for review; do not begin Package 3.