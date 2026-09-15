/**
 * Explicit ARC machine policy for the Guidance Registry.
 *
 * This module is keyed by the workbook's stable `Item No.` IDs and is
 * deliberately independent of the workbook prose. No NLP, no embeddings, no
 * model classification: every enforcement decision below is written, reviewed
 * and versioned as TypeScript.
 *
 * Policy must be total over the Approved card ID space. `getGuidancePolicy`
 * fails closed for any unknown ID so a new workbook card can never silently
 * run without reviewed machine policy.
 */

import type {
  GuidanceEngineSupport,
  GuidanceFinalizationImpact,
  GuidanceMachinePolicy,
  GuidanceReviewSection,
} from "./types";

/** Number of stable card IDs covered by this policy revision. */
export const POLICY_CARD_ID_COUNT = 116;

export const POLICY_CARD_IDS: readonly number[] = Array.from(
  { length: POLICY_CARD_ID_COUNT },
  (_, index) => index + 1,
);

/** Stable ID ranges for the workbook's six topics. */
const REVIEW_SECTION_RANGES: ReadonlyArray<{
  from: number;
  to: number;
  section: GuidanceReviewSection;
}> = [
  { from: 1, to: 10, section: "step_1" },
  { from: 11, to: 24, section: "step_2" },
  { from: 25, to: 43, section: "step_3" },
  { from: 44, to: 57, section: "step_4" },
  { from: 58, to: 77, section: "step_5" },
  { from: 78, to: 116, section: "additional_topics" },
];

/** Proposal domains by stable ID range. */
const DOMAIN_RANGES: ReadonlyArray<{ from: number; to: number; domains: readonly string[] }> = [
  { from: 1, to: 10, domains: ["contract_terms"] },
  { from: 11, to: 24, domains: ["performance_obligations"] },
  { from: 25, to: 43, domains: ["transaction_price", "variable_consideration"] },
  { from: 44, to: 57, domains: ["allocation"] },
  { from: 58, to: 77, domains: ["recognition"] },
  { from: 78, to: 82, domains: ["material_rights"] },
  { from: 83, to: 84, domains: ["returns_and_warranties"] },
  { from: 85, to: 91, domains: ["special_arrangements"] },
  { from: 92, to: 95, domains: ["licensing"] },
  { from: 96, to: 99, domains: ["contract_modifications"] },
  { from: 100, to: 101, domains: ["contract_balances"] },
  { from: 102, to: 104, domains: ["contract_costs"] },
  { from: 105, to: 111, domains: ["saas_and_usage"] },
  { from: 112, to: 112, domains: ["transaction_price"] },
  { from: 113, to: 113, domains: ["performance_obligations"] },
  { from: 114, to: 114, domains: ["material_rights", "variable_consideration"] },
  { from: 115, to: 115, domains: ["contract_balances"] },
  { from: 116, to: 116, domains: ["policy_elections"] },
];

/**
 * The minimal core pack. These cards are the deterministic backbone of every
 * ARC analysis (one card per authoritative engine gate), so they are supplied
 * to every Guidance Pack regardless of contract facts.
 */
export const CORE_GUIDANCE_IDS: readonly number[] = [
  1, 11, 18, 25, 44, 45, 58, 59, 69, 100,
];

/** Areas where the deterministic ARC engines already own the calculation. */
const FULL_SUPPORT_IDS = new Set<number>([
  1, 3, 11, 12, 18, 19, 20, 21, 22, 25, 27, 28, 29, 30, 32, 33, 34, 44, 45, 46, 47, 50, 52, 53, 54,
  58, 59, 62, 69, 70, 71, 77, 78, 79, 80, 81, 96, 97, 98, 99, 100, 101, 105, 106, 107, 110, 115,
]);

/** Areas the engines model only in part. */
const PARTIAL_SUPPORT_IDS = new Set<number>([
  9, 10, 42, 43, 48, 49, 51, 55, 56, 57, 67, 68, 73, 75, 82, 93, 94, 95, 108, 109, 111, 114,
]);

/** Accounting the ARC engines deliberately do not implement today. */
const NOT_SUPPORTED_IDS = new Set<number>([
  26, 31, 35, 36, 37, 38, 39, 40, 41, 61, 63, 64, 65, 66, 72, 74, 76, 83, 84, 85, 86, 87, 88, 89,
  90, 91, 102, 103, 104, 112, 113, 116,
]);

