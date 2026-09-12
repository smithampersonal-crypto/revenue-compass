/**
 * Phase 7C — workspace server functions (customers and contracts).
 *
 * Every handler runs caller-scoped: it uses the authenticated Supabase client
 * from `requireSupabaseAuth`, so row-level security is exercised on each read
 * and write. The service-role client is never used here.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createEmptyDraft } from "@/lib/asc606-workflow";

import { ARC_WORKFLOW_SCHEMA_VERSION, toCanonicalInputs } from "./schema";

/**
 * The contract's authoritative current working state, so My Contracts can show
 * it and offer the right action without a per-contract request.
 *
 * A superseded revision is history and is never reported here as the current
 * state: only an active draft, or the analysis's current finalized revision.
 */
export interface ContractRevisionStateDto {
  kind: "draft" | "finalized" | "none";
  revisionId: string | null;
  revisionNumber: number | null;
  /** The revision number a new revision would take. */
  nextRevisionNumber: number;
}

export interface ContractSummaryDto {
  id: string;
  title: string;
  contractNumber: string | null;
  status: "active" | "archived";
  updatedAt: string;
  revisionState: ContractRevisionStateDto;
}

export interface CustomerWithContractsDto {
  id: string;
  name: string;
  contracts: ContractSummaryDto[];
}

const nameSchema = z.string().trim().min(1, "A name is required").max(200);

/** Lists the caller's customers with their contracts. */
export const listWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ customers: CustomerWithContractsDto[] }> => {
    const { data: customers, error: customersError } = await context.supabase
      .from("customers")
      .select("id, name")
      .order("name", { ascending: true });
    if (customersError) throw new Error("Your saved customers could not be loaded.");

    const { data: contracts, error: contractsError } = await context.supabase
      .from("contracts")
      .select("id, customer_id, title, contract_number, status, updated_at")
      .order("updated_at", { ascending: false });
    if (contractsError) throw new Error("Your saved contracts could not be loaded.");

    // Two set-based, caller-scoped reads cover every contract, so the browser
    // never issues one request per contract to learn its working state.
    const contractIds = (contracts ?? []).map((contract) => contract.id);
    const analyses = contractIds.length
      ? await context.supabase
          .from("analyses")
          .select("id, contract_id, current_finalized_revision_id")
          .in("contract_id", contractIds)
      : { data: [], error: null };
    if (analyses.error) throw new Error("Your saved contracts could not be loaded.");

    const analysisIds = (analyses.data ?? []).map((analysis) => analysis.id);
    const revisions = analysisIds.length
      ? await context.supabase
          .from("analysis_revisions")
          .select("id, analysis_id, revision_number, status")
          .in("analysis_id", analysisIds)
      : { data: [], error: null };
    if (revisions.error) throw new Error("Your saved contracts could not be loaded.");

    function revisionState(contractId: string): ContractRevisionStateDto {
      const analysis = (analyses.data ?? []).find((row) => row.contract_id === contractId);
      const rows = analysis
        ? (revisions.data ?? []).filter((row) => row.analysis_id === analysis.id)
        : [];
      const highest = rows.reduce((max, row) => Math.max(max, row.revision_number), 0);
      const nextRevisionNumber = highest + 1;

      const draft = rows.find((row) => row.status === "draft");
      if (draft) {
        return {
          kind: "draft",
          revisionId: draft.id,
          revisionNumber: draft.revision_number,
          nextRevisionNumber,
        };
      }
      const finalized = analysis?.current_finalized_revision_id
        ? rows.find((row) => row.id === analysis.current_finalized_revision_id)
        : undefined;
      if (finalized) {
        return {
          kind: "finalized",
          revisionId: finalized.id,
          revisionNumber: finalized.revision_number,
          nextRevisionNumber,
        };
      }
      return { kind: "none", revisionId: null, revisionNumber: null, nextRevisionNumber };
    }

    return {
      customers: (customers ?? []).map((customer) => ({
        id: customer.id,
        name: customer.name,
        contracts: (contracts ?? [])
          .filter((contract) => contract.customer_id === customer.id)
          .map((contract) => ({
            id: contract.id,
            title: contract.title,
            contractNumber: contract.contract_number,
            status: contract.status,
            updatedAt: contract.updated_at,
            revisionState: revisionState(contract.id),
          })),
      })),
    };
  });

/** Creates a customer owned by the caller. */
export const createCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => ({ name: nameSchema.parse(input?.name) }))
  .handler(async ({ data, context }): Promise<{ customerId: string }> => {
    const { data: created, error } = await context.supabase
      .from("customers")
      .insert({ owner_user_id: context.userId, name: data.name })
      .select("id")
      .single();
    if (error || !created) throw new Error("That customer could not be saved.");
    return { customerId: created.id };
  });

/**
 * Creates a contract, its analysis and an empty draft revision in the caller's
 * workspace as one database transaction: either the whole hierarchy exists or
 * nothing does. The trusted function is SECURITY INVOKER, so caller identity
 * and row-level security remain authoritative. The draft revision starts from
 * `createEmptyDraft()` so the stored analysis is always a valid canonical
 * input document.
 */
export const createContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { customerId: string; title: string; contractNumber?: string }) => ({
    customerId: z.string().uuid().parse(input?.customerId),
    title: nameSchema.parse(input?.title),
    contractNumber: z
      .string()
      .trim()
      .max(120)
      .optional()
      .parse(input?.contractNumber ?? undefined),
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ contractId: string; analysisId: string; revisionId: string }> => {
      const canonical = toCanonicalInputs(createEmptyDraft());

      const { data: created, error } = await context.supabase
        .rpc("arc_create_contract_with_draft", {
          p_customer_id: data.customerId,
          p_title: data.title,
          p_contract_number: data.contractNumber ?? "",
          p_canonical_inputs: canonical as unknown as never,
          p_schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
        })
        .single();

      if (error || !created) throw new Error("That contract could not be saved.");

      return {
        contractId: created.contract_id,
        analysisId: created.analysis_id,
        revisionId: created.revision_id,
      };
    },
  );
