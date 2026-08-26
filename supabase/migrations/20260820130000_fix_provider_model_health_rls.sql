/*
# Fix provider_model_health write RLS (Dynamic Model Router, 2026-08-20)

Live-verified bug found immediately after deploying the router: recordHealth()
in lib/ai/router/healthTracker.ts is called from lib/ai/ai-provider.ts, which
is called from lib/crew/crew-coordinator.ts — a CLIENT-SIDE module. Per this
project's established architecture (lib/supabase/client.ts), the shared
client resolves to the session-scoped anon key in the browser, not the
service-role key — so it's genuinely subject to RLS as the `authenticated`
role, not bypassing it the way a Next.js API route would.

The original migration gave provider_model_health only a SELECT policy for
`authenticated`, assuming writes would always come from a service-role
context. A direct RPC probe confirmed the real failure:
  {"code":"42501", "message":"new row violates row-level security policy
   for table \"provider_model_health\""}

Fix: make record_provider_model_health() SECURITY DEFINER, so it runs with
the function owner's privileges regardless of caller role — a narrower,
safer fix than opening the underlying table to broad authenticated INSERT/
UPDATE, since the function only ever increments counters for a given
provider/model pair (no arbitrary data can be injected through it).
*/

ALTER FUNCTION record_provider_model_health(text, text, boolean, integer, integer) SECURITY DEFINER;
