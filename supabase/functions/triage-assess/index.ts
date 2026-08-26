// REMOVED 2026-08-26. This function is gone; only this tombstone remains.
//
// It was a keyword-based triage endpoint with ZERO callers anywhere in the repo,
// and it was a SECOND, poorer definition of "critical" than the one that actually
// runs during a call. The live severity ladder is _CRITICAL_KEYWORDS_HI in
// backend/voice_agent/agent.py: 45 critical keywords against this function's 10.
// It covered 9 of them, and the one it did not -- "khoon beh raha hai" -- has been
// merged into the live list, so nothing here was unique.
//
// Two definitions of "critical" means whichever one runs misses emergencies the
// other catches. That is why this is a tombstone and not a redirect: a caller
// should fail loudly rather than silently get a triage answer from the weaker list.
//
// This directory is being deleted from the repo. The tombstone exists so the local
// tree matches what is deployed in the window before that happens -- local/deployed
// drift is a recurring bug source here, and it is what made risk-predict run v2 in
// production while git held v1.
//
// The full implementation is in git history. The slug itself still needs deleting in
// Dashboard -> Edge Functions -> triage-assess -> Delete; the Management API is not
// reachable from this environment.

import { corsHeaders } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "gone",
      message:
        "triage-assess was removed on 2026-08-26. Severity classification lives in " +
        "backend/voice_agent/agent.py (_CRITICAL_KEYWORDS_HI), which runs in the " +
        "call path. Do not reintroduce a second severity ladder.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
