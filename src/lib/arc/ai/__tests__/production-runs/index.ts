/**
 * Production run fixtures for cross-run structural identity testing (Phase 9G-R3 / Phase L).
 *
 * The three fixtures are derived from the immutable structured outputs stored in
 * `ai_runs.result_metadata` for the synthetic Genomix contract. They intentionally preserve the
 * real drift the production model produced (semantic-key renames, taxonomy drift, citation
 * page-set drift, decomposition drift) and must not be "cleaned up" into a tidier example.
 */

import type { CitationSpan } from "@/lib/arc/ai/alignment-types";

export interface FixturePromise {
  semanticKey: string;
  promiseType: string | null;
  description: string | null;
  /** Accounting judgment: carried for drift tests only; never an identity signal. */
  distinctConclusion: string | null;
  citations: CitationSpan[];
}

export interface FixturePerformanceObligation {
  semanticKey: string;
  description: string | null;
  promiseKeys: string[];
  /** Accounting judgment: carried for drift tests only; never an identity signal. */
  satisfactionPattern: string | null;
  citations: CitationSpan[];
}

export interface FixtureVariableConsideration {
  semanticKey: string;
  type: string | null;
  description: string | null;
  unitDescription: string | null;
  billingFrequency: string | null;
  trigger: string | null;
  contractualRateOrAmountInput: string | null;
  targetPerformanceObligationKey: string | null;
  citations: CitationSpan[];
}

export interface FixtureBillingTerm {
  semanticKey: string;
  description: string | null;
  frequency: string | null;
  billingTiming: string | null;
  invoiceTrigger: string | null;
  dueDateRule: string | null;
  paymentTermsDays: number | null;
  amountOrRateInput: string | null;
  citations: CitationSpan[];
}

export interface ExpectedCanonicalStructure {
  promises: number;
  performanceObligations: number;
  variableConsiderationComponents: number;
  considerationEvents: number;
  projectedCollections: number;
}

export interface ProductionRunFixture {
  runId: string;
  label: string;
  promises: FixturePromise[];
  performanceObligations: FixturePerformanceObligation[];
  variableConsiderationComponents: FixtureVariableConsideration[];
  billingTerms: FixtureBillingTerm[];
  /** Present only for Run 1, whose canonical structure the accountant accepted. */
  expectedCanonicalStructure?: ExpectedCanonicalStructure;
}

export { run1Fixture } from "./run1.fixture";
export { runAFixture } from "./run-a.fixture";
export { runBFixture } from "./run-b.fixture";

import { run1Fixture } from "./run1.fixture";
import { runAFixture } from "./run-a.fixture";
import { runBFixture } from "./run-b.fixture";

export const productionRunFixtures: readonly ProductionRunFixture[] = [
  run1Fixture,
  runAFixture,
  runBFixture,
];
