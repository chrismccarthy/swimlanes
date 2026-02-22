-- Belt-and-suspenders domain check for sign-in.
-- Primary domain restriction is via Google's `hd` parameter.
-- This hook guards against edge cases (e.g. email change post-registration).
--
-- Register this function in Supabase Dashboard:
--   Auth > Hooks > Before Sign In > select public.check_email_domain

CREATE OR REPLACE FUNCTION public.check_email_domain(event jsonb)
RETURNS jsonb AS $$
DECLARE
  user_email text;
BEGIN
  user_email := event->'claims'->>'email';

  IF user_email IS NULL OR NOT user_email LIKE '%@evenlydistributed.xyz' THEN
    RETURN jsonb_build_object(
      'decision', 'reject',
      'message', 'Access restricted to evenlydistributed.xyz accounts'
    );
  END IF;

  RETURN event;
END;
$$ LANGUAGE plpgsql STABLE;
