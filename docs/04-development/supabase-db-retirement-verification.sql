-- READ ONLY, after installation. Every control MUST be false until separately approved.
SELECT name,enabled FROM stratops_maintenance.controls ORDER BY name;
SELECT has_function_privilege('anon','public.stratops_record_preview_retirement(uuid,text)','EXECUTE') must_be_false,
 has_function_privilege('service_role','public.stratops_record_preview_retirement(uuid,text)','EXECUTE') must_be_true;
SELECT count(*) missing_documents FROM (
 SELECT 'operational_reports' kind,id FROM public.operational_reports
 UNION ALL SELECT 'operational_report_snapshots',snapshot_id FROM public.operational_report_snapshots
) r LEFT JOIN stratops_maintenance.report_documents d USING(kind,id) WHERE d.id IS NULL;
SELECT count(*) receipts FROM stratops_maintenance.preview_retirements;
SELECT kind,id,reviewed_at FROM stratops_maintenance.report_releases;
EXPLAIN (COSTS,VERBOSE) SELECT 1 FROM stratops_maintenance.report_pins
WHERE ref='00000000-0000-0000-0000-000000000000';
-- A small table may use a seq scan; never force planner settings to claim improvement.
