-- =====================================================================
-- DROPZONE  データベース初期設定（Supabase の SQL Editor に貼って Run）
-- 何度実行しても壊れないように書いてあります。
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ユーザー（管理者 / 投稿者）
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role         text not null default 'editor' check (role in ('admin','editor','disabled')),
  created_at   timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'));
$$;

-- 新しくログインユーザーができたら、自動で「投稿者」として登録
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- すでにいるユーザーの分も作っておく
insert into public.profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. 公開データ
-- ---------------------------------------------------------------------
create table if not exists public.staff (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name         text not null,                 -- 記事の「記者名」と同じ表記にすると記事とつながる
  position     text not null default 'ライター', -- 肩書（編集長／エディター／ライター など）
  focus        text,                          -- 担当（例：国内大会・移籍情報）
  photo_url    text,
  bio          text,
  links        jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.teams (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name         text not null,
  tag          text,
  region       text not null default '日本',
  status       text not null default 'active' check (status in ('active','inactive','disbanded')),
  founded      text,
  manager      text,
  logo_url     text,
  description  text,
  achievements jsonb not null default '[]'::jsonb,   -- ["NEW GATE GRADE 1 優勝", ...]
  links        jsonb not null default '{}'::jsonb,   -- {"x": "...", "youtube": "..."}
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  ign          text not null,                       -- 表示名（例：TAMR4）
  full_ign     text,                                -- チームタグ付き（例：KN・TAMR4）
  real_name    text,
  nationality  text,
  role         text,
  team_id      uuid references public.teams(id) on delete set null,  -- 現所属（移籍から自動計算）
  photo_url    text,
  bio          text,
  links        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.tournaments (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name         text not null,
  short_name   text,
  series       text,
  tier         text,
  status       text not null default 'upcoming' check (status in ('upcoming','ongoing','completed')),
  region       text not null default '日本',
  scope        text not null default 'japan' check (scope in ('japan','world')),
  format       text,                                 -- オンライン／オフライン
  start_date   date,
  end_date     date,
  team_count   text,
  prize        text,
  organizer    text,
  operator     text,
  logo_url     text,
  description  text,
  streams      jsonb not null default '[]'::jsonb,  -- [{"label":"DAY 1","url":"..."}]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.tournament_stages (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name          text not null,                      -- MAIN STAGE GRADE 1 など
  sort_order    int  not null default 0,
  schedule      text,                               -- 2026.01.31 · 1DAY 6MATCH
  notes         text,                               -- 昇降格ルールなど
  match_count   int,
  maps          jsonb not null default '[]'::jsonb, -- ["ERANGEL","MIRAMAR",...]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.standings (
  id          uuid primary key default gen_random_uuid(),
  stage_id    uuid not null references public.tournament_stages(id) on delete cascade,
  team_id     uuid references public.teams(id) on delete set null,
  team_name   text,                                 -- チーム未登録のとき用
  rank        int,
  wwcd        int not null default 0,
  place_pts   int not null default 0,
  kill_pts    int not null default 0,
  total       int not null default 0,
  note        text,                                 -- 降格 / 昇格 など
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.player_stats (
  id          uuid primary key default gen_random_uuid(),
  stage_id    uuid not null references public.tournament_stages(id) on delete cascade,
  player_id   uuid references public.players(id) on delete cascade,
  team_id     uuid references public.teams(id) on delete set null,
  matches     int not null default 0,
  kills       int not null default 0,
  max_kills   int,
  map_kills   jsonb not null default '{}'::jsonb,   -- {"ERANGEL": {"matches":5,"kills":17}, ...}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.transfers (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete cascade,
  from_team_id  uuid references public.teams(id) on delete set null,
  to_team_id    uuid references public.teams(id) on delete set null,  -- 空なら「フリー／引退」
  kind          text not null default 'join' check (kind in ('join','leave','loan','retire','role')),
  date          date not null,
  note          text,
  source_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.articles (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title          text not null,
  category       text not null default 'news' check (category in ('tournament','result','transfer','world','news')),
  scope          text not null default 'japan' check (scope in ('japan','world')),
  published_at   timestamptz not null default now(),
  author_name    text,
  lead           text,
  body           text,                              -- 本文（Markdown）
  cover_url      text,
  tournament_id  uuid references public.tournaments(id) on delete set null,
  team_ids       jsonb not null default '[]'::jsonb,
  player_ids     jsonb not null default '[]'::jsonb,
  featured       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists players_team_idx     on public.players(team_id);
create index if not exists stages_tour_idx      on public.tournament_stages(tournament_id);
create index if not exists standings_stage_idx  on public.standings(stage_id);
create index if not exists pstats_stage_idx     on public.player_stats(stage_id);
create index if not exists pstats_player_idx    on public.player_stats(player_id);
create index if not exists transfers_player_idx on public.transfers(player_id, date);
create index if not exists articles_pub_idx     on public.articles(published_at desc);

-- 公開サイトの作り直し判定用（どれかのデータが変わると時刻が更新される）
create table if not exists public.site_state (
  id          int primary key default 1 check (id = 1),
  last_change timestamptz not null default now()
);
insert into public.site_state (id) values (1) on conflict do nothing;

create or replace function public.touch_site() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.site_state set last_change = now() where id = 1;
  return null;
end $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['teams','players','tournaments','tournament_stages','standings','player_stats','transfers','articles','staff'] loop
    execute format('drop trigger if exists touch_site on public.%I', t);
    execute format('create trigger touch_site after insert or update or delete on public.%I for each statement execute function public.touch_site()', t);
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 移籍から「現所属」を自動計算（日付が今日以前の最新の移籍の移籍先）
create or replace function public.recompute_player_team(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_found boolean;
begin
  select to_team_id, true into v_team, v_found
  from public.transfers
  where player_id = p_player and date <= current_date and kind <> 'role'
  order by date desc, created_at desc limit 1;
  if v_found then
    update public.players set team_id = v_team where id = p_player and team_id is distinct from v_team;
  end if;
end $$;

create or replace function public.transfers_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.recompute_player_team(old.player_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform public.recompute_player_team(new.player_id); end if;
  return null;
end $$;

drop trigger if exists transfers_sync on public.transfers;
create trigger transfers_sync after insert or update or delete on public.transfers
  for each row execute function public.transfers_sync();

-- 日付が来た「予定の移籍」を反映（公開サイトの作り直しのたびに呼ぶ）
create or replace function public.apply_due_transfers() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; before uuid;
begin
  for r in select distinct player_id from public.transfers where date <= current_date loop
    select team_id into before from public.players where id = r.player_id;
    perform public.recompute_player_team(r.player_id);
    if (select team_id from public.players where id = r.player_id) is distinct from before then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 3. 承認リクエスト
-- ---------------------------------------------------------------------
create table if not exists public.change_requests (
  id           uuid primary key default gen_random_uuid(),
  entity       text not null,            -- テーブル名、まとめて送るときは 'batch'
  action       text not null,
  entity_id    uuid,                     -- update / delete の対象（create は承認時に決まる）
  title        text,                     -- 一覧に出す見出し
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  author_id    uuid references auth.users(id) on delete set null default auth.uid(),
  author_name  text,
  reviewer_id  uuid references auth.users(id) on delete set null,
  reviewer_name text,
  comment      text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists cr_status_idx on public.change_requests(status, created_at desc);
alter table public.change_requests drop constraint if exists change_requests_entity_check;
alter table public.change_requests add constraint change_requests_entity_check
  check (entity in ('articles','teams','players','tournaments','tournament_stages','standings','player_stats','transfers','batch'));
alter table public.change_requests drop constraint if exists change_requests_action_check;
alter table public.change_requests add constraint change_requests_action_check
  check (action in ('create','update','delete','batch'));

-- payload を実際のテーブルに書き込む（承認時と管理者の直接編集で使う）
create or replace function public._apply(p_entity text, p_action text, p_entity_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; cols text; sets text; v_payload jsonb;
begin
  if p_entity not in ('articles','teams','players','tournaments','tournament_stages','standings','player_stats','transfers','staff') then
    raise exception 'unknown entity %', p_entity;
  end if;
  v_payload := coalesce(p_payload, '{}'::jsonb) - 'created_at' - 'updated_at';

  if p_action = 'delete' then
    execute format('delete from public.%I where id = $1', p_entity) using p_entity_id;
    return p_entity_id;
  end if;

  if p_action = 'create' then
    v_id := coalesce(nullif(v_payload->>'id','')::uuid, gen_random_uuid());
    v_payload := jsonb_strip_nulls(v_payload) || jsonb_build_object('id', v_id);  -- 空欄は初期値に任せる
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = p_entity and v_payload ? c.column_name;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                   p_entity, cols, cols, p_entity) using v_payload;
    return v_id;
  end if;

  if p_action = 'update' then
    select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ') into sets
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = p_entity
       and v_payload ? c.column_name and c.column_name <> 'id';
    if sets is null then return p_entity_id; end if;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2',
                   p_entity, sets, p_entity) using v_payload, p_entity_id;
    if not found then raise exception 'target not found (%: %)', p_entity, p_entity_id; end if;
    return p_entity_id;
  end if;

  raise exception 'unknown action %', p_action;
end $$;
revoke all on function public._apply(text,text,uuid,jsonb) from public, anon, authenticated;

-- まとめて送る（順位表など）：payload = {"items":[{"entity":..,"action":..,"entity_id":..,"payload":{..}}, ...]}
create or replace function public._apply_any(p_entity text, p_action text, p_entity_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if p_entity = 'batch' then
    for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
      perform public._apply(it->>'entity', it->>'action', nullif(it->>'entity_id','')::uuid, coalesce(it->'payload','{}'::jsonb));
    end loop;
    return p_entity_id;
  end if;
  return public._apply(p_entity, p_action, p_entity_id, p_payload);
end $$;
revoke all on function public._apply_any(text,text,uuid,jsonb) from public, anon, authenticated;

-- 投稿者：リクエストを出す（管理者が出した場合はそのまま公開）
create or replace function public.submit_change(p_entity text, p_action text, p_entity_id uuid, p_payload jsonb, p_title text)
returns json language plpgsql security definer set search_path = public as $$
declare v_req uuid; v_name text; v_id uuid;
begin
  if not public.is_member() then raise exception 'not allowed'; end if;
  select display_name into v_name from public.profiles where id = auth.uid();
  if public.is_admin() then
    v_id := public._apply_any(p_entity, p_action, p_entity_id, p_payload);
    insert into public.change_requests (entity, action, entity_id, title, payload, status, author_id, author_name,
                                        reviewer_id, reviewer_name, reviewed_at, comment)
    values (p_entity, p_action, v_id, p_title, coalesce(p_payload,'{}'::jsonb), 'approved', auth.uid(), v_name,
            auth.uid(), v_name, now(), '管理者による直接編集')
    returning id into v_req;
    return json_build_object('request_id', v_req, 'status', 'approved', 'entity_id', v_id);
  end if;
  insert into public.change_requests (entity, action, entity_id, title, payload, author_id, author_name)
  values (p_entity, p_action, p_entity_id, p_title, coalesce(p_payload,'{}'::jsonb), auth.uid(), v_name)
  returning id into v_req;
  return json_build_object('request_id', v_req, 'status', 'pending', 'entity_id', p_entity_id);
end $$;

-- 管理者：承認 / 差し戻し
create or replace function public.review_change(p_request uuid, p_approve boolean, p_comment text default null)
returns json language plpgsql security definer set search_path = public as $$
declare r public.change_requests; v_id uuid; v_name text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into r from public.change_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'already %', r.status; end if;
  select display_name into v_name from public.profiles where id = auth.uid();
  if p_approve then
    v_id := public._apply_any(r.entity, r.action, r.entity_id, r.payload);
  end if;
  update public.change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         entity_id = coalesce(v_id, entity_id),
         reviewer_id = auth.uid(), reviewer_name = v_name, reviewed_at = now(), comment = p_comment
   where id = p_request;
  return json_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'entity_id', coalesce(v_id, r.entity_id));
end $$;

-- 投稿者：自分のリクエストを取り下げる
create or replace function public.withdraw_change(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.change_requests set status = 'withdrawn'
   where id = p_request and author_id = auth.uid() and status = 'pending';
end $$;

-- 管理者：メンバーの権限を変える
create or replace function public.set_member(p_user uuid, p_role text, p_display_name text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_role not in ('admin','editor','disabled') then raise exception 'bad role'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception '自分の管理者権限は外せません'; end if;
  update public.profiles set role = p_role, display_name = coalesce(nullif(p_display_name,''), display_name) where id = p_user;
end $$;

-- 自分の表示名を変える
create or replace function public.set_my_name(p_display_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set display_name = p_display_name where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- 4. 権限（RLS）
--   公開データ：誰でも読める／書き込みは上の関数経由のみ
--   リクエスト：投稿者は自分の分、管理者は全部を読める
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['teams','players','tournaments','tournament_stages','standings','player_stats','transfers','articles','staff','site_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists public_read on public.%I', t);
    execute format('create policy public_read on public.%I for select using (true)', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
drop policy if exists members_read on public.profiles;
create policy members_read on public.profiles for select to authenticated using (public.is_member() or id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

alter table public.change_requests enable row level security;
drop policy if exists cr_read on public.change_requests;
create policy cr_read on public.change_requests for select to authenticated
  using (public.is_admin() or author_id = auth.uid());
revoke insert, update, delete on public.change_requests from anon, authenticated;
grant select on public.change_requests to authenticated;

grant execute on function public.submit_change(text,text,uuid,jsonb,text) to authenticated;
grant execute on function public.review_change(uuid,boolean,text) to authenticated;
grant execute on function public.withdraw_change(uuid) to authenticated;
grant execute on function public.set_member(uuid,text,text) to authenticated;
grant execute on function public.set_my_name(text) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_member() to anon, authenticated;
revoke execute on function public.apply_due_transfers() from public, anon, authenticated;
grant execute on function public.apply_due_transfers() to service_role;

-- ---------------------------------------------------------------------
-- 5. 画像置き場（Storage）
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select using (bucket_id = 'media');

drop policy if exists media_upload on storage.objects;
create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_member());

drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());
