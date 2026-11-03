-- LOCAL SUPABASE ONLY. Run only after confirming the database connection is
-- the isolated local stack, never a linked/hosted StratOps project.
-- This marker is deliberately absent from production. The V1.4 migration and
-- rollback refuse to run without it. Do not add this file to auto-migrations.

BEGIN;
DO $setup$
BEGIN
    IF to_regclass('public.events') IS NULL OR to_regclass('public.tracks') IS NULL THEN
        RAISE EXCEPTION 'Import the reviewed public schema into isolated local Supabase first';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        EXECUTE 'CREATE PUBLICATION supabase_realtime';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_publication
               WHERE pubname = 'supabase_realtime' AND puballtables) THEN
        RAISE EXCEPTION 'Local publication covers all tables; review before testing';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime'
                 AND schemaname = 'public'
                 AND tablename IN ('aircraft_tracks_log', 'naval_tracks_log')) THEN
        RAISE EXCEPTION 'Local history publication differs from production';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime'
                     AND schemaname = 'public' AND tablename = 'events') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.events';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime'
                     AND schemaname = 'public' AND tablename = 'tracks') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tracks';
    END IF;
END;
$setup$;
CREATE SCHEMA IF NOT EXISTS stratops_v14;
CREATE TABLE IF NOT EXISTS stratops_v14.local_only_gate (
    token text PRIMARY KEY
);
INSERT INTO stratops_v14.local_only_gate (token)
VALUES ('isolated-local-supabase-v14')
ON CONFLICT (token) DO NOTHING;
COMMIT;
