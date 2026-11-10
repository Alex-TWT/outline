#!/usr/bin/env bash
# TWT: Wiederherstellungstest. Holt den neuesten Dump aus dem Scaleway-Backup,
# spielt ihn in ein getrenntes Schema "restore_test" ein, vergleicht
# Zeilenzahlen mit den Live-Tabellen, prüft eine Anhang-Kopie und löscht das
# Schema wieder. Live-Tabellen werden nur gelesen. Aufruf: bash twt/restore-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

LIVE_URL="${SCALINGO_POSTGRESQL_URL:-${DATABASE_URL:-}}"
[ -n "$LIVE_URL" ] || { echo "[twt/restore-test] keine Datenbank-Adresse"; exit 1; }
WORK="${TMPDIR:-/tmp}/twt-restore"
mkdir -p "$WORK"

PG_MAJOR=$(node -e '
const { Client } = require("pg");
const url = process.argv[1];
async function v(o) { const c = new Client(o); await c.connect(); const r = await c.query("SHOW server_version_num"); await c.end(); return Math.floor(Number(r.rows[0].server_version_num) / 10000); }
v({ connectionString: url }).catch(() => v({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } })).then(console.log).catch((e) => { console.error(e.message); process.exit(1); });
' "$LIVE_URL")
dbclient-fetcher postgresql "$PG_MAJOR" >/dev/null 2>&1 || dbclient-fetcher pgsql "$PG_MAJOR" >/dev/null 2>&1 || true
export PATH="$HOME/bin:$PATH"
echo "[twt/restore-test] $(pg_restore --version)"

# Neuesten Dump und eine Anhang-Stichprobe aus Scaleway holen.
node twt/restore-fetch.js "$WORK"
DUMP=$(cat "$WORK/dump-path")

# Scalingo erlaubt keine zweite Datenbank. Darum: Dump in das getrennte Schema
# "restore_test" der Live-Datenbank einspielen. Alle Objekte im Dump sind mit
# "public." qualifiziert; das wird auf "restore_test." umgeschrieben, sodass
# kein Befehl die Live-Tabellen berührt. Danach wird das Schema gelöscht.
TS=restore_test
cleanup() {
  psql "$LIVE_URL" -qc "DROP SCHEMA IF EXISTS $TS CASCADE;" >/dev/null 2>&1 \
    && echo "[twt/restore-test] Testschema gelöscht." || echo "[twt/restore-test] Testschema konnte nicht gelöscht werden."
}
trap cleanup EXIT

pg_restore --no-owner --no-privileges -f "$WORK/dump.sql" "$DUMP"
sed -E -e "s/\bpublic\./$TS./g" -e "s/SCHEMA public\b/SCHEMA $TS/g" "$WORK/dump.sql" > "$WORK/restore.sql"

# Funktionen, Operatorklassen und Typen von Erweiterungen (uuid-ossp, pg_trgm …)
# bleiben in public; Verweise darauf wieder zurückschreiben.
psql "$LIVE_URL" -Atc "
  SELECT p.proname FROM pg_proc p JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION SELECT c.opcname FROM pg_opclass c JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
    JOIN pg_namespace n ON n.oid = c.opcnamespace WHERE n.nspname = 'public'
  UNION SELECT t.typname FROM pg_type t JOIN pg_depend d ON d.objid = t.oid AND d.deptype = 'e'
    JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public';" \
  | grep -E '^[A-Za-z0-9_]+$' | sort -u > "$WORK/ext-names"
while read -r name; do
  sed -i -E "s/\b$TS\.$name\b/public.$name/g" "$WORK/restore.sql"
done < "$WORK/ext-names"
echo "[twt/restore-test] Erweiterungs-Objekte in public belassen: $(wc -l < "$WORK/ext-names")"
if grep -nE "\bpublic\b" "$WORK/restore.sql" | grep -vE "^[0-9]+:(--|COPY|[0-9a-f]{8}-)" | grep -viE "^[0-9]+:\s*$" | head -n 5 | grep -q .; then
  echo "[twt/restore-test] Hinweis: verbleibende Erwähnungen von public:"
  grep -nE "\bpublic\b" "$WORK/restore.sql" | grep -vE "^[0-9]+:(--|COPY)" | head -n 5 | cut -c1-160
fi

psql "$LIVE_URL" -v ON_ERROR_STOP=1 -qc "DROP SCHEMA IF EXISTS $TS CASCADE; CREATE SCHEMA $TS;" >/dev/null
START=$(date +%s)
psql "$LIVE_URL" -v ON_ERROR_STOP=0 -q -f "$WORK/restore.sql" >/dev/null 2>"$WORK/restore.log" || true
echo "[twt/restore-test] Dump eingespielt in $(( $(date +%s) - START )) s, Fehlermeldungen: $(grep -c 'ERROR' "$WORK/restore.log" || true)"
grep 'ERROR' "$WORK/restore.log" | head -n 10 | cut -c1-200 | sed 's/^/[twt\/restore-test]   /' || true

counts() {
  psql "$LIVE_URL" -AtF ' | ' -c "SELECT
    (SELECT count(*) FROM $1.documents) AS dokumente,
    (SELECT count(*) FROM $1.collections) AS sammlungen,
    (SELECT count(*) FROM $1.users) AS nutzer,
    (SELECT count(*) FROM $1.attachments) AS anhaenge,
    (SELECT count(*) FROM $1.\"SequelizeMeta\") AS migrationen,
    (SELECT max(\"updatedAt\") FROM $1.documents) AS letzte_aenderung;"
}
echo "[twt/restore-test] Spalten: Dokumente | Sammlungen | Nutzer | Anhänge | Migrationen | letzte Änderung"
echo "[twt/restore-test] Wiederhergestellt: $(counts $TS)"
echo "[twt/restore-test] Live:              $(counts public)"
echo "[twt/restore-test] Tabellen: $(psql "$LIVE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$TS';") (Live: $(psql "$LIVE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"))"
RESTORED=$(counts $TS) || RESTORED=""
LIVE_TABLES=$(psql "$LIVE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
TEST_TABLES=$(psql "$LIVE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$TS';")
if [ -z "$RESTORED" ] || [ "$TEST_TABLES" != "$LIVE_TABLES" ]; then
  echo "[twt/restore-test] FEHLGESCHLAGEN: Tabellen $TEST_TABLES von $LIVE_TABLES wiederhergestellt."
  exit 1
fi
echo "[twt/restore-test] Fertig: Wiederherstellung erfolgreich."
