const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const r = await supabaseAdmin.from("ai_runs").select("*").eq("id","6018af81-9763-4693-930f-4b8fa3b802dd").single();
const d = (r.data ?? {}) as Record<string, unknown>;
const safe: Record<string, unknown> = {};
for (const [k,v] of Object.entries(d)) safe[k] = typeof v === "string" && v.length > 300 ? `[${v.length} chars]` : v;
console.log(JSON.stringify({error:r.error, row:safe}, null, 2).slice(0, 4000));
