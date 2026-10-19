-- Kjør i Supabase → SQL Editor (etter 007). Trygt å kjøre flere ganger.
-- Faste utgifter du selv legger inn (matches på tekst i banktrekket).
create table if not exists fixed_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  pattern text not null,                 -- tekst i banktrekket, flere kan skilles med komma, f.eks. «claude, anthropic»
  category text,                         -- tom = settes automatisk fra betalingene
  amount numeric(12,2),                  -- forventet beløp (valgfritt)
  day int check (day between 1 and 31),  -- forventet trekkdag (valgfritt)
  created_at timestamptz default now()
);
alter table fixed_items enable row level security;
drop policy if exists "faste" on fixed_items;
create policy "faste" on fixed_items for all using (is_member(household_id)) with check (is_member(household_id));

-- Utgangspunkt: Coffeo, Overleaf, Claude og Mova (rediger eller fjern i appen)
insert into fixed_items (household_id, name, pattern, category)
select h.id, v.name, v.pattern, 'Abonnement' from households h
cross join (values ('Coffeo', 'coffeo'), ('Overleaf', 'overleaf'), ('Claude', 'claude, anthropic'), ('Mova', 'mova')) as v(name, pattern)
where not exists (select 1 from fixed_items f where f.household_id = h.id and f.name = v.name);
