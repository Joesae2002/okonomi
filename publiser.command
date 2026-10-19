#!/bin/bash
# Pakker ut den nyeste okonomi*.zip fra Nedlastinger og publiserer appen på nett (GitHub Pages).
#   Kjør:  bash ~/okonomi/publiser.command
# Første gang spør den etter adressen til GitHub-repoet ditt (f.eks. https://github.com/brukernavn/okonomi.git).
# Etter ca. ett minutt er den nye versjonen oppe på telefonen. Dataene dine ligger i Supabase og berøres ikke.
set -e
APP="${OKONOMI_DIR:-$HOME/okonomi}"
DL="${OKONOMI_DOWNLOADS:-$HOME/Downloads}"

ZIP=$(ls -t "$DL"/okonomi*.zip 2>/dev/null | head -1 || true)
if [ -n "$ZIP" ]; then
  echo "→ Oppdaterer fra: $ZIP"
  TMP=$(mktemp -d)
  unzip -q "$ZIP" -d "$TMP"
  SRC="$TMP/okonomi"; [ -d "$SRC" ] || SRC="$TMP"
  [ -f "$SRC/index.html" ] || { echo "✗ Zip-filen ser ikke riktig ut (finner ikke index.html)."; exit 1; }
  mkdir -p "$APP"
  rm -rf "$APP/lib" "$APP/vendor"            # fjerner utdaterte filer; resten overskrives (.git berøres ikke)
  [ -f "$APP/okonomi/index.html" ] && rm -rf "$APP/okonomi"
  cp -R "$SRC"/. "$APP"/
  rm -rf "$TMP"
  mv "$ZIP" "${ZIP%.zip}.installert"
else
  echo "(Ingen ny okonomi*.zip i $DL. Publiserer filene slik de er.)"
fi
[ -f "$APP/index.html" ] || { echo "✗ Fant ikke appen i $APP. Last ned okonomi.zip først."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "✗ Git er ikke installert. Skriv «git --version» i terminalen for å installere det."; exit 1; }

cd "$APP"
[ -d .git ] || { git init -q -b main 2>/dev/null || { git init -q; git checkout -q -b main; }; }
printf 'node_modules/\nsupabase/functions/_shared/\n.DS_Store\n*.installert\n*.zip\n' > .gitignore

if ! git remote get-url origin >/dev/null 2>&1; then
  URL="$OKONOMI_REPO"
  if [ -z "$URL" ]; then
    echo; echo "Lag først et tomt repo på github.com (New repository, navn «okonomi», Public)."
    printf "Lim inn repo-adressen (https://github.com/brukernavn/okonomi.git): "; read -r URL
  fi
  [ -n "$URL" ] || { echo "✗ Ingen adresse oppgitt."; exit 1; }
  git remote add origin "$URL"
fi

VER=$(grep -o "__build = '[^']*'" app.js | cut -d"'" -f2)
git add -A
if git diff --cached --quiet; then echo "(Ingen endringer siden sist.)"; else
  git -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo okonomi)}" -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo okonomi@localhost)}" commit -q -m "Versjon $VER"
fi
echo "→ Sender til GitHub …"
git push -u origin main || { echo "✗ Push feilet. Sjekk at repo-adressen stemmer og at du er logget inn på GitHub (github.com/settings/tokens, eller «gh auth login»)."; exit 1; }

URL=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)([^/]+)/([^/.]+)(\.git)?#https://\2.github.io/\3/#')
echo "✓ Versjon $VER er sendt."
echo "✓ Om ca. ett minutt er den oppe på: $URL"
echo "  Lukk appen på telefonen helt og åpne den på nytt for å få den nye versjonen."
true
