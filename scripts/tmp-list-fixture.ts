const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
if (error) throw error;
const ids = data.users.filter(u => (u.email ?? "").endsWith("@arc-fixture.invalid")).map(u => u.id);
console.log(ids.join(" ") || "(none)");