/** Cards whose unresolved review state blocks finalization. */
const BLOCKING_IDS = new Set<number>(CORE_GUIDANCE_IDS);

/**
 * Dependency expansion. Expansion runs only from cards that were actually
 * retrieved from contract facts (never from the core pack), so a core card can
 * never silently drag specialised guidance into every analysis.
 */
const RELATED_GUIDANCE: Readonly<Record<number, readonly number[]>> = {
  9: [1],
  12: [22, 77],
  18: [19, 20],
  22: [77],
  27: [28, 29, 32, 34],
  32: [33],
  35: [36, 37, 38],
  42: [43],
  45: [46, 47],
  48: [49],
  50: [51],
  55: [56],
  78: [79, 80, 81],
  82: [78],
  92: [],
  93: [94],
  94: [95],
  96: [97, 98, 99],
  100: [101],
  101: [100],
  105: [92, 106],
  106: [77],
  107: [27, 32],
  108: [27, 32],
  109: [27, 32, 114],
  110: [27, 32, 107],
  111: [27, 32],
  114: [27, 78],
  115: [100, 101],
};

/**
 * Broad, contextual vocabulary. A workbook tag in this set describes the
 * general setting of an arrangement and can never by itself select a
 * specialised card: "SaaS" must not pull SLA-credit guidance, and "discount"
 * must not pull the material-right package.
 */
export const BROAD_SIGNALS: ReadonlySet<string> = new Set([
  "ai",
  "ai api",
  "approval",
  "bundle",
  "cloud",
  "control",
  "credit",
  "discount",
  "distinct",
  "hosting",
  "license",
  "materiality",
  "option",
  "penalty",
  "phase 5a",
  "phase 5b",
  "phase 5b limitation",
  "phase 5c",
  "policy",
  "policy election",
  "presentation",
  "revenue",
  "rights",
  "saas",
  "series",
  "service",
  "special topic",
  "step1",
  "step2",
  "step3",
  "step4",
  "step5",
  "support",
  "technology",
  "usage",
  "32 40",
  "25 27",
  "25 30",
  "25 27(a)",
  "25 27(b)",
  "25 27(c)",
  "25 28",
  "25 29",
]);

/**
 * Curated strong retrieval signals, added to each card's specific workbook
 * tags. These are the phrases an actual contract uses for the fact pattern the
 * card governs.
 */
export const CURATED_RETRIEVAL_SIGNALS: Readonly<Record<number, readonly string[]>> = {
  1: ["signed by both parties", "executed agreement"],
  3: ["initial term", "subscription term", "term of 24 months", "auto renew", "automatic renewal"],
  4: ["terminate for convenience", "cancel at any time"],
  9: ["executed on the same date", "negotiated as a package"],
  10: ["price concession", "credit risk"],
  12: ["recurring service", "monthly service"],
  15: ["implementation services", "onboarding services", "setup services"],
  17: ["shipping and handling", "freight"],
  22: ["stand ready", "continuous access", "hosted access"],
  23: ["implementation", "configuration services"],
  27: [
    "overage",
    "overages",
    "service credit",
    "service credits",
    "usage based fee",
    "per sample",
    "variable fee",
    "true up",
    "rebate",
    "performance bonus",
  ],
  32: ["constrained", "significant revenue reversal"],
  35: ["interest rate", "deferred payment terms", "financing component"],
  42: ["marketing allowance", "coop funds", "payment to customer"],
  45: ["standalone selling price", "list price"],
  50: ["bundled discount", "package price"],
  58: [],
  71: ["percentage of completion", "milestone billing"],
  77: ["daily ratable", "ratable recognition"],
  78: [
    "renewal option",
    "option to renew",
    "discounted renewal",
    "incremental discount",
    "option for future goods",
    "future purchase option",
    "option to purchase additional",
  ],
  82: ["nonrefundable upfront fee", "activation fee", "setup fee", "one time fee"],
  83: ["right of return", "return the product"],
  84: ["warranty", "warranty period"],
  85: ["reseller", "marketplace", "gross or net"],
  91: ["gift card", "prepaid credits", "breakage"],
  92: [
    "hosted",
    "hosted access",
    "hosted software",
    "software as a service",
    "access to the platform",
    "platform access",
  ],
  93: ["license bundled", "license and implementation"],
  94: ["right to access", "right to use", "functional intellectual property"],
  95: ["royalty", "sales based royalty", "usage based royalty"],
  96: [
    "amendment",
    "amended agreement",
    "change order",
    "scope change",
    "price change",
    "modified agreement",
    "addendum",
    "additional goods or services",
  ],
  100: [],
  101: [
    "net 30",
    "net 45",
    "net 60",
    "invoice",
    "invoiced",
    "billed in advance",
    "billed annually in advance",
    "billed in arrears",
    "payment due",
    "unconditional right",
  ],
  105: ["hosted service", "cloud service", "software as a service", "hosted access"],
  106: ["continuous access", "daily service"],
  107: ["usage based", "metered", "per unit fee", "per sample", "overage"],
  108: ["per token", "token pricing", "api calls"],
  109: ["minimum commitment", "overage", "tiered pricing", "volume discount", "committed volume"],
  110: [
    "sla",
    "service level agreement",
    "service credit",
    "service credits",
    "uptime",
    "availability credit",
    "service level penalty",
    "performance credit",
  ],
  111: ["success fee", "outcome based pricing"],
  112: ["data rights", "model training rights"],
  114: ["optional purchase", "may purchase additional"],
  115: ["billed quarterly", "billed monthly in arrears", "unbilled"],
};

