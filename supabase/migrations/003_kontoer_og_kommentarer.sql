-- Kjør i Supabase → SQL Editor (etter 002). Trygt å kjøre flere ganger.
-- Legger til kontoer og kommentarer på poster.

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  bank text not null default 'nidaros' check (bank in ('nidaros', 'sbanken')),
  number text,                                   -- kontonummer, læres automatisk fra Nidaros-filer
  unique (household_id, name)
);
alter table accounts enable row level security;
drop policy if exists "kontoer" on accounts;
create policy "kontoer" on accounts for all using (is_member(household_id)) with check (is_member(household_id));

alter table transactions add column if not exists account_id uuid references accounts on delete set null;
alter table transactions add column if not exists comment text;
alter table transactions add column if not exists from_acc text;   -- avsenderkonto fra banken
alter table transactions add column if not exists to_acc text;     -- mottakerkonto fra banken

-- De fire kontoene (legges til i alle husholdninger som finnes)
insert into accounts (household_id, name, bank)
select h.id, a.name, a.bank from households h
cross join (values ('Jørgens Brukskonto', 'nidaros'), ('Ellinors Konto', 'nidaros'),
                   ('Felles Regningskonto', 'nidaros'), ('Jørgens Sbanken', 'sbanken')) as a(name, bank)
on conflict (household_id, name) do nothing;

-- Alt som er importert til nå kom fra Jørgens Brukskonto
update transactions t set account_id = a.id
from accounts a
where t.account_id is null and a.household_id = t.household_id and a.name = 'Jørgens Brukskonto';

-- Samme post kan finnes på to kontoer, så unikheten gjelder per konto
alter table transactions drop constraint if exists transactions_household_id_hash_key;
alter table transactions drop constraint if exists transactions_acc_hash_key;
alter table transactions add constraint transactions_acc_hash_key unique (household_id, account_id, hash);
