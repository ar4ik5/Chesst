-- ============================================================
-- CHESS ARENA: ПОЛНАЯ СХЕМА БД (v4.0)
-- ============================================================

create extension if not exists pgcrypto;

-- 1. ПРОФИЛИ (Расширенная статистика + Монеты)
create table if not exists public.profiles (
  id bigint primary key, -- Telegram ID
  username text,
  first_name text,
  last_name text,
  photo_url text,
  lang text default 'ru',
  display_name text,
  
  -- Игровая валюта
  coins int not null default 100, -- Стартовый капитал
  
  -- Elo и Рейтинг
  elo int not null default 1200,
  peak_elo int not null default 1200,
  
  -- Общая статистика
  games_played int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  
  -- Детальная статистика по режимам (JSON: bullet, blitz, rapid)
  stats_modes jsonb not null default '{"bullet":{"w":0,"l":0,"d":0},"blitz":{"w":0,"l":0,"d":0},"rapid":{"w":0,"l":0,"d":0}}'::jsonb,
  
  -- Стрики и достижения
  current_streak int not null default 0,
  max_streak int not null default 0,
  
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_elo_idx on public.profiles(elo desc);
alter table public.profiles enable row level security;
-- Anon не имеет доступа напрямую, только через Edge Function

-- 2. ИГРЫ
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  white_id bigint,
  white_name text,
  white_elo int,
  black_id bigint,
  black_name text,
  black_elo int,
  moves text not null default '',
  status text not null default 'waiting' check (status in ('waiting','active','finished')),
  result text check (result in ('w','b','d')),
  time_control text, -- '600+0', '180+2', etc.
  white_elo_delta int,
  black_elo_delta int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists games_white_idx on public.games(white_id);
create index if not exists games_black_idx on public.games(black_id);
create index if not exists games_status_idx on public.games(status);
alter table public.games enable row level security;

-- 3. ДРУЗЬЯ
create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null,
  friend_id bigint not null,
  status text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  unique(user_id, friend_id)
);

alter table public.friends enable row level security;

-- 4. ТРАНЗАКЦИИ (Покупка монет)
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null,
  amount int not null, -- сколько монет начислено
  stars int not null, -- сколько звезд заплачено
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  provider_payment_charge_id text,
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

-- 5. ФУНКЦИЯ ОБНОВЛЕНИЯ ПРОФИЛЯ (для Edge Function)
create or replace function update_profile_stats(
  p_id bigint,
  p_elo_delta int,
  p_result text, -- 'w', 'b', 'd'
  p_mode text -- 'bullet', 'blitz', 'rapid'
) returns void as $$
declare
  v_is_win boolean;
  v_is_draw boolean;
  v_elo int;
  v_streak int;
begin
  v_is_win := (p_result = 'w'); -- Предполагаем, что мы передаем результат для ЭТОГО игрока (w/b/d)
  v_is_draw := (p_result = 'd');
  
  -- Получаем текущие данные
  select elo, current_streak into v_elo, v_streak from profiles where id = p_id;
  
  if v_is_win then
    v_streak := v_streak + 1;
  elsif not v_is_draw then
    v_streak := 0;
  end if;

  update profiles set
    elo = greatest(100, elo + p_elo_delta),
    peak_elo = greatest(peak_elo, elo + p_elo_delta),
    games_played = games_played + 1,
    wins = wins + (case when v_is_win then 1 else 0 end),
    losses = losses + (case when (not v_is_win and not v_is_draw) then 1 else 0 end),
    draws = draws + (case when v_is_draw then 1 else 0 end),
    current_streak = v_streak,
    max_streak = greatest(max_streak, v_streak),
    stats_modes = jsonb_set(
      stats_modes,
      array[p_mode, case when v_is_win then 'w' when v_is_draw then 'd' else 'l' end],
      to_jsonb((stats_modes->p_mode->>(case when v_is_win then 'w' when v_is_draw then 'd' else 'l' end))::int + 1)
    ),
    updated_at = now()
  where id = p_id;
end;
$$ language plpgsql security definer;

-- 6. ВКЛЮЧАЕМ REALTIME ДЛЯ ИГР
-- (Чтобы ходы прилетали мгновенно)
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table public.games;