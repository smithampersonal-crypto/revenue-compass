/**
 * Phase 9F — the ONE authorized controlled fictional live acceptance run.
 *
 * Developer-only. Never part of `bun run test`, `bun run verify` or CI. It
 * refuses to start without BOTH a configured OPENAI_API_KEY and an explicit
 * ARC_ALLOW_LIVE_PHASE9F=1 opt-in.
 *
 * It exercises the real production Phase 9F path end to end against a fresh
 * disposable authenticated workspace: real upload/commit boundary, real run
 * creation boundary, real orchestrator, real token count, real allowance
 * reservation, exactly one `responses.create`, real validation, real Phase 9E
 * merge and the real atomic application transaction.
 *
 * It prints no API key, no PDF bytes, no base64, no page text, no prompt, no
 * signed URL and no raw model response.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { GUIDANCE_REGISTRY_HASH } from "@/lib/arc/guidance/registry";
import { AI_LIMITS } from "@/lib/arc/ai/config.server";
import { createAiRunStore } from "@/lib/arc/ai/runs.store.server";
import { startAiAnalysisHandler, type AiCallerScope } from "@/lib/arc/ai/runs.handlers";
import { executeAiRunHandler } from "@/lib/arc/ai/orchestrator";
import { createExecutionBoundaries } from "@/lib/arc/ai/orchestrator.server";
import {
  finalizeUploadHandler,
  initiateUploadHandler,
  type DocumentDeps,
} from "@/lib/arc/documents/documents.handlers";
import { ARC_WORKFLOW_SCHEMA_VERSION, toCanonicalInputs } from "@/lib/arc/persistence/schema";
import { createEmptyDraft } from "@/lib/asc606-workflow/types";

const FIXTURE_PATH = path.join(process.cwd(), "fixtures", "genomix-synthesis-contract-package.pdf");
const FIXTURE_SHA256 = "7487979e42fb2dab23c6a6b4858806ae0d37831c63c0ddd98730fccf09fdd4c7";
const FIXTURE_BYTES = 56598;
const FIXTURE_PAGES = 4;

function fail(message: string): never {
  console.error(`\nPhase 9F live run refused: ${message}\n`);
  process.exit(1);
}

function say(label: string, value: unknown): void {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main(): Promise<void> {
  if (!process.env["OPENAI_API_KEY"]) fail("OPENAI_API_KEY is not configured.");
  if (process.env["ARC_ALLOW_LIVE_PHASE9F"] !== "1") {
    fail("ARC_ALLOW_LIVE_PHASE9F=1 is required.");
  }

  /* ------------------------------------------------ 1. fixture identity */
  const bytes = new Uint8Array(await readFile(FIXTURE_PATH));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== FIXTURE_SHA256) fail("fixture SHA-256 mismatch.");
  if (bytes.byteLength !== FIXTURE_BYTES) fail("fixture byte size mismatch.");
  const { validatePdfBytes } = await import("@/lib/arc/documents/validation.server");
  const validated = await validatePdfBytes(bytes);
  if (!validated.ok || validated.pageCount !== FIXTURE_PAGES) fail("fixture page count mismatch.");
  say("fixture", { sha256: sha, bytes: bytes.byteLength, pages: validated.pageCount });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  /* ----------------------------------- 2. fresh disposable workspace */
  const stamp = Date.now();
  const email = `phase9f-live-${stamp}@arc-fixture.invalid`;
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password: `Ph9F-${stamp}-${Math.random().toString(36).slice(2)}`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) fail("disposable account could not be created.");
  const userId = created.data.user.id;
  say("disposable user", userId);

  const customer = await supabaseAdmin
    .from("customers")
    .insert({ owner_user_id: userId, name: "Genomix Clinical Diagnostics LLC (fixture)" })
    .select("id")
    .single();
  if (customer.error || !customer.data) fail("disposable customer could not be created.");

  const contract = await supabaseAdmin
    .rpc("arc_create_contract_with_draft", {
      p_customer_id: customer.data.id,
      p_title: "Genomix / Synthesis BioAnalytics master agreement (fixture)",
      p_contract_number: "",
      p_canonical_inputs: toCanonicalInputs(createEmptyDraft()) as unknown as never,
      p_schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    })
    .single();
  if (contract.error || !contract.data) fail("disposable contract could not be created.");
  const { contract_id: contractId, revision_id: revisionId } = contract.data;
  say("disposable scope", { contractId, revisionId });

  /* ------------------------------ 3. real upload / commit / selection */
  const { documentStorage, documentStore } = await import(
    "@/lib/arc/documents/documents.store.server"
  );
  const docDeps: DocumentDeps = {
    store: await documentStore(),
    storage: documentStorage,
    now: () => new Date(),
  };
  const caller = { kind: "user", userId } as const;
  const intent = await initiateUploadHandler(docDeps, caller, {
    contractId,
    revisionId,
    originalFilename: "genomix-synthesis-contract-package.pdf",
    displayName: "Genomix / Synthesis contract package",
    documentType: "master_agreement",
    declaredByteSize: bytes.byteLength,
  });
  const uploaded = await supabaseAdmin.storage
    .from(intent.bucket)
    .uploadToSignedUrl(intent.path, intent.token, new Blob([bytes], { type: "application/pdf" }));
  if (uploaded.error) fail("the fixture could not be uploaded to private storage.");
  const finalized = await finalizeUploadHandler(docDeps, caller, { intentId: intent.intentId });
  if (!finalized.ok || !finalized.associated) fail("the fixture was not selected for the run.");
  say("source document", {
    documentId: finalized.sourceDocumentId,
    associated: finalized.associated,
    lockVersion: finalized.lockVersion,
  });

  /* ------------------------------ 4. preconditions before anything live */
  const store = await createAiRunStore();
  const scope: AiCallerScope = { kind: "revision", userId, revisionId, contractId };
  const active = await store.findActiveRunForScope({ revisionId, guestWorkspaceId: null });
  if (active) fail("an active run already exists for this scope.");
  const utcMonth = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
  const usedBefore = await store.monthlyUsage(userId, utcMonth);
  say("quota before", { used: usedBefore, limit: AI_LIMITS.userMonthlyRunLimit });
  if (usedBefore >= AI_LIMITS.userMonthlyRunLimit) fail("no allowance available.");
  say("configuration", {
    model: AI_LIMITS.model,
    reasoningEffort: AI_LIMITS.reasoningEffort,
    guidanceRegistryHash: GUIDANCE_REGISTRY_HASH,
  });

  /* --------------------------------------- 5. real run-creation boundary */
  const deps = {
    store,
    limits: {
      guestRunLimit: AI_LIMITS.guestRunLimit,
      userMonthlyRunLimit: AI_LIMITS.userMonthlyRunLimit,
      model: AI_LIMITS.model,
      reasoningEffort: AI_LIMITS.reasoningEffort,
      promptVersion: AI_LIMITS.promptVersion,
      outputSchemaVersion: AI_LIMITS.outputSchemaVersion,
      guidanceRegistryHash: GUIDANCE_REGISTRY_HASH,
    },
    now: () => new Date(),
    newRunId: () => crypto.randomUUID(),
  };
  const startStatus = await startAiAnalysisHandler(deps, scope);
  say("run created", { runId: startStatus.runId, stage: startStatus.stage });

  /* ---------------------------------------- 6. the real 9F orchestrator */
  const boundaries = await createExecutionBoundaries();
  const started = Date.now();
  const final = await executeAiRunHandler({ ...deps, ...boundaries }, scope, {
    runId: startStatus.runId,
  });
  say("orchestration", { ...final, elapsedSeconds: Math.round((Date.now() - started) / 1000) });

  const usedAfter = await store.monthlyUsage(userId, utcMonth);
  say("quota after", { used: usedAfter, limit: AI_LIMITS.userMonthlyRunLimit });
  say("readback keys", { userId, contractId, revisionId, runId: startStatus.runId });
}

await main();
