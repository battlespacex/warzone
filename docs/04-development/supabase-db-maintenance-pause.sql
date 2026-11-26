-- MANUAL prerequisite before EVERY installation/retry. Commit separately so a
-- failed following migration cannot restore previously enabled cleanup controls.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF to_regclass('stratops_maintenance.controls') IS NOT NULL THEN
  EXECUTE 'UPDATE stratops_maintenance.controls SET enabled=false';
 END IF;
END $$;
COMMIT;
-- If pause fails, STOP. Do not start installation; resolve the active lock first.
