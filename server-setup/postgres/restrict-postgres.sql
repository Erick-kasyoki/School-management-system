-- restrict-postgres.sql — give EraMaster its own low-privilege PostgreSQL user.
--
-- Why: the app used to connect as "postgres", the all-powerful superuser. If the website were ever
-- attacked, the attacker would own the whole database server. This creates "eramaster_app", which can
-- ONLY work inside the greenhill_academy database: no superuser, no creating databases or roles,
-- no replication, no access to any other database.
--
-- Run it ONCE, as the postgres user, giving the new password on the command line:
--   "C:\Program Files\PostgreSQL\<version>\bin\psql.exe" -U postgres -h 127.0.0.1 ^
--        -v app_password="PUT-A-LONG-RANDOM-PASSWORD-HERE" -f restrict-postgres.sql
-- Then put the same password in eramaster-private\config.php (DB_PASS).

\set ON_ERROR_STOP on

-- 1. the role (created if missing; password always (re)set)
SELECT format('CREATE ROLE eramaster_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eramaster_app') \gexec
SELECT format('ALTER ROLE eramaster_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_password') \gexec

-- 2. nobody but this role (and superusers) may even connect to the school database
REVOKE ALL ON DATABASE greenhill_academy FROM PUBLIC;
GRANT CONNECT ON DATABASE greenhill_academy TO eramaster_app;

\connect greenhill_academy

-- 3. the public schema is no longer open to everyone
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO eramaster_app;
-- (CREATE is needed because EraMaster creates a few of its own tables on first use —
--  import_datasets, notifications, admission_applications … — and adds one column to staff_accounts.)

-- 4. the app user owns the school's tables and sequences, and nothing else in the server
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables    WHERE schemaname = 'public' LOOP EXECUTE format('ALTER TABLE    public.%I OWNER TO eramaster_app', r.tablename);    END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP EXECUTE format('ALTER SEQUENCE public.%I OWNER TO eramaster_app', r.sequencename); END LOOP;
  FOR r IN SELECT viewname FROM pg_views     WHERE schemaname = 'public' LOOP EXECUTE format('ALTER VIEW     public.%I OWNER TO eramaster_app', r.viewname);     END LOOP;
END $$;

-- 5. harden the role itself
ALTER ROLE eramaster_app SET statement_timeout = '60s';
ALTER ROLE eramaster_app CONNECTION LIMIT 50;

-- Check: this should list eramaster_app with every "super/createdb/createrole/replication" column = f
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = 'eramaster_app';

-- STRICTER OPTION (later): if you pre-create every table yourself, you can stop the app from changing
-- the database structure at all:  keep postgres as the table owner, then
--   REVOKE CREATE ON SCHEMA public FROM eramaster_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eramaster_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eramaster_app;
-- (EraMaster's "CREATE TABLE IF NOT EXISTS" calls would then fail for any table you forgot to create.)
