# Økonomi

Personlig økonomi-PWA for to: importer kontoutskrifter (Nidaros Sparebank, Sbanken), automatisk kategorisering, manuell sortering av usikre poster, månedsprognose, budsjett med varsler, faste utgifter, utlegg som skal refunderes og fritekstsøk. Data deles via Supabase.

## Oppsett
Se **[SETUP.md](SETUP.md)** for steg-for-steg (Supabase, push-varsler, hosting, iPhone). Lokalt: `npm run serve` → http://localhost:8080. Tester: `npm test`.

## Oppdatere appen lokalt
Last ned nyeste `okonomi.zip` til Nedlastinger og kjør `bash ~/okonomi/oppdater.command`. Scriptet pakker ut riktig, starter serveren og åpner nettleseren.

## Hvordan det virker
- Import hopper over poster som allerede finnes (hash av bank/dato/tekst/beløp). Kolonner gjenkjennes på overskrift, så formatendringer tåles.
- Kategorier: innebygde nøkkelord + regler appen lærer når du sorterer («husk for lignende»).
- Interne overføringer og refunderbare utlegg teller ikke som utgift.
- Prognose: faste poster (samme tekst og beløp ±15 % i 2 av 3 siste måneder) + daglig snitt for variable utgifter + forventet lønn.
- Alle data er beskyttet med radnivå-tilgang (RLS): bare medlemmer av husholdningen ser dem.

- Sesongutgifter: egne (julegaver, forsikring …) + forslag fra poster som forekom for ~12 måneder siden. Ubetalte teller i prognosen, og «sett av per måned» vises på oversikten.
- Push-varsler (Edge Function `notify`): over/nær budsjett, sesongutgift neste måned, mange usorterte poster. Hvert varsel sendes én gang.

## Ikke bygget ennå
Direkte banktilkobling.
