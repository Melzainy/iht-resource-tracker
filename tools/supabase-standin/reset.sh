#!/bin/bash
# fresh database: Supabase-like roles + publication, then the real schema + seed + verify
P0="psql -h localhost -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P0 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='rt' and pid<>pg_backend_pid()" >/dev/null
$P0 -c "drop database if exists rt" 2>/dev/null; $P0 -c "create database rt"
P="$P0 -d rt"
$P -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end \$\$; grant usage on schema public to anon, authenticated; create publication supabase_realtime;"
$P -f $(dirname "$0")/../../supabase/rt_schema.sql 2>/dev/null
$P -f $(dirname "$0")/../../supabase/rt_seed.sql
$P -At -F ' ' -f $(dirname "$0")/../../supabase/rt_verify.sql
