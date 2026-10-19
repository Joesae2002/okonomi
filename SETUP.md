# Oppsett steg for steg

Total tid: ca. 30–45 minutter. Alt er gratis. Du trenger Node.js på Mac-en (`node -v` skal vise et tall; ellers installer fra nodejs.org).

## 1. Lag Supabase-prosjekt
1. Gå til **supabase.com** → *Start your project* → logg inn med GitHub.
2. *New project*. Navn: `okonomi`. **Database password**: lag et langt passord og lagre det i passordbehandleren (trengs i steg 8). Region: *Europe (Stockholm)* eller *Frankfurt*. Plan: *Free*.
3. Vent ca. 2 minutter til prosjektet er klart.

## 2. Opprett tabellene
1. Menyen til venstre → **SQL Editor** → *New query*.
2. Åpne `supabase/schema.sql` i dette repoet, kopier alt, lim inn og trykk **Run**. Du skal se «Success. No rows returned».
3. Sjekk i **Table Editor**: du skal se `households`, `members`, `transactions`, `budgets`, `rules`, `seasonal_items`, `push_subscriptions`, `alerts_sent`. Alle har et lite lås-ikon (Row Level Security er på).

> Har du kjørt `schema.sql` før en oppdatering? Kjør da også filene i `supabase/migrations/` (002, 003 … i rekkefølge) i SQL Editor. Ny installasjon trenger bare `schema.sql`.

## 3. Innlogging
1. **Authentication** → *Sign In / Providers* → *Email* er på. Skru av **Confirm email** (ellers må dere bekrefte via en epost først).
2. **Authentication → URL Configuration**: sett *Site URL* til `http://localhost:8080` foreløpig. Byttes til den ekte adressen i steg 9.

## 4. Kopier nøklene til appen
1. **Project Settings → API** (eller *API Keys*).
2. Kopier **Project URL** og nøkkelen merket **anon / publishable**.
3. Lim dem inn i `config.js` (`SUPABASE_URL` og `SUPABASE_ANON_KEY`).

> ⚠️ Bruk **aldri** nøkkelen merket `service_role` / `secret` i `config.js`. Den omgår all tilgangskontroll. Anon-nøkkelen er laget for å ligge åpent i appen, og dataene er beskyttet av tilgangsreglene fra steg 2.

## 5. Prøv lokalt
```
npm test          # logikktestene skal si «alle tester OK»
npm run serve     # åpne http://localhost:8080
```
Opprett bruker, lag husholdning, gå til **Mer → Importer** og last opp en kontoutskrift. Sjekk i Supabase **Table Editor → transactions** at radene kom inn.

## 6. Kona
Hun åpner samme adresse, oppretter egen bruker og skriver invitasjonskoden (står under **Mer → Husholdning**) i «Bli med». Hun importerer sine egne kontoer; dere ser felles tall.

## 7. Push-varsler
Varslene sendes av en liten Edge Function (`supabase/functions/notify`). Den kalles av appen etter hver import og av en daglig tidsplan.

1. **Lag VAPID-nøkler** (identiteten til serveren din):
   ```
   npx web-push generate-vapid-keys
   ```
   Du får en *Public Key* og en *Private Key*. Lim Public Key inn i `config.js` (`VAPID_PUBLIC_KEY`). **Private Key skal aldri inn i repoet.**
2. **Koble CLI til prosjektet.** Prosjekt-ref er første del av Project URL (`https://<ref>.supabase.co`).
   ```
   npx supabase login
   npx supabase link --project-ref <ref>
   ```
3. **Legg inn hemmelighetene** (lagres i Supabase, ikke i koden). Bytt ut verdiene:
   ```
   npx supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:din@epost.no CRON_SECRET=<lang-tilfeldig-streng>
   ```
4. **Deploy funksjonen:**
   ```
   npm run deploy:fn
   ```
5. **Daglig kjøring (kl. 08 norsk tid).** SQL Editor, bytt `<ref>` og `<CRON_SECRET>`:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('daglig-varsel', '0 6 * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/notify',
       headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb) $$);
   ```
6. **Slå på på telefonen:** (se steg 9 først på iPhone) Mer → *Slå på varsler på denne enheten* → tillat. Du får et testvarsel med en gang.
7. **Test hele kjeden** fra Mac-en:
   ```
   curl -X POST https://<ref>.supabase.co/functions/v1/notify -H "x-cron-secret: <CRON_SECRET>"
   ```
   Svaret er `{"ok":true,"sent":N}`. Hvis N er 0 er det enten ingenting å varsle om, eller varselet er allerede sendt (hvert varsel sendes én gang). For å teste på nytt: `delete from alerts_sent;` i SQL Editor.
   Feil kan leses under **Edge Functions → notify → Logs**.

## 8. Legg appen på nett (GitHub Pages)
1. Opprett repo på github.com (**tomt**, uten README) og kjør i prosjektmappen:
   ```
   git remote add origin https://github.com/<bruker>/okonomi.git
   git branch -M main
   git push -u origin main
   ```
2. Repo → **Settings → Pages** → *Deploy from a branch* → `main` / `/ (root)`. Etter ett minutt får du `https://<bruker>.github.io/okonomi/`.
3. GitHub Pages krever **offentlig repo** på gratisplanen. Det er trygt her: det eneste som ligger i koden er URL + anon-nøkkel, ikke bankdata og ikke hemmelige nøkler. Vil du ha privat repo, bruk Cloudflare Pages (gratis, kobles til GitHub, ingen byggkommando, output-mappe `/`).
4. Gå tilbake til Supabase **Authentication → URL Configuration** og sett *Site URL* til den nye adressen.

## 9. Telefonen
- **iPhone:** åpne adressen i *Safari* → Del → *Legg til på Hjem-skjerm* → åpne appen fra hjemskjermen. Push virker **bare** slik (iOS 16.4+).
- **Android:** åpne i Chrome, *Installer app*.

## Drift og sikkerhet
- Gratisprosjekter i Supabase **settes på pause etter ca. en uke uten bruk**. Gjenopprett med ett klikk i dashbordet; dataene beholdes.
- Gratisplanen har ikke automatisk sikkerhetskopi. Ta av og til en eksport (Table Editor → transactions → Export CSV).
- Alle tabeller har Row Level Security: bare medlemmer av husholdningen din kan lese eller endre radene. Bankdata ligger i Supabase-databasen (EU-region).
- Etter endringer i `lib/`: kjør `npm run deploy:fn` på nytt så funksjonen får samme regler som appen.
