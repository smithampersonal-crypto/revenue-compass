/**
 * Phase 9D — Task 7. The strict semantic AI contract.
 *
 * `AiContractAnalysis` is deliberately NOT `WorkflowDraft`. The model returns
 * accounting MEANING: contractual facts, ASC 606 judgments, citations,
 * Guidance references and review-state signals. It never returns ARC
 * persistence identities, deterministic engine output, revenue schedules,
 * contract balances or journal entries — Phase 9E owns the translation of this
 * semantic output into canonical ARC structures.
 *
 * Browser-safe: no OpenAI SDK, no server config, no environment access.
 */

import { z } from "zod";

/** Single source of truth for the output-schema version (9C aligned). */
export const AI_OUTPUT_SCHEMA_VERSION = "arc.ai.schema.v1";

/** Strict structured-output schema name sent to the Responses API. */
export const AI_OUTPUT_SCHEMA_NAME = "arc_ai_contract_analysis";

/**
 * Authoritative ARC identities the model may never own. Phase 9E constructs
 * every one of these deterministically. A schema property using any of these
 * names is a design error and is asserted against in the schema regressions.
 */
export const FORBIDDEN_MODEL_IDENTITY_KEYS: readonly string[] = [
  "id",
  "uuid",
  "revisionId",
  "contractId",
  "analysisId",
  "customerId",
  "performanceObligationId",
  "considerationEventId",
  "billingEventId",
  "journalEntryId",
];

/** Deterministic engine output the model may never produce. */
export const FORBIDDEN_ENGINE_OUTPUT_KEYS: readonly string[] = [
  "revenueSchedule",
  "scheduleRows",
  "recognizedRevenue",
  "deferredRevenue",
  "contractAsset",
  "contractLiability",
  "journalEntries",
  "allocatedAmount",
  "collections",
  "cashReceived",
];

/** Bounds protecting request/response size. Every array and string is capped. */
export const AI_SCHEMA_BOUNDS = {
  semanticKey: 120,
  shortText: 300,
  text: 2000,
  summary: 4000,
  excerpt: 500,
  citationsPerItem: 12,
  guidanceIdsPerItem: 25,
  documents: 40,
  promises: 60,
  performanceObligations: 40,
  variableComponents: 40,
  sspItems: 40,
  recognitionProposals: 40,
  billingTerms: 40,
  additionalTopics: 20,
  issues: 60,
  parties: 12,
  relatedKeys: 20,
} as const;

/* ------------------------------------------------------------------ atoms */

const semanticKeySchema = z.string().min(1).max(AI_SCHEMA_BOUNDS.semanticKey);
const shortText = z.string().min(1).max(AI_SCHEMA_BOUNDS.shortText);
const longText = z.string().min(1).max(AI_SCHEMA_BOUNDS.text);
const nullableShortText = z.string().max(AI_SCHEMA_BOUNDS.shortText).nullable();

/**
 * Decimal-safe string input. Amounts observed in the contract travel as exact
 * strings; ARC never accepts a floating-point amount from the model and never
 * treats these as computed engine values.
 */
export const DECIMAL_INPUT_PATTERN = /^-?\d{1,15}(\.\d{1,6})?$/;
const DECIMAL_INPUT_DESCRIPTION =
  "Bare decimal number only, e.g. 245000 or 1.35. No currency symbol, words, " +
  "percent sign, thousands separator, range or unit. Put any wording in the " +
  "surrounding descriptive fields. Use null when no single exact amount applies.";
const decimalInput = z
  .string()
  .max(32)
  .regex(DECIMAL_INPUT_PATTERN, "must be a bare decimal string")
  .describe(DECIMAL_INPUT_DESCRIPTION)
  .nullable();

export const AI_REVIEW_STATES = [
  "supported",
  "inference",
  "needs_review",
  "source_conflict",
  "needs_user_input",
] as const;
export const reviewStateSchema = z.enum(AI_REVIEW_STATES);
export type AiReviewState = (typeof AI_REVIEW_STATES)[number];

