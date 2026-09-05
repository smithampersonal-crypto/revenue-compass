/**
 * Phase 5B allocation-only path.
 *
 * Step 4 (allocate the transaction price) depends on Step 3 consideration and
 * Step 4 standalone selling prices — never on Step 5 recognition information,
 * Phase 3 billing or Phase 4 journals. This module exposes the inception
 * allocation on its own, reusing the same deterministic allocation used by the
 * full analysis: no allocation arithmetic is duplicated here or in React.
 */

import {
  MAX_CENTS,
  bigIntToCents,
  type AllocatablePerformanceObligation,
  type AllocationRow,
  type Cents,
} from "@/lib/asc606";
import { buildInceptionAllocation, type SpecificAllocationInput } from "./allocation";
import { signedAmount } from "./estimation";
import { validateInceptionComponent, type InceptionComponentCheck } from "./validation";
import { VariableConsiderationError, type VcCheckResult, type VcEffect } from "./types";

/** One estimated component as it stands at inception. */
export interface VcPreviewComponent extends InceptionComponentCheck {
  componentId: string;
  effect: VcEffect;
}

export interface VcAllocationPreviewInput {
  fixedConsiderationCents: Cents;
  allocatables: readonly AllocatablePerformanceObligation[];
  components: readonly VcPreviewComponent[];
}

export interface VcAllocationPreview {
  /** Fixed consideration + estimated variable consideration included at inception. */
  initialTransactionPriceCents: Cents | null;
  /** Fixed consideration + generally-allocated included variable consideration. */
  generalPoolCents: Cents | null;
  /** Relative-SSP allocation of the general pool. */
  base: AllocationRow[] | null;
  /** Variable amounts allocated in full to one performance obligation. */
  specific: {
    componentId: string;
    description: string;
    poId: string;
    poName: string;
    amountCents: Cents;
  }[];
  /** base + specific, by performance obligation. */
  finalAllocations: { poId: string; name: string; amountCents: Cents }[] | null;
  issues: VcCheckResult[];
}

/**
 * Defensive wrapper: an allocation-only preview never throws at the accountant.
 * Any structurally impossible input is reported as a blocking review issue.
 */
export function previewVcAllocation(input: VcAllocationPreviewInput): VcAllocationPreview {
  try {
    return buildPreview(input);
  } catch (error) {
    return {
      initialTransactionPriceCents: null,
      generalPoolCents: null,
      base: null,
      specific: [],
      finalAllocations: null,
      issues: [
        {
          id: "vc.allocation.preview",
          category: "allocation",
          severity: "blocking",
          message:
            error instanceof VariableConsiderationError ? error.message : (error as Error).message,
          passed: false,
        },
      ],
    };
  }
}

function buildPreview(input: VcAllocationPreviewInput): VcAllocationPreview {
  const issues: VcCheckResult[] = [];
  const fail = (id: string, message: string) =>
    issues.push({ id, category: "allocation", severity: "blocking", message, passed: false });

  const poNames = new Map(input.allocatables.map((po) => [po.id, po.name]));

  const empty = (
    generalPoolCents: Cents | null,
    specific: VcAllocationPreview["specific"],
  ): VcAllocationPreview => ({
    initialTransactionPriceCents: null,
    generalPoolCents,
    base: null,
    specific,
    finalAllocations: null,
    issues,
  });

  const poIds = new Set(input.allocatables.map((po) => po.id));
  for (const component of input.components) {
    validateInceptionComponent(
      { ...component, id: component.componentId },
      poIds,
      (id, _c, message) => fail(id, message),
    );
  }
  if (issues.length > 0) return empty(null, []);

  let generalPool = BigInt(input.fixedConsiderationCents);
  const specificInputs: SpecificAllocationInput[] = [];
  for (const component of input.components) {
    const includedCents = signedAmount(component.inception.includedCents, component.effect);
    if (component.allocationTreatment === "general") {
      generalPool += BigInt(includedCents);
      continue;
    }
    if (!component.targetPoId || !poNames.has(component.targetPoId)) {
      fail(
        "vc.component.target_po",
        `"${component.description || component.componentId}" is allocated to a specific performance obligation, so a valid target performance obligation is required.`,
      );
      continue;
    }
    specificInputs.push({
      componentId: component.componentId,
      description: component.description,
      poId: component.targetPoId,
      amountCents: includedCents,
    });
  }

  const specific = specificInputs.map((row) => ({
    componentId: row.componentId,
    description: row.description,
    poId: row.poId,
    poName: poNames.get(row.poId) ?? row.poId,
    amountCents: row.amountCents,
  }));

  if (input.allocatables.length === 0) {
    fail("vc.allocation.po.exists", "At least one performance obligation is required.");
    return empty(null, specific);
  }
  if (generalPool > BigInt(MAX_CENTS)) {
    fail(
      "vc.lifecycle.supported_range",
      "The consideration in this contract exceeds the supported monetary range.",
    );
    return empty(null, specific);
  }
  if (generalPool < 0n) {
    fail(
      "vc.allocation.general_pool.nonnegative",
      "The consideration allocated on a relative standalone-selling-price basis cannot be negative. Review the variable-consideration amounts and their allocation treatment.",
    );
    return empty(null, specific);
  }
  const generalPoolCents = bigIntToCents(generalPool, "general allocation pool");
  if (issues.length > 0) return empty(generalPoolCents, specific);

  let base: AllocationRow[];
  let inceptionFinal: { poId: string; name: string; amountCents: Cents }[];
  try {
    const built = buildInceptionAllocation({
      generalPoolCents,
      allocatables: input.allocatables,
      specific: specificInputs,
    });
    base = built.base;
    inceptionFinal = built.inceptionFinal;
  } catch (error) {
    fail(
      "vc.allocation.preview",
      error instanceof VariableConsiderationError ? error.message : (error as Error).message,
    );
    return empty(generalPoolCents, specific);
  }

  const negative = inceptionFinal.filter((row) => row.amountCents < 0);
  for (const row of negative) {
    fail(
      "vc.allocation.po.nonnegative",
      `The amount allocated to "${row.name}" at inception is negative. A performance obligation cannot carry a negative allocation; review the variable consideration allocated specifically to it.`,
    );
  }
  if (negative.length > 0) return empty(generalPoolCents, specific);

  let total = 0n;
  for (const row of inceptionFinal) total += BigInt(row.amountCents);

  return {
    initialTransactionPriceCents: bigIntToCents(total, "initial transaction price"),
    generalPoolCents,
    base,
    specific,
    finalAllocations: inceptionFinal,
    issues,
  };
}
