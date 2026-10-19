-- Kjør i Supabase → SQL Editor (etter 003). Trygt å kjøre flere ganger.
-- Notat per budsjettpost, og regnestykket som ble skrevet (f.eks. 250*2).
alter table budgets add column if not exists note text;
alter table budgets add column if not exists formula text;
