-- FINANZAS 1.7.1 - SINCRONIZACION INCREMENTAL Y CONTROL DE CONFLICTOS
-- Ejecutar UNA vez en Supabase > SQL Editor.
-- No elimina profiles.app_data, archivos historicos ni fotografias de saldos.

begin;

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
grant select on public.account_balance_snapshots to authenticated;

-- Evitar ambiguedad con la funcion anterior de un solo parametro.
drop function if exists public.sync_finanzas_data(jsonb);
drop function if exists public.sync_finanzas_data(jsonb, timestamptz);

create function public.sync_finanzas_data(
  p_data jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_current_version timestamptz;
  v_new_version timestamptz;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesion para sincronizar Finanzas.';
  end if;
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'El respaldo recibido no tiene un formato valido.';
  end if;

  -- Exigir todas las colecciones para impedir borrados accidentales
  -- si una version antigua o un cliente incompleto envia datos parciales.
  if jsonb_typeof(p_data->'accounts') <> 'array'
     or jsonb_typeof(p_data->'transactions') <> 'array'
     or jsonb_typeof(p_data->'budgets') <> 'array'
     or jsonb_typeof(p_data->'goals') <> 'array'
     or jsonb_typeof(p_data->'debts') <> 'array'
     or jsonb_typeof(p_data->'recurring') <> 'array'
     or jsonb_typeof(p_data->'subscriptions') <> 'array'
     or jsonb_typeof(p_data->'customCategories') <> 'array' then
    raise exception 'Faltan colecciones requeridas. No se modifico ningun dato.';
  end if;

  -- Bloqueo por usuario: serializa escrituras y evita que dos dispositivos
  -- sobrescriban silenciosamente una version mas reciente.
  select updated_at into v_current_version
  from public.profiles
  where id = v_uid
  for update;

  if not found then
    raise exception 'No existe el perfil de este usuario.';
  end if;

  if p_expected_updated_at is not null
     and v_current_version is distinct from p_expected_updated_at then
    raise exception 'SYNC_CONFLICT: hay cambios mas recientes en otro dispositivo. Vuelve a cargar tus datos antes de guardar.';
  end if;

  -- UPSERT: solo inserta o actualiza los registros enviados.
  insert into public.accounts (id,user_id,name,type,balance,updated_at)
  select x.id,v_uid,x.name,coalesce(x.type,'Efectivo'),coalesce(x.balance,0),now()
  from jsonb_to_recordset(p_data->'accounts') as x(id text,name text,type text,balance numeric)
  where x.id is not null and x.name is not null
  on conflict (user_id,id) do update set
    name=excluded.name,type=excluded.type,balance=excluded.balance,updated_at=now();

  insert into public.custom_categories (id,user_id,name,icon)
  select c.value #>> '{}',v_uid,c.value #>> '{}',
         coalesce(p_data->'customCategoryIcons'->>(c.value #>> '{}'),'📌')
  from jsonb_array_elements(p_data->'customCategories') c
  where jsonb_typeof(c.value)='string'
  on conflict (user_id,id) do update set name=excluded.name,icon=excluded.icon;

  insert into public.transactions
    (id,user_id,type,amount,description,category,account_id,to_account_id,transaction_date,note)
  select x.id,v_uid,x.type,x.amount,coalesce(x.description,''),x.category,
         x.account,nullif(trim(x."toAccount"),''),x.date::date,x.note
  from jsonb_to_recordset(p_data->'transactions') as x(
    id text,type text,amount numeric,description text,category text,
    account text,"toAccount" text,date text,note text)
  where x.id is not null and x.type in ('income','expense','transfer')
    and x.amount>0 and x.account is not null and x.date is not null
  on conflict (user_id,id) do update set
    type=excluded.type,amount=excluded.amount,description=excluded.description,
    category=excluded.category,account_id=excluded.account_id,
    to_account_id=excluded.to_account_id,transaction_date=excluded.transaction_date,note=excluded.note;

  insert into public.budgets (id,user_id,category,budget_limit)
  select x.id,v_uid,x.category,coalesce(x."limit",0)
  from jsonb_to_recordset(p_data->'budgets') as x(id text,category text,"limit" numeric)
  where x.id is not null and x.category is not null
  on conflict (user_id,id) do update set category=excluded.category,budget_limit=excluded.budget_limit;

  insert into public.savings_goals (id,user_id,name,target,saved)
  select x.id,v_uid,x.name,x.target,coalesce(x.saved,0)
  from jsonb_to_recordset(p_data->'goals') as x(id text,name text,target numeric,saved numeric)
  where x.id is not null and x.name is not null and x.target>0
  on conflict (user_id,id) do update set name=excluded.name,target=excluded.target,saved=excluded.saved;

  insert into public.debts (id,user_id,name,kind,amount)
  select x.id,v_uid,x.name,x.kind,x.amount
  from jsonb_to_recordset(p_data->'debts') as x(id text,name text,kind text,amount numeric)
  where x.id is not null and x.name is not null and x.kind in ('owe','owed')
  on conflict (user_id,id) do update set name=excluded.name,kind=excluded.kind,amount=excluded.amount;

  insert into public.recurring_expenses (id,user_id,name,amount,category,frequency,due_day)
  select x.id,v_uid,x.name,x.amount,x.category,x.frequency,x."dueDay"
  from jsonb_to_recordset(p_data->'recurring') as x(
    id text,name text,amount numeric,category text,frequency text,"dueDay" integer)
  where x.id is not null and x.name is not null and x.amount>0
  on conflict (user_id,id) do update set name=excluded.name,amount=excluded.amount,
    category=excluded.category,frequency=excluded.frequency,due_day=excluded.due_day;

  insert into public.subscriptions
    (id,user_id,service,custom_name,amount,frequency,billing_day,start_month,next_date,
     account_id,status,initial,color)
  select x.id,v_uid,x.service,x."customName",x.amount,x.frequency,x."billingDay",
         x."startMonth",nullif(x."nextDate",'')::date,x.account,x.status,x.initial,x.color
  from jsonb_to_recordset(p_data->'subscriptions') as x(
    id text,service text,"customName" text,amount numeric,frequency text,
    "billingDay" integer,"startMonth" integer,"nextDate" text,account text,
    status text,initial text,color text)
  where x.id is not null and x.service is not null
  on conflict (user_id,id) do update set service=excluded.service,custom_name=excluded.custom_name,
    amount=excluded.amount,frequency=excluded.frequency,billing_day=excluded.billing_day,
    start_month=excluded.start_month,next_date=excluded.next_date,account_id=excluded.account_id,
    status=excluded.status,initial=excluded.initial,color=excluded.color;

  -- Eliminar unicamente IDs que ya no existen en el estado local recibido.
  -- Primero las tablas dependientes y despues cuentas sin snapshots historicos.
  delete from public.transactions t where t.user_id=v_uid
    and not exists (select 1 from jsonb_to_recordset(p_data->'transactions') x(id text) where x.id=t.id);
  delete from public.subscriptions s where s.user_id=v_uid
    and not exists (select 1 from jsonb_to_recordset(p_data->'subscriptions') x(id text) where x.id=s.id);
  delete from public.recurring_expenses r where r.user_id=v_uid
    and not exists (select 1 from jsonb_to_recordset(p_data->'recurring') x(id text) where x.id=r.id);
  delete from public.budgets b where b.user_id=v_uid
    and not exists (select 1 from jsonb_to_recordset(p_data->'budgets') x(id text) where x.id=b.id);
  delete from public.savings_goals g where g.user_id=v_uid
    and not exists (select 1 from jsonb_to_recordset(p_data->'goals') x(id text) where x.id=g.id);
  delete from public.debts d where d.user_id=v_uid
    and not exists (select 1 from jsonb_to_recordset(p_data->'debts') x(id text) where x.id=d.id);
  delete from public.custom_categories c where c.user_id=v_uid
    and not exists (select 1 from jsonb_array_elements_text(p_data->'customCategories') x(value) where x.value=c.name);

  -- Las cuentas vinculadas a snapshots se conservan aunque se quiten de la app.
  delete from public.accounts a where a.user_id=v_uid
    and not exists (select 1 from jsonb_to_recordset(p_data->'accounts') x(id text) where x.id=a.id)
    and not exists (select 1 from public.account_balance_snapshots s where s.user_id=v_uid and s.account_id=a.id);

  -- Actualizar copia de compatibilidad y version del perfil al final.
  update public.profiles
  set app_data=p_data,
      theme=coalesce(p_data->>'theme','light'),
      category_icons=coalesce(p_data->'customCategoryIcons','{}'::jsonb),
      updated_at=clock_timestamp()
  where id=v_uid
  returning updated_at into v_new_version;

  select count(*) into v_count from public.transactions where user_id=v_uid;
  return jsonb_build_object('ok',true,'transactions',v_count,'synced_at',v_new_version,
                            'sync_version',v_new_version);
end;
$$;

create or replace function public.get_finanzas_data()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  result jsonb;
  v_version timestamptz;
begin
  if v_uid is null then raise exception 'Debes iniciar sesion para consultar Finanzas.'; end if;
  select updated_at into v_version from public.profiles where id=v_uid;

  select jsonb_build_object(
    'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'type',type,'amount',amount,'description',description,'category',category,
      'account',account_id,'toAccount',to_account_id,'date',transaction_date,'note',note
    ) order by transaction_date desc) from public.transactions where user_id=v_uid),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'balance',balance)) from public.accounts where user_id=v_uid),'[]'::jsonb),
    'budgets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'category',category,'limit',budget_limit)) from public.budgets where user_id=v_uid),'[]'::jsonb),
    'goals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'target',target,'saved',saved)) from public.savings_goals where user_id=v_uid),'[]'::jsonb),
    'debts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'amount',amount)) from public.debts where user_id=v_uid),'[]'::jsonb),
    'recurring',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'amount',amount,'category',category,'frequency',frequency,'dueDay',due_day)) from public.recurring_expenses where user_id=v_uid),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'service',service,'customName',custom_name,'amount',amount,'frequency',frequency,
      'billingDay',billing_day,'startMonth',start_month,'nextDate',next_date,'account',account_id,
      'status',status,'initial',initial,'color',color
    )) from public.subscriptions where user_id=v_uid),'[]'::jsonb),
    'customCategories',coalesce((select jsonb_agg(name) from public.custom_categories where user_id=v_uid),'[]'::jsonb),
    'customCategoryIcons',coalesce((select jsonb_object_agg(name,icon) from public.custom_categories where user_id=v_uid),'{}'::jsonb),
    'theme',coalesce((select theme from public.profiles where id=v_uid),'light'),
    '_syncVersion',v_version
  ) into result;
  return result;
end;
$$;

grant execute on function public.sync_finanzas_data(jsonb,timestamptz) to authenticated;
grant execute on function public.get_finanzas_data() to authenticated;

commit;
