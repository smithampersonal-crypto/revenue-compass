/**
 * Post-R2 database hardening — application boundary for the conflict SQLSTATE.
 *
 * ARC's own optimistic-lock conflicts are permanent for the request that hit
 * them, so they now arrive as PT409. A genuine PostgreSQL serialization
 * failure (40001) is a different thing entirely and must never be presented as
 * a stale-version conflict — that misreading is exactly what let a retrying
 * PostgREST client turn ordinary conflicts into a request storm.
 */
import { describe, expect, it } from "vitest";

import {
  AUTOSAVE_CONFLICT_CODE,
  AUTOSAVE_CONTENTION_CODE,
  classifyAutosaveSaveError,
} from "../autosave.store.server";

describe("post-R2 — conflict SQLSTATE mapping", () => {
  it("uses the explicit non-retryable conflict code, not a serialization code", () => {
    expect(AUTOSAVE_CONFLICT_CODE).toBe("PT409");
    expect(AUTOSAVE_CONTENTION_CODE).toBe("55P03");
    expect(AUTOSAVE_CONFLICT_CODE).not.toBe("40001");
  });

  it("maps PT409 to the stale-version conflict the reload UI already shows", () => {
    expect(classifyAutosaveSaveError({ code: "PT409" })).toBe("conflict");
  });

  it("maps 55P03 to bounded contention, never to a stale-version conflict", () => {
    expect(classifyAutosaveSaveError({ code: "55P03" })).toBe("contention");
  });

  it("treats a genuine database serialization failure as an ordinary failure", () => {
    expect(classifyAutosaveSaveError({ code: "40001" })).toBe("failure");
  });

  it("treats any other database error as an ordinary failure", () => {
    expect(classifyAutosaveSaveError({ code: "42501" })).toBe("failure");
    expect(classifyAutosaveSaveError({ code: "PGRST003" })).toBe("failure");
    expect(classifyAutosaveSaveError(null)).toBe("none");
  });
});
