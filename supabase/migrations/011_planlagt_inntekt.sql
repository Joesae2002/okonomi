-- Kjør i Supabase → SQL Editor (etter 010). Trygt å kjøre flere ganger.
create table if not exists income_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  person text not null,                       -- hvem inntekten tilhører
  name text not null,                         -- f.eks. Krik, Støttekontakt, Avlastningsbolig
  amount numeric(12,2) not null check (amount >= 0),   -- netto per utbetaling
  times numeric(6,3) not null default 1 check (times > 0),   -- antall utbetalinger per måned (annenhver helg ≈ 2,167)
  start_month text check (start_month ~ '^\d{4}-\d{2}$'),
  end_month text check (end_month ~ '^\d{4}-\d{2}$'),       -- tom = løpende
  created_at timestamptz not null default now()
);
alter table income_plans enable row level security;
drop policy if exists "inntektsplan" on income_plans;
create policy "inntektsplan" on income_plans for all using (is_member(household_id)) with check (is_member(household_id));
