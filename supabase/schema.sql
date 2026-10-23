-- Kjør hele filen i Supabase → SQL Editor.

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz default now()
);

create table members (
  household_id uuid references households on delete cascade,
  user_id uuid references auth.users on delete cascade,
  display_name text not null,
  primary key (household_id, user_id)
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  bank text not null default 'nidaros' check (bank in ('nidaros', 'sbanken')),
  number text,                                   -- kontonummer, læres automatisk fra Nidaros-filer
  person text,                                   -- hvem kontoen tilhører (for lønn)
  remind boolean not null default true,          -- med i den månedlige påminnelsen om å laste opp bankloggen?
  unique (household_id, name)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null references auth.users,
  bank text, date date not null, text text not null, amount numeric(12,2) not null,
  category text not null default 'Annet',
  status text not null default 'auto' check (status in ('auto','uncertain','manual')),
  kind text not null default 'normal' check (kind in ('normal','internal','reimbursable','ignored')),
  reimb_for text,                       -- f.eks. «Opplett» eller vennens navn
  reimbursed boolean not null default false,
  hash text not null,
  account_id uuid references accounts on delete set null,
  comment text,
  share numeric(7,5) not null default 1 check (share > 0 and share <= 1),   -- din andel: 1 = hele, 0.5 = halvparten
  person text,                          -- overstyrer kontoens eier på lønnsposter
  from_acc text, to_acc text,           -- avsender-/mottakerkonto fra banken
  unique (household_id, account_id, hash)
);
create index on transactions (household_id, date);

create table budgets (
  household_id uuid references households on delete cascade,
  category text, amount numeric(12,2) not null,
  note text,                            -- hva hører hjemme under posten, f.eks. «Mova*2, Claude*2»
  formula text,                         -- regnestykket som ble skrevet, f.eks. «250*2»
  primary key (household_id, category)
);

create table rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  pattern text not null, category text not null,
  unique (household_id, pattern)
);

create table tax_inputs (
  household_id uuid not null references households on delete cascade,
  person text not null, year int not null,
  brutto_hittil numeric(12,2), skatt_hittil numeric(12,2), maaneder int, brutto_aar numeric(12,2), trekk_pct numeric(5,2),
  renter numeric(12,2), fagforening numeric(12,2), reise numeric(12,2), annet numeric(12,2), bsu numeric(12,2),
  gift boolean not null default true,
  kilder jsonb not null default '[]'::jsonb,   -- inntektskilder: [{key, navn, brutto_hittil, skatt_hittil, maaneder, brutto_aar, trekk_pct, skjult}]
  primary key (household_id, person, year)
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  target numeric(12,2) not null,
  saved numeric(12,2) not null default 0,
  monthly numeric(12,2),                 -- planlagt sparing per måned (tom = bruk snittet av overskuddet)
  deadline date,
  created_at timestamptz default now()
);

create table hidden_subs (
  household_id uuid not null references households on delete cascade,
  key text not null,
  primary key (household_id, key)
);

create table fixed_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  pattern text not null,                 -- tekst i banktrekket, flere kan skilles med komma
  category text,                         -- tom = settes automatisk fra betalingene
  amount numeric(12,2),                  -- forventet beløp (valgfritt)
  day int check (day between 1 and 31),  -- forventet trekkdag (valgfritt)
  kind text not null default 'utgift' check (kind in ('utgift', 'giver')),   -- faste utgifter eller faste givertjenester
  created_at timestamptz default now()
);

create table upload_marks (             -- konto merket som ferdig opplastet for en måned (for hånd)
  household_id uuid not null references households on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  primary key (household_id, account_id, month)
);

create table categories (            -- egne kategorier ut over de innebygde
  household_id uuid references households on delete cascade,
  name text, primary key (household_id, name)
);

create table seasonal_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null, amount numeric(12,2) not null default 0,
  month int not null default 1 check (month between 1 and 12),
  category text not null default 'Annet',
  ignore boolean not null default false,        -- true = skjult forslag (name = nøkkel)
  unique (household_id, name)
);

-- Én rad per enhet som har slått på push-varsler
create table push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null, auth text not null
);

