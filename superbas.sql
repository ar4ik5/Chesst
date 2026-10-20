create extension if not exists pgcrypto;

-- 1. ПРОФИЛИ
create table if not exists public.profiles (
  id bigint primary key,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  lang text default 'ru',
  display_name text,
  coins int not null default 100,
  elo int not null default 1200,
  peak_elo int not null default 1200,
  games_played int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  stats_modes jsonb not null default '{"bullet":{"w":0,"l":0,"d":0},"blitz":{"w":0,"l":0,"d":0},"rapid":{"w":0,"l":0,"d":0}}'::jsonb,
  current_streak int not null default 0,
  max_streak int not null default 0,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_elo_idx on public.profiles(elo desc);
alter table public.profiles enable row level security;

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
  time_control text,
  white_time_ms bigint,
  black_time_ms bigint,
  last_move_at timestamptz,
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

-- 4. ТРАНЗАКЦИИ
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null,
  amount int not null,
  stars int not null,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  provider_payment_charge_id text,
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;

-- 5. RATE LIMIT
create table if not exists public.rate_limits (
  user_id bigint not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limits_user_action_idx on public.rate_limits(user_id, action, created_at desc);
alter table public.rate_limits enable row level security;

-- 6. УВЕДОМЛЕНИЯ
create table if not exists public.notification_settings (
  user_id bigint primary key references public.profiles(id) on delete cascade,
  notify_move boolean not null default true,
  notify_invite boolean not null default true,
  notify_finish boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null,
  game_id uuid,
  type text not null,
  sent_at timestamptz not null default now()
);
create index if not exists notification_log_user_idx on public.notification_log(user_id, type, sent_at desc);
alter table public.notification_log enable row level security;

-- 7. МАТЧМЕЙКИНГ
create table if not exists public.matchmaking_queue (
  user_id bigint primary key,
  display_name text,
  elo int not null,
  time_control text not null,
  mode text not null default 'blitz',
  created_at timestamptz not null default now()
);
create index if not exists mm_queue_tc_idx on public.matchmaking_queue(time_control, created_at);
alter table public.matchmaking_queue enable row level security;

-- Включаем Realtime
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table public.games;

-- ФУНКЦИИ
create or replace function update_profile_stats(
  p_id bigint, p_elo_delta int, p_result text, p_mode text
) returns void as $$
declare
  v_is_win boolean;
  v_is_draw boolean;
  v_streak int;
begin
  v_is_win := (p_result = 'w');
  v_is_draw := (p_result = 'd');
  select current_streak into v_streak from profiles where id = p_id;
  if v_is_win then v_streak := v_streak + 1;
  elsif not v_is_draw then v_streak := 0;
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

create or replace function check_rate_limit(
  p_user_id bigint, p_action text, p_window_seconds int, p_max int
) returns boolean as $$
declare
  v_count int;
begin
  select count(*) into v_count from rate_limits
  where user_id = p_user_id and action = p_action
    and created_at > now() - (p_window_seconds || ' seconds')::interval;
  if v_count >= p_max then return false; end if;
  insert into rate_limits(user_id, action) values (p_user_id, p_action);
  return true;
end;
$$ language plpgsql security definer;

create or replace function should_notify(p_user_id bigint, p_type text)
returns boolean as $$
declare
  v_row record;
begin
  select * into v_row from notification_settings where user_id = p_user_id;
  if not found then return true; end if;
  return case p_type
    when 'move' then v_row.notify_move
    when 'invite' then v_row.notify_invite
    when 'finish' then v_row.notify_finish
    else true
  end;
end;
$$ language plpgsql security definer;

create or replace function find_match(p_tc text, p_elo_range int default 100)
returns table(player1_id bigint, player1_name text, player1_elo int,
              player2_id bigint, player2_name text, player2_elo int) as $$
begin
  return query
  with candidates as (
    select a.user_id as a_id, a.display_name as a_name, a.elo as a_elo,
           b.user_id as b_id, b.display_name as b_name, b.elo as b_elo,
           abs(a.elo - b.elo) as diff,
           row_number() over (partition by a.user_id order by abs(a.elo - b.elo)) as rn
    from matchmaking_queue a
    join matchmaking_queue b
      on a.user_id < b.user_id
     and a.time_control = b.time_control
     and a.time_control = p_tc
     and abs(a.elo - b.elo) <= p_elo_range
  )
  select c.a_id, c.a_name, c.a_elo, c.b_id, c.b_name, c.b_elo
  from candidates c
  where c.rn = 1
  order by c.diff asc
  limit 1;
end;
$$ language plpgsql security definer;