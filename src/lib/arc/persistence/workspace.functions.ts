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

export interface ContractSummaryDto {
  id: string;
  title: string;
  contractNumber: string | null;
  status: "active" | "archived";
  updatedAt: string;
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
 * workspace. The draft revision starts from `createEmptyDraft()` so the stored
 * analysis is always a valid canonical input document.
 */
export const createContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { customerId: string; title: string; contractNumber?: string }) => ({
    customerId: z.string().uuid().parse(input?.customerId),
    title: nameSchema.parse(input?.title),
    contractNumber: z.string().trim().max(120).optional().parse(input?.contractNumber ?? undefined),
  }))
  .handler(
    async ({ data, context }): Promise<{ contractId: string; analysisId: string; revisionId: string }> => {
      const { data: contract, error: contractError } = await context.supabase
        .from("contracts")
        .insert({
          customer_id: data.customerId,
          title: data.title,
          contract_number: data.contractNumber && data.contractNumber.length > 0 ? data.contractNumber : null,
        })
        .select("id")
        .single();
      if (contractError || !contract) throw new Error("That contract could not be saved.");

      const { data: analysis, error: analysisError } = await context.supabase
        .from("analyses")
        .insert({ contract_id: contract.id })
        .select("id")
        .single();
      if (analysisError || !analysis) throw new Error("That contract's analysis could not be created.");

      const canonical = toCanonicalInputs(createEmptyDraft());
      const { data: revision, error: revisionError } = await context.supabase
        .from("analysis_revisions")
        .insert({
          analysis_id: analysis.id,
          revision_number: 1,
          canonical_inputs: canonical as unknown as never,
          schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
        })
        .select("id")
        .single();
      if (revisionError || !revision) throw new Error("That contract's draft could not be created.");

      return { contractId: contract.id, analysisId: analysis.id, revisionId: revision.id };
    },
  );
