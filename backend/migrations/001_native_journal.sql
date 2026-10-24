CREATE TABLE IF NOT EXISTS dorprize_native_records (
    key text PRIMARY KEY,
    value jsonb NOT NULL
);

-- This table contains private positions, actions and signed operator jobs.
-- The backend table owner may read/write it; browser roles have no policies.
ALTER TABLE dorprize_native_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dorprize_native_records FROM PUBLIC;

DO $migration$
DECLARE
    browser_role text;
BEGIN
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE dorprize_native_records FROM %I', browser_role);
        END IF;
    END LOOP;
END
$migration$;