function rangeValue<T>(
  id: number,
  ranges: ReadonlyArray<{ from: number; to: number } & Record<string, unknown>>,
  key: string,
): T {
  const hit = ranges.find((range) => id >= range.from && id <= range.to);
  if (!hit) {
    throw new Error(`No guidance policy range covers card ${id}.`);
  }
  return hit[key] as T;
}

function engineSupportFor(id: number): GuidanceEngineSupport {
  if (FULL_SUPPORT_IDS.has(id)) return "full";
  if (PARTIAL_SUPPORT_IDS.has(id)) return "partial";
  if (NOT_SUPPORTED_IDS.has(id)) return "not_supported";
  // Conservative default: ARC presents the guidance but claims no engine
  // authority over the topic.
  return "advisory_only";
}

function finalizationImpactFor(id: number, support: GuidanceEngineSupport): GuidanceFinalizationImpact {
  if (BLOCKING_IDS.has(id)) return "block";
  if (support === "partial" || support === "not_supported") return "warn";
  return "none";
}

/** Resolves the reviewed machine policy for a stable card ID. Fails closed. */
export function getGuidancePolicy(id: number): GuidanceMachinePolicy {
  if (!Number.isInteger(id) || id < 1 || id > POLICY_CARD_ID_COUNT) {
    throw new Error(`No ARC machine policy is defined for guidance card ${id}.`);
  }
  const reviewSection = rangeValue<GuidanceReviewSection>(id, REVIEW_SECTION_RANGES, "section");
  const proposalDomains = rangeValue<readonly string[]>(id, DOMAIN_RANGES, "domains");
  const engineSupport = engineSupportFor(id);
  return {
    core: CORE_GUIDANCE_IDS.includes(id),
    proposalDomains,
    reviewSection,
    engineSupport,
    finalizationImpact: finalizationImpactFor(id, engineSupport),
    enginePolicyCodes:
      engineSupport === "not_supported"
        ? []
        : proposalDomains.map((domain) => `arc.engine.${domain}`),
    relatedGuidanceIds: RELATED_GUIDANCE[id] ?? [],
  };
}

/** Every stable ID referenced anywhere in this policy module. */
export function referencedPolicyIds(): number[] {
  const ids = new Set<number>(CORE_GUIDANCE_IDS);
  for (const set of [FULL_SUPPORT_IDS, PARTIAL_SUPPORT_IDS, NOT_SUPPORTED_IDS, BLOCKING_IDS]) {
    for (const id of set) ids.add(id);
  }
  for (const [key, related] of Object.entries(RELATED_GUIDANCE)) {
    ids.add(Number(key));
    for (const id of related) ids.add(id);
  }
  for (const key of Object.keys(CURATED_RETRIEVAL_SIGNALS)) ids.add(Number(key));
  return [...ids].sort((a, b) => a - b);
}
