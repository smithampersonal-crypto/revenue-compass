const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const r = await supabaseAdmin.from("ai_runs").select("*").eq("id","6018af81-9763-4693-930f-4b8fa3b802dd").single();
const d = (r.data ?? {}) as Record<string, unknown>;
for (const [k,v] of Object.entries(d)) {
  const t = v === null ? "null" : Array.isArray(v) ? `array(${v.length})` : typeof v === "object" ? `object(${Object.keys(v as object).length})` : typeof v;
  console.log(k, "=>", t);
}
