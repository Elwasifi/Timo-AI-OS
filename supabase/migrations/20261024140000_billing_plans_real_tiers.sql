-- M7-10b — Account & Billing foundation (structure only, no live payments).
--
-- Reuses the existing `packages` table (20260819140000) rather than
-- inventing a parallel `plans` table — it already has exactly the right
-- shape (id, name, project_limit, credit_limit, features jsonb,
-- price_cents nullable = "not yet priced", sort_order), is already
-- referenced by tenant_entitlements.package_id, and is already readable
-- by any authenticated user (packages_select_all). The only real gap was
-- generic placeholder names ("Package 1/2/3") and no marketing/feature
-- copy for a real pricing page — this migration fixes that without
-- touching any `id` value (tenant_entitlements rows reference ids, not
-- names, so this carries zero FK/data-migration risk).
--
-- project_limit/credit_limit values are UNCHANGED from the original
-- seed — not invented here, just given real names. price_cents stays
-- NULL (already nullable, already means "not yet priced") for every
-- paid tier; the Billing & Plan page renders NULL as a clearly-labeled
-- "TBD" placeholder, never a fabricated number. Free is priced at 0
-- (genuinely free, not TBD).
--
-- Tier naming, grounded in what the product actually does today:
--   Free       (free)     — 1 project, 20 credits.  Beta default.
--   Starter    (package1) — 3 projects, 100 credits. Individuals/small teams past the trial.
--   Pro        (package2) — 3 projects, 250 credits. Heavier usage, same project ceiling.
--   Business   (package3) — 10 projects, 1000 credits. Teams running multiple concurrent missions.
--   Custom     (custom)   — unlimited, internal/enterprise (unchanged — this is the internal tenant's own grandfathered tier).
--
-- Idempotent: plain UPDATE statements keyed on the existing primary key.

UPDATE packages SET
  name = 'Free',
  price_cents = 0,
  features = '["1 active project", "20 AI credits / month", "Bring your own AI provider key", "Community support"]'::jsonb
WHERE id = 'free';

UPDATE packages SET
  name = 'Starter',
  price_cents = NULL,
  features = '["3 active projects", "100 AI credits / month", "Bring your own AI provider key", "Email support"]'::jsonb
WHERE id = 'package1';

UPDATE packages SET
  name = 'Pro',
  price_cents = NULL,
  features = '["3 active projects", "250 AI credits / month", "Bring your own AI provider key", "Priority email support"]'::jsonb
WHERE id = 'package2';

UPDATE packages SET
  name = 'Business',
  price_cents = NULL,
  features = '["10 active projects", "1000 AI credits / month", "Bring your own AI provider key", "Priority support"]'::jsonb
WHERE id = 'package3';

UPDATE packages SET
  name = 'Custom',
  features = '["Unlimited projects", "Unlimited credits", "Dedicated support"]'::jsonb
WHERE id = 'custom';
