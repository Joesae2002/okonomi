-- Kjør i Supabase → SQL Editor hvis du allerede har kjørt schema.sql tidligere.
-- Legger til «ignorert» som posttype og egne kategorier.
alter table transactions drop constraint if exists transactions_kind_check;
alter table transactions add constraint transactions_kind_check check (kind in ('normal','internal','reimbursable','ignored'));

create table if not exists categories (
  household_id uuid references households on delete cascade,
  name text, primary key (household_id, name)
);
alter table categories enable row level security;
drop policy if exists "kategorier" on categories;
create policy "kategorier" on categories for all using (is_member(household_id)) with check (is_member(household_id));
