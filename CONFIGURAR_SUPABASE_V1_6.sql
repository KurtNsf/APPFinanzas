-- Finanzas v1.6: ampliar el perfil para sincronizar el estado completo de la app.
-- Ejecutar UNA sola vez en Supabase > SQL Editor.

alter table public.profiles
  add column if not exists app_data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- El usuario autenticado solo puede leer y actualizar su propio perfil.
-- Si ya existe la policy profile_owner, no es necesario recrearla.

-- Comprobación: debe devolver app_data y updated_at.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in ('app_data', 'updated_at')
order by column_name;
