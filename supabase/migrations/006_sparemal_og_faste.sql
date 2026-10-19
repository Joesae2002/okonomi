-- Kjør i Supabase → SQL Editor (etter 005). Trygt å kjøre flere ganger.
-- Sparemål, og faste utgifter som er skjult fra oversikten.
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  target numeric(12,2) not null,
  saved numeric(12,2) not null default 0,
  monthly numeric(12,2),                 -- planlagt sparing per måned (tom = bruk snittet av overskuddet)
  deadline date,
  created_at timestamptz default now()
);
create table if not exists hidden_subs (
  household_id uuid not null references households on delete cascade,
  key text not null,
  primary key (household_id, key)
);
alter table goals enable row level security;
alter table hidden_subs enable row level security;
drop policy if exists "maal" on goals;
drop policy if exists "skjulte faste" on hidden_subs;
create policy "maal" on goals for all using (is_member(household_id)) with check (is_member(household_id));
create policy "skjulte faste" on hidden_subs for all using (is_member(household_id)) with check (is_member(household_id));
