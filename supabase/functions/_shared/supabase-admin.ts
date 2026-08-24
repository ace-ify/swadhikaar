import { createClient } from "npm:@supabase/supabase-js@2";

// Checked in order, so a project can move off legacy keys without redeploying every
// function. SUPABASE_SERVICE_ROLE_KEY is the LEGACY JWT — reading only that variable
// meant disabling legacy keys (the correct response to a leaked service_role key)
// would have broken all seven edge functions at once. Values starting with "your-"
// are placeholders from .env.example, not credentials: treating one as configured is
// what silently dropped every voice-call transcript for weeks.
const KEY_VARS = [
  "SUPABASE_SECRET_KEY", // sb_secret_... — current format, preferred
  "SUPABASE_SERVICE_ROLE_KEY", // legacy JWT
  "SUPABASE_SERVICE_KEY",
] as const;

function serviceKey(): { name: string; value: string } | null {
  for (const name of KEY_VARS) {
    const value = (Deno.env.get(name) ?? "").trim();
    if (value && !value.startsWith("your-")) return { name, value };
  }
  return null;
}

export function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = serviceKey();

  if (!url || !key) {
    throw new Error(
      `Missing SUPABASE_URL or a service key (set one of ${KEY_VARS.join(", ")})`,
    );
  }

  return createClient(url, key.value, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
