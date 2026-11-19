-- CONSULTA DE SOLO LECTURA: verificar RLS y politicas de Finanzas.
select
  c.relname as tabla,
  c.relrowsecurity as rls_habilitado,
  c.relforcerowsecurity as rls_forzado,
  count(p.policyname) as cantidad_politicas,
  string_agg(p.policyname, ', ' order by p.policyname) as politicas
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
left join pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
where n.nspname='public'
  and c.relname in (
    'profiles','accounts','custom_categories','transactions','budgets',
    'savings_goals','debts','recurring_expenses','subscriptions',
    'account_balance_snapshots','archive_batches','archive_batch_items'
  )
group by c.relname,c.relrowsecurity,c.relforcerowsecurity
order by c.relname;
