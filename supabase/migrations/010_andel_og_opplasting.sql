-- Kjør i Supabase → SQL Editor (etter 009). Trygt å kjøre flere ganger.
-- 1) Din andel av en post (1 = hele beløpet, 0.5 = halvparten, 0.25 = en fjerdedel)
alter table transactions add column if not exists share numeric(7,5) not null default 1 check (share > 0 and share <= 1);

-- 2) Månedlig påminnelse om å laste opp bankloggene
alter table accounts add column if not exists remind boolean not null default true;   -- med i påminnelsen?
create table if not exists upload_marks (                                             -- konto merket som ferdig for en måned (for hånd)
  household_id uuid not null references households on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  primary key (household_id, account_id, month)
);
alter table upload_marks enable row level security;
drop policy if exists "opplasting" on upload_marks;
create policy "opplasting" on upload_marks for all using (is_member(household_id)) with check (is_member(household_id));
