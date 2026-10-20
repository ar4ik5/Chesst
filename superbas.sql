-- Выполните целиком в Supabase: SQL Editor → New query → Run
-- Версия 2: закрытый RLS. Клиент ходит только через Edge Function (service_role).

create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  white_id bigint,
  white_name text,
  black_id bigint,
  black_name text,
  moves text not null default '',
  status text not null default 'waiting' check (status in ('waiting','active','finished')),
  result text check (result in ('w','b','d')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists games_status_idx on public.games(status);
create index if not exists games_created_idx on public.games(created_at desc);

alter table public.games enable row level security;

-- Удаляем старые открытые политики, если они ещё висят
drop policy if exists "games read"   on public.games;
drop policy if exists "games create" on public.games;
drop policy if exists "games update" on public.games;

-- Никаких anon-политик: anon не может ни читать, ни писать.
-- service_role (Edge Function) игнорирует RLS.