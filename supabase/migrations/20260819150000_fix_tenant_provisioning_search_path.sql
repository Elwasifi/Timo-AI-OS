/*
# Fix: tenant auto-provisioning trigger failed on signup

## Root cause
`provision_tenant_for_new_user()` (from 20260819140000_create_v1_corporate_os_foundation.sql)
fires as an AFTER INSERT trigger on `auth.users`, executed by Supabase's
auth service role. Without an explicit `search_path`, unqualified table
references inside a SECURITY DEFINER function invoked from that context
are not guaranteed to resolve against `public` — causing every signup to
fail with GoTrue's generic "Database error saving new user" (confirmed via
live Playwright verification against the actual project). This is a
well-known Supabase gotcha for auth.users triggers, not a data problem —
no rows exist yet to be affected, so this fix is purely a function
redefinition.

## Fix
Re-create the function with `SET search_path = public` and fully-qualified
table references, so it resolves correctly regardless of the invoking
context. Purely additive — CREATE OR REPLACE on an existing function, no
table/data changes.
*/

CREATE OR REPLACE FUNCTION provision_tenant_for_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_tenant_id uuid;
  member_count integer;
BEGIN
  -- Reliability: auto-provisioning is a side effect of signup, not the
  -- point of it. If anything in here fails unexpectedly, signup must
  -- still succeed — a user with no tenant yet can be repaired
  -- (stores/authStore.ts calls an idempotent repair path; see
  -- ensure_tenant_for_current_user() below) rather than being unable to
  -- create an account at all.
  BEGIN
    SELECT count(*) INTO member_count FROM public.tenant_members
    WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

    IF member_count = 0 THEN
      -- First user ever: becomes the internal Temo Corporate owner.
      INSERT INTO public.tenant_members (tenant_id, user_id, role)
      VALUES ('00000000-0000-0000-0000-000000000001', NEW.id, 'owner');
    ELSE
      -- Client signup: gets their own isolated tenant.
      INSERT INTO public.tenants (name, slug, kind)
      VALUES (
        COALESCE(NEW.raw_user_meta_data->>'company_name', split_part(NEW.email, '@', 1)),
        'client-' || substr(NEW.id::text, 1, 8),
        'client'
      )
      RETURNING id INTO new_tenant_id;

      INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (new_tenant_id, NEW.id, 'owner');
      INSERT INTO public.client_profiles (tenant_id, assistant_name, preferred_language)
      VALUES (new_tenant_id, 'Temo', COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'en'));
      INSERT INTO public.tenant_entitlements (tenant_id, package_id, credits_remaining)
      VALUES (new_tenant_id, 'free', 20);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'provision_tenant_for_new_user failed for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Idempotent repair path: if a user somehow has zero tenant memberships
-- (the trigger above failed, or a pre-migration user), calling this gives
-- them one. Safe to call on every login — it's a no-op once the user has
-- at least one membership.
CREATE OR REPLACE FUNCTION ensure_tenant_for_current_user()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  member_count integer;
  new_tenant_id uuid;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO member_count FROM public.tenant_members WHERE user_id = uid;
  IF member_count > 0 THEN RETURN; END IF;

  SELECT count(*) INTO member_count FROM public.tenant_members
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

  IF member_count = 0 THEN
    INSERT INTO public.tenant_members (tenant_id, user_id, role)
    VALUES ('00000000-0000-0000-0000-000000000001', uid, 'owner');
  ELSE
    INSERT INTO public.tenants (name, slug, kind)
    VALUES ('New Workspace', 'client-' || substr(uid::text, 1, 8), 'client')
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (new_tenant_id, uid, 'owner');
    INSERT INTO public.client_profiles (tenant_id, assistant_name, preferred_language)
    VALUES (new_tenant_id, 'Temo', 'en');
    INSERT INTO public.tenant_entitlements (tenant_id, package_id, credits_remaining)
    VALUES (new_tenant_id, 'free', 20);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_tenant_for_current_user() TO authenticated;
