-- Kjør i Supabase → SQL Editor (etter 004). Trygt å kjøre flere ganger.
-- Lønn per person og tall til skattekalkulatoren.
alter table accounts add column if not exists person text;          -- hvem kontoen tilhører (for lønn)
alter table transactions add column if not exists person text;      -- overstyrer kontoens eier på lønnsposter
update accounts set person = 'Jørgen' where person is null and name ilike 'Jørgens%';
update accounts set person = 'Ellinor' where person is null and name ilike 'Ellinors%';

create table if not exists tax_inputs (
  household_id uuid not null references households on delete cascade,
  person text not null, year int not null,
  brutto_hittil numeric(12,2), skatt_hittil numeric(12,2), maaneder int, brutto_aar numeric(12,2), trekk_pct numeric(5,2),
  renter numeric(12,2), fagforening numeric(12,2), reise numeric(12,2), annet numeric(12,2), bsu numeric(12,2),
  gift boolean not null default true,
  primary key (household_id, person, year)
);
alter table tax_inputs enable row level security;
drop policy if exists "skatt" on tax_inputs;
create policy "skatt" on tax_inputs for all using (is_member(household_id)) with check (is_member(household_id));
