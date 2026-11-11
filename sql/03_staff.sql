-- DROPZONE 追加分：編集部（記者・ライター）の紹介ページ用
-- Supabase の SQL Editor に全部貼って Run。何回実行しても大丈夫です。

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

-- 公開データとして誰でも読める／書き込みは承認の仕組み経由のみ
alter table public.staff enable row level security;
drop policy if exists public_read on public.staff;
create policy public_read on public.staff for select using (true);
revoke insert, update, delete on public.staff from anon, authenticated;
grant select on public.staff to anon, authenticated;

drop trigger if exists touch_site on public.staff;
create trigger touch_site after insert or update or delete on public.staff for each statement execute function public.touch_site();
drop trigger if exists set_updated_at on public.staff;
create trigger set_updated_at before update on public.staff for each row execute function public.set_updated_at();

-- 承認されたリクエストを反映する関数に「staff」を追加
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
