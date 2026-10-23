#!/bin/bash
# Oppdaterer Økonomi-appen fra den nyeste okonomi*.zip i Nedlastinger, og starter den.
#   Kjør:  bash ~/okonomi/oppdater.command
# Den (1) pakker ut riktig, (2) stopper gammel server, (3) starter ny og (4) åpner nettleseren.
# Dataene dine ligger i Supabase og berøres ikke.
set -e
APP="${OKONOMI_DIR:-$HOME/okonomi}"
DL="${OKONOMI_DOWNLOADS:-$HOME/Downloads}"
PORT="${PORT:-8080}"

ZIP=$(ls -t "$DL"/okonomi*.zip 2>/dev/null | head -1 || true)
if [ -n "$ZIP" ]; then
  echo "→ Oppdaterer fra: $ZIP"
  TMP=$(mktemp -d)
  unzip -q "$ZIP" -d "$TMP"
  SRC="$TMP/okonomi"; [ -d "$SRC" ] || SRC="$TMP"
  [ -f "$SRC/index.html" ] || { echo "✗ Zip-filen ser ikke riktig ut (finner ikke index.html)."; exit 1; }
  mkdir -p "$APP"
  rm -rf "$APP/lib" "$APP/vendor"            # fjerner utdaterte filer; resten overskrives
  [ -f "$APP/okonomi/index.html" ] && rm -rf "$APP/okonomi"   # gammel mappe-i-mappen fra manuell utpakking
  [ -f "$APP/config.js" ] && cp "$APP/config.js" "$TMP/config.keep"   # dine egne nøkler (Supabase, VAPID) skal ikke overskrives
  cp -R "$SRC"/. "$APP"/
  [ -f "$TMP/config.keep" ] && cp "$TMP/config.keep" "$APP/config.js"
  rm -rf "$TMP"
  mv "$ZIP" "${ZIP%.zip}.installert"          # så samme fil ikke brukes to ganger
else
  echo "(Ingen ny okonomi*.zip i $DL. Starter bare appen slik den er.)"
fi
[ -f "$APP/index.html" ] || { echo "✗ Fant ikke appen i $APP. Last ned okonomi.zip først."; exit 1; }

# Stopp gammel server på porten, start ny i bakgrunnen
if command -v lsof >/dev/null 2>&1; then lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null || true; sleep 1; fi
nohup python3 -m http.server "$PORT" --directory "$APP" >/tmp/okonomi-server.log 2>&1 &
sleep 1
echo "✓ Versjon: $(grep -o "__build = '[^']*'" "$APP/app.js" | cut -d"'" -f2)"
echo "✓ Appen kjører på http://localhost:$PORT  (trykk ⇧⌘R i nettleseren)"
[ -z "$NO_OPEN" ] && command -v open >/dev/null 2>&1 && open "http://localhost:$PORT"
true
