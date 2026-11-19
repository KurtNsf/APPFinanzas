-- =============================================================
-- FINANZAS 1.8 - ENDURECIMIENTO RLS Y AISLAMIENTO MULTIUSUARIO
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- No borra datos, filas, tablas ni funciones de sincronizacion.
-- Reemplaza las politicas RLS existentes en las tablas indicadas
-- por politicas estrictas basadas en auth.uid().
-- =============================================================

begin;

grant usage on schema public to authenticated;

-- Permisos SQL: RLS determina sobre que filas puede operar cada usuario.
grant select, insert, update, delete on
  public.accounts,
  public.custom_categories,
  public.transactions,
  public.budgets,
  public.savings_goals,
  public.debts,
  public.recurring_expenses,
  public.subscriptions,
  public.account_balance_snapshots,
  public.archive_batches,
  public.archive_batch_items
 to authenticated;

grant select, update on public.profiles to authenticated;

-- Revocar ejecucion implicita a anon/public. Solo authenticated puede
-- consultar o sincronizar sus propios datos mediante las funciones.
revoke all on function public.get_finanzas_data() from public, anon;
revoke all on function public.sync_finanzas_data(jsonb, timestamptz) from public, anon;
grant execute on function public.get_finanzas_data() to authenticated;
grant execute on function public.sync_finanzas_data(jsonb, timestamptz) to authenticated;

-- Activar RLS y sustituir politicas anteriores por reglas de propietario.
-- No se fuerza RLS sobre el propietario de tabla para no interferir con
-- el trigger existente que crea perfiles desde auth.users.
-- profiles usa id = auth.uid(); las demas tablas usan user_id = auth.uid().
do $$
declare
  v_table text;
  v_owner_column text;
  v_policy record;
  v_tables text[] := array[
    'profiles',
    'accounts',
    'custom_categories',
    'transactions',
    'budgets',
    'savings_goals',
    'debts',
    'recurring_expenses',
    'subscriptions',
    'account_balance_snapshots',
    'archive_batches',
    'archive_batch_items'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'No existe la tabla public.%', v_table;
    end if;

    if v_table = 'profiles' then
      v_owner_column := 'id';
    else
      v_owner_column := 'user_id';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name=v_table
        and column_name=v_owner_column
    ) then
      raise exception 'La tabla public.% no contiene la columna esperada %', v_table, v_owner_column;
    end if;

    execute format('alter table public.%I enable row level security', v_table);

    -- Se eliminan politicas antiguas porque las politicas permisivas se
    -- combinan con OR y podrian dejar una via de acceso demasiado amplia.
    for v_policy in
      select policyname from pg_policies
      where schemaname='public' and tablename=v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;

    execute format(
      'create policy finanzas_owner_select on public.%I for select to authenticated using (%I = (select auth.uid()))',
      v_table, v_owner_column
    );
    execute format(
      'create policy finanzas_owner_insert on public.%I for insert to authenticated with check (%I = (select auth.uid()))',
      v_table, v_owner_column
    );
    execute format(
      'create policy finanzas_owner_update on public.%I for update to authenticated using (%I = (select auth.uid())) with check (%I = (select auth.uid()))',
      v_table, v_owner_column, v_owner_column
    );
    execute format(
      'create policy finanzas_owner_delete on public.%I for delete to authenticated using (%I = (select auth.uid()))',
      v_table, v_owner_column
    );
  end loop;
end $$;

commit;

-- FINANZAS 1.8: fin del endurecimiento RLS.
-- Si una tabla esperada no tiene user_id, la transaccion falla completa
-- y revierte los cambios; no se deja una configuracion parcial.
