# AI Progress Bar — Full-Track Activity Refinement

## Scope

Refine only the active progress-bar presentation. Preserve the authoritative four-stage model, headlines, confirmed checkpoints, execution lifecycle, timing, and accounting behavior.

## Implementation

1. Make the animated activity layer span the full progress track in every active stage.
2. Move its pulse smoothly from the left edge to the right edge, fading before its invisible reset.
3. Keep the activity element mounted and unkeyed across stage changes so an in-flight sweep is not reset or cut short.
4. Keep the confirmed fill and all semantic progress values tied exactly to the existing stage checkpoints; the sweep remains indeterminate.
5. Preserve a restrained static active cue when reduced motion is requested.
6. If the existing lifecycle renders completion, show a 100% confirmed fill without a sweep; otherwise preserve immediate unmounting without a linger, timer, or new state.

## Verification

1. Update focused presentation tests to prove confirmed progress remains stage-driven.
2. Prove the activity layer remains full-track across stage changes and is not bounded by checkpoints.
3. Prove stage changes preserve the same activity element and introduce no timers, orchestration calls, accounting changes, or lifecycle state.
4. Verify reduced-motion styling disables the sweep while retaining its static cue.
5. Run the focused progress and controller/orchestration regression suites, then inspect the current build signal.

## Guardrails

- No AI execution, API, orchestration, stage-transition, completion, request-lifecycle, or accounting changes.
- No unrelated presentation changes.
- Stop after this refinement for review; do not begin Package 3.