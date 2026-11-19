-- =========================================================
-- FINANZAS 1.7 - SINCRONIZACION RELACIONAL
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- No elimina perfiles ni movimientos existentes en app_data.
-- =========================================================

-- Permisos API para usuarios autenticados. RLS sigue filtrando
-- todas las filas por user_id.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.accounts,
  public.custom_categories,
  public.transactions,
  public.budgets,
  public.savings_goals,
  public.debts,
  public.recurring_expenses,
  public.subscriptions
 to authenticated;
grant select, update on public.profiles to authenticated;

-- Guardar el estado completo en las tablas relacionales, dentro
-- de una sola transacción RPC. También conserva app_data como copia.
create or replace function public.sync_finanzas_data(p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para sincronizar Finanzas.';
  end if;
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'El respaldo recibido no tiene un formato válido.';
  end if;

  -- Verificar que el perfil propio exista antes de modificar datos.
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'No existe el perfil de este usuario.';
  end if;

  -- Eliminar primero las filas dependientes. Todo ocurre de forma
  -- atómica: si una operación falla, PostgreSQL revierte el conjunto.
  delete from public.transactions where user_id = v_uid;
  delete from public.subscriptions where user_id = v_uid;
  delete from public.recurring_expenses where user_id = v_uid;
  delete from public.budgets where user_id = v_uid;
  delete from public.savings_goals where user_id = v_uid;
  delete from public.debts where user_id = v_uid;
  delete from public.custom_categories where user_id = v_uid;
  delete from public.accounts a
  where a.user_id = v_uid
    and not exists (
      select 1 from public.account_balance_snapshots s
      where s.user_id = v_uid and s.account_id = a.id
    );

  -- Cuentas primero, porque movimientos y suscripciones las referencian.
  insert into public.accounts (id,user_id,name,type,balance,updated_at)
  select x.id,v_uid,x.name,coalesce(x.type,'Efectivo'),coalesce(x.balance,0),now()
  from jsonb_to_recordset(coalesce(p_data->'accounts','[]'::jsonb))
    as x(id text,name text,type text,balance numeric)
  where x.id is not null and x.name is not null;

  -- Categorías personalizadas: la aplicación las representa como strings.
  insert into public.custom_categories (id,user_id,name,icon)
  select c.value #>> '{}',v_uid,c.value #>> '{}',
         coalesce(p_data->'customCategoryIcons'->>(c.value #>> '{}'),'📌')
  from jsonb_array_elements(coalesce(p_data->'customCategories','[]'::jsonb)) c
  where jsonb_typeof(c.value) = 'string'
  on conflict (user_id,id) do update set name=excluded.name, icon=excluded.icon;

  insert into public.transactions
    (id,user_id,type,amount,description,category,account_id,to_account_id,transaction_date,note)
  select x.id,v_uid,x.type,x.amount,coalesce(x.description,''),x.category,
         x.account,x."toAccount",x.date::date,x.note
  from jsonb_to_recordset(coalesce(p_data->'transactions','[]'::jsonb))
    as x(id text,type text,amount numeric,description text,category text,
         account text,"toAccount" text,date text,note text)
  where x.id is not null and x.type in ('income','expense','transfer')
    and x.amount > 0 and x.account is not null and x.date is not null;

  insert into public.budgets (id,user_id,category,budget_limit)
  select x.id,v_uid,x.category,coalesce(x."limit",0)
  from jsonb_to_recordset(coalesce(p_data->'budgets','[]'::jsonb))
    as x(id text,category text,"limit" numeric)
  where x.id is not null and x.category is not null;

  insert into public.savings_goals (id,user_id,name,target,saved)
  select x.id,v_uid,x.name,x.target,coalesce(x.saved,0)
  from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb))
    as x(id text,name text,target numeric,saved numeric)
  where x.id is not null and x.name is not null and x.target > 0;

  insert into public.debts (id,user_id,name,kind,amount)
  select x.id,v_uid,x.name,x.kind,x.amount
  from jsonb_to_recordset(coalesce(p_data->'debts','[]'::jsonb))
    as x(id text,name text,kind text,amount numeric)
  where x.id is not null and x.name is not null and x.kind in ('owe','owed');

  insert into public.recurring_expenses
    (id,user_id,name,amount,category,frequency,due_day)
  select x.id,v_uid,x.name,x.amount,x.category,x.frequency,x."dueDay"
  from jsonb_to_recordset(coalesce(p_data->'recurring','[]'::jsonb))
    as x(id text,name text,amount numeric,category text,frequency text,"dueDay" integer)
  where x.id is not null and x.name is not null and x.amount > 0;

  insert into public.subscriptions
    (id,user_id,service,custom_name,amount,frequency,billing_day,start_month,next_date,
     account_id,status,initial,color)
  select x.id,v_uid,x.service,x."customName",x.amount,x.frequency,x."billingDay",
         x."startMonth",nullif(x."nextDate",'')::date,x.account,x.status,x.initial,x.color
  from jsonb_to_recordset(coalesce(p_data->'subscriptions','[]'::jsonb))
    as x(id text,service text,"customName" text,amount numeric,frequency text,
         "billingDay" integer,"startMonth" integer,"nextDate" text,account text,
         status text,initial text,color text)
  where x.id is not null and x.service is not null;

  -- Guardar copia completa de compatibilidad y campos de perfil.
  update public.profiles
  set app_data=p_data,
      theme=coalesce(p_data->>'theme','light'),
      category_icons=coalesce(p_data->'customCategoryIcons','{}'::jsonb),
      updated_at=now()
  where id=v_uid;

  select count(*) into v_count from public.transactions where user_id=v_uid;
  return jsonb_build_object('ok',true,'transactions',v_count,'synced_at',now());
end;
$$;

-- Recuperar el estado desde las tablas individuales en el formato
-- que la interfaz Finanzas 1.5/1.6 ya entiende.
create or replace function public.get_finanzas_data()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  result jsonb;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para consultar Finanzas.';
  end if;

  select jsonb_build_object(
    'transactions', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'type',type,'amount',amount,'description',description,'category',category,
      'account',account_id,'toAccount',to_account_id,'date',transaction_date,'note',note
    ) order by transaction_date desc) from public.transactions where user_id=v_uid),'[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'type',type,'balance',balance
    )) from public.accounts where user_id=v_uid),'[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'category',category,'limit',budget_limit
    )) from public.budgets where user_id=v_uid),'[]'::jsonb),
    'goals', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'target',target,'saved',saved
    )) from public.savings_goals where user_id=v_uid),'[]'::jsonb),
    'debts', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'kind',kind,'amount',amount
    )) from public.debts where user_id=v_uid),'[]'::jsonb),
    'recurring', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'amount',amount,'category',category,
      'frequency',frequency,'dueDay',due_day
    )) from public.recurring_expenses where user_id=v_uid),'[]'::jsonb),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'service',service,'customName',custom_name,'amount',amount,
      'frequency',frequency,'billingDay',billing_day,'startMonth',start_month,
      'nextDate',next_date,'account',account_id,'status',status,'initial',initial,'color',color
    )) from public.subscriptions where user_id=v_uid),'[]'::jsonb),
    'customCategories', coalesce((select jsonb_agg(name) from public.custom_categories where user_id=v_uid),'[]'::jsonb),
    'customCategoryIcons', coalesce((select jsonb_object_agg(name,icon) from public.custom_categories where user_id=v_uid),'{}'::jsonb),
    'theme', coalesce((select theme from public.profiles where id=v_uid),'light')
  ) into result;

  return result;
end;
$$;

grant execute on function public.sync_finanzas_data(jsonb) to authenticated;
grant execute on function public.get_finanzas_data() to authenticated;

-- =========================================================
-- FIN DE MIGRACION. No borra profiles.app_data.
-- =========================================================
