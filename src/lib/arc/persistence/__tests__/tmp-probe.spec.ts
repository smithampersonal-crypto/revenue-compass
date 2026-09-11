import { describe, it } from "vitest";
import { createDemoDraft } from "@/lib/demo-scenarios";
import { buildFinalizationSnapshot, readEngineOutputsSnapshot, ARC_ENGINE_VERSION } from "@/lib/arc/persistence/snapshot";
import { ARC_WORKFLOW_SCHEMA_VERSION } from "@/lib/arc/persistence/schema";
describe("x", () => {
  for (const id of ["horizon","stellar","meridian","redwood","apex"] as const) {
    it(id, () => {
      const o = buildFinalizationSnapshot(createDemoDraft(id));
      const meta = { engineVersion: ARC_ENGINE_VERSION, schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION };
      console.log(id, o.ok, o.ok ? o.engineOutputs.journals.kind : (o as any).blockedReason, o.ok ? readEngineOutputsSnapshot(JSON.parse(JSON.stringify(o.engineOutputs)), meta) !== null : "-");
    });
  }
});
