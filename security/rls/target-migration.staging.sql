-- StratOps secure RLS target migration
-- STAGING ONLY until frontend JWT integration, approved memberships, and Realtime tests pass.
-- Requires Supabase Auth identities: public.stratops_access.user_id = auth.users.id.
-- Requires deliberate opt-in via SET LOCAL stratops.approved_auth_rollout = 'yes' in same transaction.
-- This migration DOES NOT provision users or change the existing login system.
BEGIN;

DO $$
BEGIN
 IF current_setting('stratops.approved_auth_rollout', true) IS DISTINCT FROM 'yes' THEN
   RAISE EXCEPTION 'Migration blocked: authenticated frontend and rollout must be validated first';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stratops_access (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stratops_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stratops_access FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stratops_access TO authenticated;
GRANT ALL ON public.stratops_access TO service_role;

DROP POLICY IF EXISTS "stratops read own membership" ON public.stratops_access;
CREATE POLICY "stratops read own membership" ON public.stratops_access
 FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.stratops_access WHERE enabled) THEN
   RAISE EXCEPTION 'Migration blocked: no approved authorized members provisioned';
 END IF;
END $$;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_state ENABLE ROW LEVEL SECURITY;

-- Important: review additional policies before running; this migration only
-- drops the two existing public policies identified in the production audit.
DROP POLICY IF EXISTS "public read events" ON public.events;
DROP POLICY IF EXISTS "public read alerts" ON public.active_alerts;

REVOKE ALL ON public.events, public.active_alerts, public.tracks,
 public.raw_items, public.worker_state FROM anon, authenticated;
GRANT SELECT ON public.events, public.active_alerts, public.tracks TO authenticated;
GRANT ALL ON public.events, public.active_alerts, public.tracks,
 public.raw_items, public.worker_state TO service_role;

DROP POLICY IF EXISTS "stratops member read" ON public.events;
DROP POLICY IF EXISTS "stratops member read" ON public.active_alerts;
DROP POLICY IF EXISTS "stratops member read" ON public.tracks;

CREATE POLICY "stratops member read" ON public.events
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.stratops_access AS a
  WHERE a.user_id = (SELECT auth.uid()) AND a.enabled)
);
CREATE POLICY "stratops member read" ON public.active_alerts
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.stratops_access AS a
  WHERE a.user_id = (SELECT auth.uid()) AND a.enabled)
);
CREATE POLICY "stratops member read" ON public.tracks
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.stratops_access AS a
  WHERE a.user_id = (SELECT auth.uid()) AND a.enabled)
);
-- Backend-only raw_items and worker_state intentionally have no user policies.
COMMIT;
