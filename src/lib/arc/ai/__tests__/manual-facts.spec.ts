/**
 * Phase 9G-R Task R1 — untouched structural defaults are not accountant facts.
 */

import { describe, expect, it } from "vitest";

import { createEmptyDraft, createVcComponentDraft } from "@/lib/asc606-workflow";

import { manualAccountingFacts } from "../current-context";

describe("manual accounting facts", () => {
  it("omits untouched structural false defaults", () => {
    const facts = manualAccountingFacts(createEmptyDraft());
    expect(facts).not.toHaveProperty("hasVariableConsideration");
    expect(facts).not.toHaveProperty("hasContractModifications");
  });

  it("keeps an affirmative variable-consideration structure", () => {
    const draft = createEmptyDraft();
    draft.hasVariableConsideration = true;
    draft.variableConsiderationComponents = [createVcComponentDraft(1, "vc-1", "estimated")];
    expect(manualAccountingFacts(draft)["hasVariableConsideration"]).toBe(true);
  });

  it("keeps an affirmative modification structure", () => {
    const draft = createEmptyDraft();
    draft.hasContractModifications = true;
    expect(manualAccountingFacts(draft)["hasContractModifications"]).toBe(true);
  });

  it("keeps an ordinary fact the accountant really entered", () => {
    const draft = createEmptyDraft();
    draft.contract = { ...draft.contract, customerName: "Genomix Clinical Diagnostics LLC" };
    expect(manualAccountingFacts(draft)["contract.customerName"]).toBe(
      "Genomix Clinical Diagnostics LLC",
    );
  });
});
