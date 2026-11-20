-- チームに「コーチ」欄を追加
alter table public.teams add column if not exists coach text;
