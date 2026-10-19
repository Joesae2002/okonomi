-- Kjør i Supabase → SQL Editor (etter 006). Trygt å kjøre flere ganger.
-- Flere inntektskilder per person i skattekalkulatoren.
alter table tax_inputs add column if not exists kilder jsonb not null default '[]'::jsonb;
