-- Read-only summary of non-table-wide Data API column grants.
select grantee, privilege_type, table_name, count(*) as granted_column_count,
       array_agg(column_name order by column_name) as columns
from information_schema.role_column_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
group by grantee, privilege_type, table_name
order by grantee, table_name, privilege_type;
