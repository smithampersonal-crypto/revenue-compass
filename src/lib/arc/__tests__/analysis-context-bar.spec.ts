import { describe, expect, it } from "vitest";

import { buildAnalysisContextBar } from "@/lib/arc/analysis-context-bar";

const draftFields = { draftCustomerName: "", draftContractNumber: "" };

describe("analysis context bar", () => {
  it("shows an unsaved analysis with its draft identity and no persistence claim", () => {
    const model = buildAnalysisContextBar({
      persisted: null,
      sampleCustomer: null,
      draftCustomerName: "Horizon Global Logistics",
      draftContractNumber: "HGL-2026-01",
    });
    expect(model.title).toBe("Unsaved analysis");
    expect(model.status).toBe("Unsaved");
    expect(model.unsaved).toBe(true);
    expect(model.detail).toContain("Horizon Global Logistics");
    expect(model.detail).toContain("Not saved to My Contracts");
  });

  it("labels a sample without implying a saved contract", () => {
    const model = buildAnalysisContextBar({
      persisted: null,
      sampleCustomer: "Meridian Health",
      ...draftFields,
    });
    expect(model.title).toBe("Sample — Meridian Health");
    expect(model.status).toBe("Sample");
  });

  it("uses authoritative persisted identity for a saved draft revision", () => {
    const model = buildAnalysisContextBar({
      persisted: {
        contractTitle: "Horizon Global Logistics — SaaS Agreement",
        contractNumber: "HGL-2026-01",
        customerName: "Horizon Global Logistics",
        revisionNumber: 1,
        status: "draft",
      },
      sampleCustomer: null,
      // Edited Step 1 fields must never change the displayed identity.
      draftCustomerName: "Renamed In Form",
      draftContractNumber: "EDITED-999",
    });
    expect(model.title).toBe("Horizon Global Logistics — SaaS Agreement");
    expect(model.detail).toBe(
      "Horizon Global Logistics · Contract HGL-2026-01 · Revision 1 · Draft",
    );
    expect(model.status).toBe("Draft");
    expect(model.unsaved).toBe(false);
  });

  it("reflects finalized, superseded and later draft revisions", () => {
    const base = {
      contractTitle: "Contract",
      contractNumber: null,
      customerName: "Acme",
      sampleCustomer: null,
    };
    const finalized = buildAnalysisContextBar({
      persisted: { ...base, revisionNumber: 1, status: "finalized" },
      sampleCustomer: null,
      ...draftFields,
    });
    expect(finalized.status).toBe("Finalized");
    expect(finalized.detail).toBe("Acme · Revision 1 · Finalized");

    const superseded = buildAnalysisContextBar({
      persisted: { ...base, revisionNumber: 1, status: "superseded" },
      sampleCustomer: null,
      ...draftFields,
    });
    expect(superseded.status).toBe("Superseded");

    const amendment = buildAnalysisContextBar({
      persisted: { ...base, revisionNumber: 2, status: "draft" },
      sampleCustomer: null,
      ...draftFields,
    });
    expect(amendment.detail).toBe("Acme · Revision 2 · Draft");
  });
});