-- Hvilke varsler som allerede er sendt (hindrer dobbelvarsling). Kun Edge Function (service role) har tilgang.
create table alerts_sent (
  household_id uuid references households on delete cascade,
  key text, sent_at timestamptz default now(),
  primary key (household_id, key)
);

-- Hjelper: er innlogget bruker medlem av husholdningen?
create function is_member(h uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from members where household_id = h and user_id = auth.uid()) $$;

alter table households enable row level security;
alter table members enable row level security;
alter table transactions enable row level security;
alter table budgets enable row level security;
alter table rules enable row level security;
alter table seasonal_items enable row level security;
alter table categories enable row level security;
alter table accounts enable row level security;
alter table upload_marks enable row level security;
alter table fixed_items enable row level security;
alter table goals enable row level security;
alter table hidden_subs enable row level security;
alter table tax_inputs enable row level security;
alter table push_subscriptions enable row level security;
alter table alerts_sent enable row level security;  -- ingen policies = ingen tilgang for appen

create policy "se egen husholdning" on households for select using (is_member(id));
create policy "se medlemmer" on members for select using (is_member(household_id));
create policy "oppdater eget navn" on members for update using (user_id = auth.uid());
create policy "tx les"   on transactions for select using (is_member(household_id));
create policy "tx ny"    on transactions for insert with check (is_member(household_id) and owner_id = auth.uid());
create policy "tx endre" on transactions for update using (is_member(household_id)) with check (is_member(household_id));
create policy "tx slett" on transactions for delete using (is_member(household_id));
create policy "budsjett" on budgets for all using (is_member(household_id)) with check (is_member(household_id));
create policy "skatt" on tax_inputs for all using (is_member(household_id)) with check (is_member(household_id));
create policy "maal" on goals for all using (is_member(household_id)) with check (is_member(household_id));
create policy "skjulte faste" on hidden_subs for all using (is_member(household_id)) with check (is_member(household_id));
create policy "faste" on fixed_items for all using (is_member(household_id)) with check (is_member(household_id));
create policy "opplasting" on upload_marks for all using (is_member(household_id)) with check (is_member(household_id));
create policy "kontoer" on accounts for all using (is_member(household_id)) with check (is_member(household_id));
create policy "kategorier" on categories for all using (is_member(household_id)) with check (is_member(household_id));
create policy "sesong" on seasonal_items for all using (is_member(household_id)) with check (is_member(household_id));
create policy "egne push-abonnement" on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "regler" on rules for all using (is_member(household_id)) with check (is_member(household_id));

-- Opprett ny husholdning (kalles fra appen)
create function create_household(hname text, dname text) returns households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  insert into households(name) values (hname) returning * into h;
  insert into members values (h.id, auth.uid(), dname);
  insert into accounts (household_id, name, bank) values
    (h.id, 'Jørgens Brukskonto', 'nidaros'), (h.id, 'Ellinors Konto', 'nidaros'),
    (h.id, 'Felles Regningskonto', 'nidaros'), (h.id, 'Jørgens Sbanken', 'sbanken');
  update accounts set person = 'Jørgen' where household_id = h.id and name ilike 'Jørgens%';
  update accounts set person = 'Ellinor' where household_id = h.id and name ilike 'Ellinors%';
  return h;
end $$;

-- Bli med via invitasjonskode (kona bruker denne)
create function join_household(code text, dname text) returns households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  select * into h from households where invite_code = lower(trim(code));
  if not found then raise exception 'Ugyldig kode'; end if;
  insert into members values (h.id, auth.uid(), dname) on conflict do nothing;
  return h;
end $$;

revoke all on function create_household, join_household from public, anon;
grant execute on function create_household, join_household to authenticated;

-- Planlagt inntekt (jobber, perioder, helgevakter)
create table income_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  person text not null, name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  times numeric(6,3) not null default 1 check (times > 0),
  start_month text check (start_month ~ '^\d{4}-\d{2}$'),
  end_month text check (end_month ~ '^\d{4}-\d{2}$'),
  created_at timestamptz not null default now()
);
alter table income_plans enable row level security;
create policy "inntektsplan" on income_plans for all using (is_member(household_id)) with check (is_member(household_id));
