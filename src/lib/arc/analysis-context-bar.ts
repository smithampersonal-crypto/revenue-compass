/**
 * Presentation-only view model for the persistent Analysis Context Bar.
 *
 * Identity for a saved analysis comes from the server-loaded revision
 * metadata, never from the editable Step 1 draft fields: editing a contract
 * title or customer inside the analysis must not change which saved Contract
 * record the workspace claims to have open.
 */

export type AnalysisContextStatus = "Draft" | "Finalized" | "Superseded" | "Unsaved" | "Sample";

export interface AnalysisContextBarModel {
  /** Strong first line. */
  title: string;
  /** Muted metadata line; empty when there is nothing authoritative to show. */
  detail: string;
  status: AnalysisContextStatus;
  /** True for anything not persisted to My Contracts. */
  unsaved: boolean;
}

export interface PersistedAnalysisIdentity {
  contractTitle: string;
  contractNumber: string | null;
  customerName: string;
  revisionNumber: number;
  status: "draft" | "finalized" | "superseded";
}

const STATUS_LABEL = {
  draft: "Draft",
  finalized: "Finalized",
  superseded: "Superseded",
} as const;

function join(parts: (string | null | undefined)[]): string {
  return parts.filter((part) => part && part.trim() !== "").join(" · ");
}

export function buildAnalysisContextBar({
  persisted,
  sampleCustomer,
  draftCustomerName,
  draftContractNumber,
}: {
  persisted: PersistedAnalysisIdentity | null;
  /** Customer of the loaded sample scenario, when one is open. */
  sampleCustomer: string | null;
  draftCustomerName: string;
  draftContractNumber: string;
}): AnalysisContextBarModel {
  if (persisted) {
    return {
      title: persisted.contractTitle.trim() || "Saved analysis",
      detail: join([
        persisted.customerName.trim(),
        persisted.contractNumber?.trim() ? `Contract ${persisted.contractNumber.trim()}` : null,
        `Revision ${persisted.revisionNumber}`,
        STATUS_LABEL[persisted.status],
      ]),
      status: STATUS_LABEL[persisted.status],
      unsaved: false,
    };
  }

  if (sampleCustomer) {
    return {
      title: `Sample — ${sampleCustomer}`,
      detail: "",
      status: "Sample",
      unsaved: true,
    };
  }

  return {
    title: "Unsaved analysis",
    detail: join([
      draftCustomerName.trim() || null,
      draftContractNumber.trim() ? `Contract ${draftContractNumber.trim()}` : null,
      "Not saved to My Contracts",
    ]),
    status: "Unsaved",
    unsaved: true,
  };
}
