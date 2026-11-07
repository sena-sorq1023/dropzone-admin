-- DROPZONE 追加分：LiquipediaのURL欄 ＋ PMJL・PMOTの大会枠（中身は空）
-- Supabase の SQL Editor に全部貼って Run。何回実行しても大丈夫です（同じ大会は二重に作られません）。

-- 1) 大会に「LiquipediaのページURL」欄を追加（入っている大会はサイトに出典が表示されます）
alter table public.tournaments add column if not exists liquipedia_url text;

-- 2) 大会の枠を作る（順位表・ステージはあとで編集サイトから取り込み）
insert into public.tournaments (slug, name, short_name, series, status, scope, region, start_date, end_date, organizer, liquipedia_url)
values
  -- PUBG MOBILE JAPAN LEAGUE
  ('pmjl-s1-p1', 'PUBG MOBILE JAPAN LEAGUE SEASON1 Phase1', 'PMJL S1 Phase1', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', '2021-02-13', '2021-05-01', 'NTTドコモ', null),
  ('pmjl-s1-p2', 'PUBG MOBILE JAPAN LEAGUE SEASON1 Phase2', 'PMJL S1 Phase2', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', '2021-09-25', '2021-10-30', 'NTTドコモ', null),
  ('pmjl-s2-p1', 'PUBG MOBILE JAPAN LEAGUE SEASON2 Phase1', 'PMJL S2 Phase1', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', '2022-03-26', '2022-05-07', 'NTTドコモ', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_2/Phase_1'),
  ('pmjl-s2-p2', 'PUBG MOBILE JAPAN LEAGUE SEASON2 Phase2', 'PMJL S2 Phase2', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', '2022-09-23', '2022-10-23', 'NTTドコモ', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_2/Phase_2'),
  ('pmjl-s3-p1', 'PUBG MOBILE JAPAN LEAGUE SEASON3 Phase1', 'PMJL S3 Phase1', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', '2023-05-27', '2023-06-25', 'NTTドコモ', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_3/Phase_1'),
  ('pmjl-s3-p2', 'PUBG MOBILE JAPAN LEAGUE SEASON3 Phase2', 'PMJL S3 Phase2', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', '2023-09-02', '2023-10-15', 'NTTドコモ', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_3/Phase_2'),
  ('pmjl-s4-p1', 'PUBG MOBILE JAPAN LEAGUE SEASON4 Phase1', 'PMJL S4 Phase1', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_4/Phase_1'),
  ('pmjl-s4-p2', 'PUBG MOBILE JAPAN LEAGUE SEASON4 Phase2', 'PMJL S4 Phase2', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_4/Phase_2'),
  ('pmjl-s5-p1', 'PUBG MOBILE JAPAN LEAGUE SEASON5 Phase1', 'PMJL S5 Phase1', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_5/Phase_1'),
  ('pmjl-s5-p2', 'PUBG MOBILE JAPAN LEAGUE SEASON5 Phase2', 'PMJL S5 Phase2', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_5/Phase_2'),
  ('pmjl-s6-p1', 'PUBG MOBILE JAPAN LEAGUE SEASON6 Phase1', 'PMJL S6 Phase1', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_6/Phase_1'),
  ('pmjl-s6-p2', 'PUBG MOBILE JAPAN LEAGUE SEASON6 Phase2', 'PMJL S6 Phase2', 'PUBG MOBILE JAPAN LEAGUE', 'completed', 'japan', '日本', '2026-09-04', null, 'KRAFTON JAPAN', 'https://liquipedia.net/pubgmobile/PUBG_Mobile_Japan_League/Season_6/Phase_2'),
  -- PUBG MOBILE OPEN TOURNAMENT
  ('pmot-2021',    'PUBG MOBILE OPEN TOURNAMENT 2021',        'PMOT 2021',        'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', null, null, 'NTTドコモ', null),
  ('pmot-2022-p1', 'PUBG MOBILE OPEN TOURNAMENT 2022 Phase1', 'PMOT 2022 Phase1', 'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', '2022-05-21', '2022-06-12', 'NTTドコモ', null),
  ('pmot-2024-p1', 'PUBG MOBILE OPEN TOURNAMENT 2024 Phase1', 'PMOT 2024 Phase1', 'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', null),
  ('pmot-2024-p2', 'PUBG MOBILE OPEN TOURNAMENT 2024 Phase2', 'PMOT 2024 Phase2', 'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', null),
  ('pmot-2025-p1', 'PUBG MOBILE OPEN TOURNAMENT 2025 Phase1', 'PMOT 2025 Phase1', 'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', null),
  ('pmot-2025-p2', 'PUBG MOBILE OPEN TOURNAMENT 2025 Phase2', 'PMOT 2025 Phase2', 'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', null),
  ('pmot-2026-p1', 'PUBG MOBILE OPEN TOURNAMENT 2026 Phase1', 'PMOT 2026 Phase1', 'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', null),
  ('pmot-2026-p2', 'PUBG MOBILE OPEN TOURNAMENT 2026 Phase2', 'PMOT 2026 Phase2', 'PUBG MOBILE OPEN TOURNAMENT', 'completed', 'japan', '日本', null, null, 'KRAFTON JAPAN', null)
on conflict (slug) do nothing;

-- 3) 作った枠の確認
select short_name, start_date, end_date, organizer, liquipedia_url is not null as has_lp
from public.tournaments where series in ('PUBG MOBILE JAPAN LEAGUE', 'PUBG MOBILE OPEN TOURNAMENT')
order by series, slug;
