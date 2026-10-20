-- Выполните целиком в Supabase: SQL Editor → New query → Run
-- Версия 3: profiles + ELO + снимки рейтинга для онлайн-партий.

create extension if not exists pgcrypto;

-- Игры
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  white_id bigint,
  white_name text,
  black_id bigint,
  black_name text,
  moves text not null default '',
  status text not null default 'waiting' check (status in ('waiting','active','finished')),
  result text check (result in ('w','b','d')),
  white_elo_delta int,
  black_elo_delta int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Добавляем колонки, если таблица была создана раньше
alter table public.games add column if not exists white_elo_delta int;
alter table public.games add column if not exists black_elo_delta int;

create index if not exists games_status_idx on public.games(status);
create index if not exists games_created_idx on public.games(created_at desc);

alter table public.games enable row level security;
drop policy if exists "games read"   on public.games;
drop policy if exists "games create" on public.games;
drop policy if exists "games update" on public.games;

-- Профили
create table if not exists public.profiles (
  id bigint primary key,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  lang text default 'ru',
  display_name text,
  elo int not null default 1200,
  games_played int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_elo_idx on public.profiles(elo desc);

alter table public.profiles enable row level security;
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles write"  on public.profiles;
drop policy if exists "profiles update" on public.profiles;
-- anon-политик нет: только Edge Function (service_role).