export const citationSchema = z
  .object({
    documentId: z.string().min(1).max(120),
    pageStart: z.number().int().min(1),
    pageEnd: z.number().int().min(1),
    evidenceMode: z.enum(["text", "visual"]),
    excerpt: z.string().max(AI_SCHEMA_BOUNDS.excerpt).nullable(),
  })
  .strict();
export type AiCitation = z.infer<typeof citationSchema>;

const citations = z.array(citationSchema).max(AI_SCHEMA_BOUNDS.citationsPerItem);
const guidanceIds = z.array(z.number().int().positive()).max(AI_SCHEMA_BOUNDS.guidanceIdsPerItem);

const outcomeSchema = z.enum(["yes", "no", "unknown"]);

/** A material accounting conclusion always carries provenance. */
const judgmentSchema = z
  .object({
    outcome: outcomeSchema,
    rationale: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

/** An extracted administrative fact: contract citations required, guidance optional. */
const factSchema = z
  .object({
    value: nullableShortText,
    rationale: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

/* -------------------------------------------------------------- sections */

const logicalDocumentSchema = z
  .object({
    semanticKey: semanticKeySchema,
    documentType: z.enum([
      "master_agreement",
      "order_form",
      "statement_of_work",
      "amendment",
      "sla",
      "pricing_schedule",
      "exhibit",
      "other",
    ]),
    title: shortText,
    effectiveDate: nullableShortText,
    relationshipToAgreement: longText,
    citations,
    reviewState: reviewStateSchema,
  })
  .strict();

const contractAssessmentSchema = z
  .object({
    parties: z
      .array(
        z
          .object({
            semanticKey: semanticKeySchema,
            name: shortText,
            role: z.enum(["customer", "provider", "affiliate", "other"]),
            citations,
            reviewState: reviewStateSchema,
          })
          .strict(),
      )
      .max(AI_SCHEMA_BOUNDS.parties),
    contractEffectiveDate: factSchema,
    contractTerm: factSchema,
    approvalAndCommitment: judgmentSchema,
    identifiableRights: judgmentSchema,
    identifiablePaymentTerms: judgmentSchema,
    commercialSubstance: judgmentSchema,
    collectibility: judgmentSchema,
    terminationRights: factSchema,
    renewalTerms: factSchema,
    currency: factSchema,
  })
  .strict();

const promiseSchema = z
  .object({
    semanticKey: semanticKeySchema,
    description: longText,
    promiseType: z.enum([
      "hosted_service",
      "license",
      "implementation",
      "professional_service",
      "support",
      "training",
      "validation",
      "equipment",
      "warranty",
      "option",
      "other",
    ]),
    otherPromiseTypeDescription: nullableShortText,
    explicitOrImplicit: z.enum(["explicit", "implicit", "unknown"]),
    distinctCapableOfBeingDistinct: outcomeSchema,
    distinctSeparatelyIdentifiable: outcomeSchema,
    distinctConclusion: outcomeSchema,
    distinctnessRationale: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

const performanceObligationSchema = z
  .object({
    semanticKey: semanticKeySchema,
    promiseKeys: z.array(semanticKeySchema).max(AI_SCHEMA_BOUNDS.promises),
    description: longText,
    groupingRationale: longText,
    satisfactionPattern: z.enum(["point_in_time", "over_time", "unknown"]),
    recognitionRationale: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

const variableComponentSchema = z
  .object({
    semanticKey: semanticKeySchema,
    description: longText,
    type: z.enum([
      "usage",
      "service_credit",
      "rebate",
      "refund",
      "bonus",
      "penalty",
      "discount",
      "other",
    ]),
    contractualRateOrAmountInput: decimalInput,
    unitDescription: nullableShortText,
    billingFrequency: nullableShortText,
    trigger: longText,
    estimationMethodProposal: z.enum([
      "expected_value",
      "most_likely_amount",
      "not_estimable",
      "unknown",
    ]),
    constraintAssessment: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

const transactionPriceSchema = z
  .object({
    currency: factSchema,
    fixedConsiderationInput: decimalInput,
    fixedConsiderationRationale: longText,
    fixedConsiderationCitations: citations,
    variableConsiderationComponents: z
      .array(variableComponentSchema)
      .max(AI_SCHEMA_BOUNDS.variableComponents),
    financingAssessment: judgmentSchema,
    noncashConsideration: judgmentSchema,
    considerationPayableToCustomer: judgmentSchema,
    transactionPriceConclusion: z
      .object({
        conclusion: longText,
        rationale: longText,
        citations,
        guidanceIds,
        reviewState: reviewStateSchema,
      })
      .strict(),
  })
  .strict();

const sspItemSchema = z
  .object({
    semanticKey: semanticKeySchema,
    appliesToKey: semanticKeySchema,
    observableSspEvidence: z.enum(["observable", "not_observable", "unknown"]),
    observedAmountInput: decimalInput,
    proposedMethod: z.enum([
      "observable_price",
      "adjusted_market_assessment",
      "expected_cost_plus_margin",
      "residual",
      "insufficient_information",
    ]),
    methodRationale: longText,
    missingInformation: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

const sspAndAllocationSchema = z
  .object({
    relativeAllocationApplicable: judgmentSchema,
    items: z.array(sspItemSchema).max(AI_SCHEMA_BOUNDS.sspItems),
    discountOrVariableAllocationConsiderations: longText,
  })
  .strict();

const recognitionProposalSchema = z
  .object({
    performanceObligationKey: semanticKeySchema,
    satisfactionPattern: z.enum(["point_in_time", "over_time", "unknown"]),
    recognitionMethod: z.enum([
      "ratable_over_time",
      "input_method",
      "output_method",
      "point_in_time_transfer",
      "unknown",
    ]),
    serviceStartDate: nullableShortText,
    serviceEndDate: nullableShortText,
    measureDescription: nullableShortText,
    recognitionEventDescription: nullableShortText,
    recognitionDateIfContractuallyDeterminable: nullableShortText,
    rationale: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

const contractModificationsSchema = z
  .object({
    hasModification: outcomeSchema,
    effectiveDate: nullableShortText,
    addedGoodsOrServices: nullableShortText,
    addedGoodsDistinct: outcomeSchema,
    priceIncreaseInput: decimalInput,
    priceReflectsSsp: outcomeSchema,
    remainingGoodsDistinct: outcomeSchema,
    treatmentCandidate: z.enum([
      "separate_contract",
      "prospective",
      "cumulative_catch_up",
      "mixed",
      "not_applicable",
      "needs_user_input",
    ]),
    rationale: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

const billingTermSchema = z
  .object({
    semanticKey: semanticKeySchema,
    description: longText,
    billingTiming: z.enum(["advance", "arrears", "milestone", "on_usage", "unknown"]),
    frequency: z.enum([
      "one_time",
      "monthly",
      "quarterly",
      "semiannual",
      "annual",
      "on_event",
      "unknown",
    ]),
    invoiceTrigger: longText,
    amountOrRateInput: decimalInput,
    paymentTermsDays: z.number().int().min(0).max(1000).nullable(),
    dueDateRule: nullableShortText,
    citations,
    reviewState: reviewStateSchema,
  })
  .strict();

const projectedCollectionAssumptionsSchema = z
  .object({
    contractualDueDateBasis: z.enum([
      "invoice_date_plus_terms",
      "fixed_calendar_date",
      "milestone_event",
      "unknown",
    ]),
    paymentTermsDays: z.number().int().min(0).max(1000).nullable(),
    basisExplanation: longText,
    citations,
    reviewState: reviewStateSchema,
  })
  .strict();

const additionalTopicSchema = z
  .object({
    topic: z.enum([
      "principal_agent",
      "warranties",
      "licenses",
      "material_rights",
      "significant_financing",
      "contract_costs",
      "nonrefundable_upfront_fees",
      "repurchase_arrangements",
      "consignment",
      "bill_and_hold",
      "customer_acceptance",
      "breakage",
      "other",
    ]),
    applicable: outcomeSchema,
    conclusion: longText,
    rationale: longText,
    citations,
    guidanceIds,
    reviewState: reviewStateSchema,
  })
  .strict();

const issueSchema = z
  .object({
    semanticKey: semanticKeySchema,
    section: z.enum([
      "documents",
      "step_1",
      "step_2",
      "step_3",
      "step_4",
      "step_5",
      "billing",
      "modifications",
      "additional_topics",
    ]),
    reviewState: reviewStateSchema,
    message: longText,
    relatedSemanticKeys: z.array(semanticKeySchema).max(AI_SCHEMA_BOUNDS.relatedKeys),
    citations,
    guidanceIds,
  })
  .strict();

/* ------------------------------------------------------------ root object */

/** Plain object form — the JSON Schema is generated from exactly this. */
export const aiContractAnalysisObjectSchema = z
  .object({
    schemaVersion: z.string().min(1).max(64),
    analysisSummary: z.string().min(1).max(AI_SCHEMA_BOUNDS.summary),
    logicalDocuments: z.array(logicalDocumentSchema).max(AI_SCHEMA_BOUNDS.documents),
    contractAssessment: contractAssessmentSchema,
    promises: z.array(promiseSchema).max(AI_SCHEMA_BOUNDS.promises),
    performanceObligations: z
      .array(performanceObligationSchema)
      .max(AI_SCHEMA_BOUNDS.performanceObligations),
    transactionPrice: transactionPriceSchema,
    sspAndAllocation: sspAndAllocationSchema,
    recognitionProposals: z
      .array(recognitionProposalSchema)
      .max(AI_SCHEMA_BOUNDS.recognitionProposals),
    contractModifications: contractModificationsSchema,
    billingTerms: z.array(billingTermSchema).max(AI_SCHEMA_BOUNDS.billingTerms),
    projectedCollectionAssumptions: projectedCollectionAssumptionsSchema,
    additionalTopics: z.array(additionalTopicSchema).max(AI_SCHEMA_BOUNDS.additionalTopics),
    issues: z.array(issueSchema).max(AI_SCHEMA_BOUNDS.issues),
  })
  .strict();

/**
 * Local validation schema. ARC re-validates every response independently: a
 * response is never trusted merely because the API accepted the JSON schema.
 */
export const aiContractAnalysisSchema = aiContractAnalysisObjectSchema.superRefine((value, ctx) => {
  const visitCitation = (citation: AiCitation, path: (string | number)[]) => {
    if (citation.pageEnd < citation.pageStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "pageEnd"],
        message: "pageEnd must be greater than or equal to pageStart",
      });
    }
    if (citation.evidenceMode === "text") {
      if (citation.excerpt === null || citation.excerpt.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "excerpt"],
          message: "a text citation requires a non-blank excerpt",
        });
      }
    }
  };

  const walk = (node: unknown, path: (string | number)[]) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, [...path, index]));
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (
      typeof record["documentId"] === "string" &&
      typeof record["pageStart"] === "number" &&
      typeof record["evidenceMode"] === "string"
    ) {
      visitCitation(record as unknown as AiCitation, path);
      return;
    }
    for (const [key, child] of Object.entries(record)) walk(child, [...path, key]);
  };

  walk(value, []);

  for (const amount of collectDecimalInputs(value)) {
    if (amount !== null && !DECIMAL_INPUT_PATTERN.test(amount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactionPrice"],
        message: `amount "${amount}" is not a decimal-safe string`,
      });
    }
  }
});

const DECIMAL_FIELD_NAMES = new Set([
  "fixedConsiderationInput",
  "contractualRateOrAmountInput",
  "observedAmountInput",
  "amountOrRateInput",
  "priceIncreaseInput",
]);

function collectDecimalInputs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectDecimalInputs(entry, found);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (DECIMAL_FIELD_NAMES.has(key) && typeof child === "string") found.push(child);
    else collectDecimalInputs(child, found);
  }
  return found;
}

export type AiContractAnalysis = z.infer<typeof aiContractAnalysisObjectSchema>;

/* ----------------------------------------------------- JSON Schema output */

type JsonSchema = Record<string, unknown>;

/**
 * Minimal deterministic zod -> strict JSON Schema conversion for exactly the
 * subset used above. Generating rather than hand-authoring guarantees the
 * strict wire schema and the local Zod validator can never drift apart:
 * every object lists all properties in `required` and sets
 * `additionalProperties: false`; optionality is expressed as nullability.
 */
export function toStrictJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName: string; [key: string]: unknown };

  switch (def["typeName"]) {
    case "ZodObject": {
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
      const properties: JsonSchema = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = toStrictJsonSchema(child as z.ZodTypeAny);
        required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodArray": {
      const inner = (def["type"] as z.ZodTypeAny) ?? z.unknown();
      const out: JsonSchema = { type: "array", items: toStrictJsonSchema(inner) };
      const max = def["maxLength"] as { value: number } | null;
      if (max) out["maxItems"] = max.value;
      return out;
    }
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      for (const check of (def["checks"] as Array<{
        kind: string;
        value: number;
        regex?: RegExp;
      }>) ?? []) {
        if (check.kind === "min") out["minLength"] = check.value;
        if (check.kind === "max") out["maxLength"] = check.value;
        if (check.kind === "regex" && check.regex) out["pattern"] = check.regex.source;
      }
      return out;
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "integer" };
      for (const check of (def["checks"] as Array<{ kind: string; value: number }>) ?? []) {
        if (check.kind === "min") out["minimum"] = check.value;
        if (check.kind === "max") out["maximum"] = check.value;
        if (check.kind === "int") out["type"] = "integer";
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: [...(def["values"] as string[])] };
    case "ZodNullable": {
      const innerSchema = def["innerType"] as z.ZodTypeAny;
      const inner = toStrictJsonSchema(innerSchema);
      const described = (innerSchema._def as { description?: string }).description;
      if (described) inner["description"] = described;
      const type = inner["type"];
      return {
        ...inner,
        type: Array.isArray(type) ? [...type, "null"] : [type as string, "null"],
      };
    }
    case "ZodEffects":
      return toStrictJsonSchema(def["schema"] as z.ZodTypeAny);
    default:
      throw new Error(`Unsupported zod node in AI schema: ${String(def["typeName"])}`);
  }
}

/** The exact strict JSON Schema sent as the Responses structured-output format. */
export const aiContractAnalysisJsonSchema: JsonSchema = toStrictJsonSchema(
  aiContractAnalysisObjectSchema,
);

/** Safe parse helper used by the client after every generation. */
export function parseAiContractAnalysis(
  value: unknown,
): { ok: true; analysis: AiContractAnalysis } | { ok: false; issues: string[] } {
  const result = aiContractAnalysisSchema.safeParse(value);
  if (result.success) return { ok: true, analysis: result.data };
  return {
    ok: false,
    issues: result.error.issues
      .slice(0, 40)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
  };
}

/** Every citation in an analysis, with a stable dotted location path. */
export function collectCitations(
  analysis: AiContractAnalysis,
): Array<{ path: string; citation: AiCitation }> {
  const out: Array<{ path: string; citation: AiCitation }> = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (
      typeof record["documentId"] === "string" &&
      typeof record["pageStart"] === "number" &&
      typeof record["evidenceMode"] === "string"
    ) {
      out.push({ path, citation: record as unknown as AiCitation });
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(analysis, "");
  return out;
}

/** Every guidance ID reference in an analysis, with its location path. */
export function collectGuidanceIds(
  analysis: AiContractAnalysis,
): Array<{ path: string; guidanceId: number }> {
  const out: Array<{ path: string; guidanceId: number }> = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (key === "guidanceIds" && Array.isArray(child)) {
        child.forEach((value, index) => {
          if (typeof value === "number") {
            out.push({ path: `${childPath}[${index}]`, guidanceId: value });
          }
        });
        continue;
      }
      walk(child, childPath);
    }
  };
  walk(analysis, "");
  return out;
}
