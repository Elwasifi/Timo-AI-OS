---
name: temo-security-review
description: Temo-specific security checklist covering this project's particular architecture — API key handling through Supabase Edge Functions, single-tenant/no-auth RLS posture, and tenant-isolation groundwork for future multi-tenancy. Complements the general security-review skill (which reviews a diff for generic vulnerability classes) rather than replacing it — use both when the change is security-sensitive. Triggers on "review this for security", "is this safe to expose", "check RLS on this table", "does this leak a key".
---

# Temo Security Review (project-specific)

This is a Temo AI OS-specific supplement to general security review. It covers patterns specific to this project's actual architecture, which a generic reviewer won't know about. For generic vulnerability classes (injection, XSS, SSRF, auth logic bugs), also run the general-purpose `security-review` skill — this one is not a substitute for that.

## Current security posture (state this honestly, every time)

This project is **currently single-tenant with no authentication**. `lib/api/security.ts` is an explicit no-op stub (`defaultAuth` always returns unauthenticated/anonymous; `authorize` always returns `true`; rate limiting is unlimited). Every Supabase table's RLS grants broad `anon, authenticated` access, documented in migration comments as an intentional, temporary posture. This is not a bug to silently work around — it's a known, tracked gap (see docs/TEMO-ARCHITECTURE.md's Runtime Limitations). Don't imply the system is more secure than this in any review output.

## What to check on a security-sensitive change

- **API keys / provider secrets**: these live only in the `app_settings` table, read server-side by Supabase Edge Functions using the service-role key. The Next.js frontend and any client-executed code must never receive a raw provider key. Check any new code path that touches `app_settings` or edge-function responses for a leak.
- **RLS policy correctness**: does the new/changed policy set match the table's actual semantics? Full CRUD open access is the existing single-tenant default — only correct for non-sensitive, genuinely shared data. Append-only/audit tables must not get UPDATE/DELETE policies (see `usage_ledger` as the reference pattern).
- **Approval gates**: does this change let something destructive or costly happen (delete a workflow, permanently delete memory, spend money via a paid API) without any confirmation step? This project has no general approval-gate mechanism yet — flag new unguarded destructive actions rather than assuming a gate exists.
- **Tenant-isolation readiness**: even though multi-tenancy isn't implemented, does this change make future tenant scoping harder (e.g. baking an assumption of single-user global state deep into a function signature) or easier (nullable id columns, queries that could add a tenant filter without restructuring)? Prefer the latter shape when it costs nothing extra now.
- **Injection/SSRF on new endpoints**: any new API route or edge function that incorporates user-supplied input into a query, URL, or shell-adjacent operation gets the standard OWASP-class check.

## Output

State plainly what's fine for the *current* single-tenant posture versus what will become a real problem once auth/multi-tenancy ships — both are legitimate, common verdicts here. Never approve a credential change or production-affecting action without the human owner's explicit sign-off visible in the conversation.
