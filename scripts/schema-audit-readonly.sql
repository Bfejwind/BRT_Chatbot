-- READ ONLY: inspect schema metadata, never customer rows.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public'
order by table_name,ordinal_position;
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' order by p.proname;
-- For restoration use a proper schema-only pg_dump, including constraints,
-- indexes, triggers, grants and RLS. Never copy production customer rows to staging.
