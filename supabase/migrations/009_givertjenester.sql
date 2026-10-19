-- Kjør i Supabase → SQL Editor (etter 008). Trygt å kjøre flere ganger.
-- Faste givertjenester på samme side som faste utgifter.
alter table fixed_items add column if not exists kind text not null default 'utgift' check (kind in ('utgift', 'giver'));

-- Utgangspunkt: Krik, Salt og Nasjonalforeningen. Søketekst som starter med = må treffe hele teksten.
-- Krik: «Krik Gaver Og Medle» (ikke Krik Kafe, Butikk eller Leirkontor). Salt: bare «Vipps: Salt» (ikke Salt Bergen eller Salt Kafe).
insert into fixed_items (household_id, name, pattern, category, kind)
select h.id, v.name, v.pattern, 'Givertjeneste', 'giver' from households h
cross join (values ('Krik', 'krik gaver, krik giver'), ('Salt', '=vipps: salt'), ('Nasjonalforeningen (demensforskning)', 'nasjonalfor')) as v(name, pattern)
where not exists (select 1 from fixed_items f where f.household_id = h.id and f.name = v.name and f.kind = 'giver');
