-- Kjør i Supabase → SQL Editor (etter 011). Trygt å kjøre flere ganger.
-- Begge i husholdningen skal kunne sortere, redigere og slette alle poster, ikke bare sine egne.
-- Nye poster må fortsatt merkes med den som legger dem inn.
drop policy if exists "tx" on transactions;
drop policy if exists "tx les" on transactions;
drop policy if exists "tx ny" on transactions;
drop policy if exists "tx endre" on transactions;
drop policy if exists "tx slett" on transactions;
create policy "tx les"   on transactions for select using (is_member(household_id));
create policy "tx ny"    on transactions for insert with check (is_member(household_id) and owner_id = auth.uid());
create policy "tx endre" on transactions for update using (is_member(household_id)) with check (is_member(household_id));
create policy "tx slett" on transactions for delete using (is_member(household_id));
