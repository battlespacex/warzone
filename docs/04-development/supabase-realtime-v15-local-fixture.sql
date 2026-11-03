-- LOCAL STAGING FIXTURE ONLY. Reconstructed from the user-exported production
-- column, constraint, index, and policy catalog CSVs (November 1, 2026).
-- No production rows or credentials. Do not link, push, or auto-apply.
-- Publication membership and local-only gate are in the separate V1.4 setup SQL.
BEGIN;
CREATE TABLE public.events (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 category text NOT NULL DEFAULT 'strike'::text,
 title text NOT NULL,
 summary text,
 source_name text,
 source_url text,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 lat double precision NOT NULL,
 lon double precision NOT NULL,
 location_label text,
 confidence integer NOT NULL DEFAULT 50,
 dedupe_key text UNIQUE,
 origin_lat double precision,
 origin_lon double precision,
 origin_label text,
 impact_lat double precision,
 impact_lon double precision,
 impact_label text,
 actor_side text,
 target_side text,
 weapon_type text,
 target_type text,
 impact_type text,
 report_type text,
 severity text,
 country_code text,
 airspace_status text,
 cyber_status text,
 fir_code text,
 tags jsonb,
 metadata jsonb,
 subcategory text,
 source_key text,
 priority_score integer,
 status text DEFAULT 'signal'::text,
 source_count integer DEFAULT 1,
 primary_source_type text,
 is_breaking boolean DEFAULT false,
 published_at timestamptz DEFAULT now(),
 feed_name text
);
CREATE UNIQUE INDEX events_dedupe_key_idx ON public.events USING btree (dedupe_key);
CREATE UNIQUE INDEX events_source_key_unique ON public.events USING btree (source_key);
CREATE INDEX idx_events_category ON public.events USING btree (category);
CREATE INDEX idx_events_occurred_at ON public.events USING btree (occurred_at DESC);
-- Production stores this policy but events RLS is disabled.
CREATE POLICY "public read events" ON public.events FOR SELECT TO anon USING (true);

CREATE TABLE public.tracks (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 track_key text NOT NULL UNIQUE,
 track_type text NOT NULL,
 category text,
 subcategory text,
 source_name text,
 title text,
 lat double precision NOT NULL,
 lon double precision NOT NULL,
 altitude_ft integer,
 speed_kts integer,
 heading_deg integer,
 region text,
 country text,
 status text NOT NULL DEFAULT 'active'::text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracks_category ON public.tracks USING btree (category);
CREATE INDEX idx_tracks_status ON public.tracks USING btree (status);
CREATE INDEX idx_tracks_track_type ON public.tracks USING btree (track_type);
CREATE INDEX idx_tracks_updated_at ON public.tracks USING btree (updated_at);

CREATE TABLE public.aircraft_tracks_log (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 track_key text,
 callsign text,
 subtype text,
 lat double precision,
 lon double precision,
 altitude_ft integer,
 speed_kts integer,
 heading_deg integer,
 status text DEFAULT 'active'::text,
 first_seen_at timestamptz DEFAULT now(),
 last_seen_at timestamptz DEFAULT now(),
 ended_at timestamptz,
 created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX aircraft_tracks_log_track_key_uidx ON public.aircraft_tracks_log USING btree (track_key);
CREATE INDEX idx_aircraft_tracks_log_last_seen_at ON public.aircraft_tracks_log USING btree (last_seen_at DESC);
CREATE INDEX idx_aircraft_tracks_log_status_last_seen_at ON public.aircraft_tracks_log USING btree (status, last_seen_at DESC);
ALTER TABLE public.aircraft_tracks_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.naval_tracks_log (
 id bigserial PRIMARY KEY,
 mmsi text NOT NULL UNIQUE,
 vessel_name text,
 vessel_class text,
 flag_country text,
 lat double precision,
 lon double precision,
 speed_kts double precision,
 heading_deg double precision,
 ship_type integer,
 status text DEFAULT 'active'::text,
 last_seen_at timestamptz DEFAULT now(),
 created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_naval_last_seen ON public.naval_tracks_log USING btree (last_seen_at DESC);
CREATE INDEX idx_naval_mmsi ON public.naval_tracks_log USING btree (mmsi);
ALTER TABLE public.naval_tracks_log ENABLE ROW LEVEL SECURITY;
-- Local fixture access for PostgREST/service role; deployed grants are unverified.
GRANT SELECT, INSERT, UPDATE, DELETE ON
 public.events, public.tracks, public.aircraft_tracks_log, public.naval_tracks_log
TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.naval_tracks_log_id_seq TO service_role;
COMMIT;
