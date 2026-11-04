-- Data-preserving rollback proposal. Do not execute on production without approval.
-- Stop the optional private-history writer and roll back the API/frontend release
-- first. Keep the private history tables and the live-table RLS protections.
-- Dropping tables would destroy retained historical positions. Disabling RLS on
-- events/tracks would re-expose archived naval positions to anonymous clients.
-- No SQL is required for the safe application rollback.
SELECT 'No database rollback performed; private history and RLS remain protected' AS result;
