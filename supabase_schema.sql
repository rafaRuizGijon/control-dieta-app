-- Ejecuta este script en el SQL Editor de tu proyecto gratuito en Supabase

create table if not exists public.recetas (
  id text primary key,
  nombre text not null,
  origen text default 'Personalizada',
  ingredientes text not null,
  preparacion text not null,
  porcion_g numeric default 0,
  kcal numeric default 0,
  proteina numeric default 0,
  hidratos numeric default 0,
  azucares numeric default 0,
  grasas numeric default 0,
  grasas_sat numeric default 0,
  fibra numeric default 0,
  sodio numeric default 0,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create table if not exists public.dietas_semanales (
  id text primary key,
  nombre text not null,
  plan jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Habilitar acceso público (puedes restringirlo con Auth si lo deseas)
alter table public.recetas enable row level security;
alter table public.dietas_semanales enable row level security;

create policy "Acceso total recetas" on public.recetas for all using (true) with check (true);
create policy "Acceso total dietas" on public.dietas_semanales for all using (true) with check (true);
