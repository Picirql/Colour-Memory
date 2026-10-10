-- ============================================================
-- Colour Memory Game: Supabase schema (run once in SQL Editor)
-- ============================================================

-- 1. One row per game started ("session" = one game).
create table public.sessions (
  session_id          uuid primary key,                    -- crypto.randomUUID(), made in browser
  device_id           uuid not null,                       -- persistent per browser (localStorage)
  email_hash          text check (email_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 hex or null
  nickname            text check (nickname ~ '^[A-Za-z0-9_]{2,16}$'), -- or null
  age_band            text check (age_band in ('18_21','22_25','26_35','36_plus','na')),
  colour_vision       text check (colour_vision in ('normal','deficient','unsure','na')),
  game_number_device  int  not null check (game_number_device >= 1),
  is_first_game       boolean not null,                    -- true => practice trials were shown
  is_test             boolean not null default false,      -- debug/sim/localhost games
  app_version         text not null check (length(app_version) <= 32),
  user_agent          text check (length(user_agent) <= 512),
  input_type          text check (input_type in ('mouse','touch','pen','unknown')),
  viewport_w          int, viewport_h int, screen_w int, screen_h int,
  device_pixel_ratio  real,
  refresh_hz_est      real,
  frame_ms_est        real,
  storage_ok          boolean,
  client_started_at   timestamptz not null,
  tz_offset_min       int,
  created_at          timestamptz not null default now()
);

-- 2. One row per trial (practice trials included, flagged).
create table public.trials (
  id                  bigint generated always as identity primary key,
  session_id          uuid not null references public.sessions(session_id),
  trial_index         int  not null check (trial_index between 0 and 63),
  is_practice         boolean not null,
  set_size            int  not null check (set_size in (1,2,3,4,6,8)),
  item_colors_deg     int[] not null,      -- colour (hue index 0..359) of every item shown
  item_slots          int[] not null,      -- slot index 0..7 of every item (same order)
  item_positions_deg  real[] not null,     -- screen angle of every item (same order)
  array_rotation_deg  real not null,       -- random rotation of the 8-slot ring
  probe_index         int  not null,       -- 0-based index into the arrays above
  target_color_deg    int  not null check (target_color_deg between 0 and 359),
  response_color_deg  int  not null check (response_color_deg between 0 and 359),
  error_deg           int  not null check (error_deg between -179 and 180),
  rt_ms               real not null check (rt_ms >= 0),
  wheel_rotation_deg  int  not null check (wheel_rotation_deg between 0 and 359),
  fixation_frames     int, array_frames int, delay_frames int,
  fixation_ms_measured real, array_ms_measured real, delay_ms_measured real,
  timing_ok           boolean not null,
  hidden_during_trial boolean not null,
  input_type          text check (input_type in ('mouse','touch','pen','unknown')),
  points              int  not null check (points between 0 and 800),
  client_ts           timestamptz not null,
  created_at          timestamptz not null default now(),
  unique (session_id, trial_index),
  check (cardinality(item_colors_deg)    = set_size),
  check (cardinality(item_slots)         = set_size),
  check (cardinality(item_positions_deg) = set_size),
  check (probe_index >= 0 and probe_index < set_size),
  check (item_colors_deg[probe_index + 1] = target_color_deg)
);
create index trials_session_idx on public.trials(session_id);

-- 3. One row per finished game.
create table public.game_results (
  session_id          uuid primary key references public.sessions(session_id),
  score               int  not null check (score between 0 and 9600),
  n_trials_completed  int  not null check (n_trials_completed between 0 and 24),
  client_ended_at     timestamptz not null,
  created_at          timestamptz not null default now()
);

-- 4. Security: the public key may INSERT only. Nobody public can read/update/delete.
alter table public.sessions     enable row level security;
alter table public.trials       enable row level security;
alter table public.game_results enable row level security;

revoke all on public.sessions, public.trials, public.game_results from anon, authenticated;
grant insert on public.sessions, public.trials, public.game_results to anon;

create policy anon_insert_sessions on public.sessions     for insert to anon with check (true);
create policy anon_insert_trials   on public.trials       for insert to anon with check (true);
create policy anon_insert_results  on public.game_results for insert to anon with check (true);

-- 5. Leaderboard: the ONLY public read path. Returns nickname + best score only.
create or replace function public.get_leaderboard(limit_n int default 10)
returns table (nickname text, best_score int)
language sql
security definer
set search_path = public
stable
as $$
  with complete as (
    select g.session_id, g.score, s.nickname, s.created_at,
           coalesce(s.email_hash, s.device_id::text) as player_key
    from game_results g
    join sessions s using (session_id)
    where s.nickname is not null
      and s.is_test = false
      and g.n_trials_completed = 24
      and (select count(*) from trials t
           where t.session_id = g.session_id and not t.is_practice) = 24
  ),
  best as (
    select distinct on (player_key) player_key, nickname, score
    from complete
    order by player_key, score desc, created_at asc
  )
  select nickname, score from best
  order by score desc
  limit least(greatest(limit_n, 1), 50);
$$;

revoke all on function public.get_leaderboard(int) from public;
grant execute on function public.get_leaderboard(int) to anon;
