-- チーム・選手に「よみがな」欄を追加
alter table public.teams   add column if not exists kana text;
alter table public.players add column if not exists kana text;
