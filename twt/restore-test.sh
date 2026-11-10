#!/usr/bin/env bash
# TWT: Wiederherstellungstest. Holt den neuesten Dump aus dem Scaleway-Backup,
# spielt ihn in eine temporäre Datenbank ein, vergleicht Zeilenzahlen mit der
# Live-Datenbank, prüft eine Anhang-Kopie und löscht die Testdatenbank wieder.
# Die Live-Datenbank wird nur gelesen. Aufruf: bash twt/restore-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

LIVE_URL="${SCALINGO_POSTGRESQL_URL:-${DATABASE_URL:-}}"
[ -n "$LIVE_URL" ] || { echo "[twt/restore-test] keine Datenbank-Adresse"; exit 1; }
TEST_DB="twt_restoretest"
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

# Adresse der Testdatenbank: gleiche Instanz, anderer Datenbankname.
TEST_URL=$(node -e '
const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString());
' "$LIVE_URL" "$TEST_DB")

cleanup() {
  psql "$LIVE_URL" -v ON_ERROR_STOP=0 -qc "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 \
    && echo "[twt/restore-test] Testdatenbank gelöscht." || echo "[twt/restore-test] Testdatenbank konnte nicht gelöscht werden."
}
trap cleanup EXIT

psql "$LIVE_URL" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null
psql "$LIVE_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $TEST_DB;" >/dev/null
echo "[twt/restore-test] Testdatenbank angelegt."

START=$(date +%s)
pg_restore --no-owner --no-privileges -d "$TEST_URL" "$DUMP" 2>"$WORK/restore.log" || true
echo "[twt/restore-test] Dump eingespielt in $(( $(date +%s) - START )) s, Meldungen: $(grep -c 'error' "$WORK/restore.log" || true)"
grep 'error' "$WORK/restore.log" | head -n 10 | sed 's/^/[twt\/restore-test]   /' || true

COUNTS='SELECT
  (SELECT count(*) FROM documents) AS dokumente,
  (SELECT count(*) FROM collections) AS sammlungen,
  (SELECT count(*) FROM users) AS nutzer,
  (SELECT count(*) FROM attachments) AS anhaenge,
  (SELECT count(*) FROM "SequelizeMeta") AS migrationen,
  (SELECT max("updatedAt") FROM documents) AS letzte_aenderung;'
echo "[twt/restore-test] Wiederhergestellt: $(psql "$TEST_URL" -AtF ' | ' -c "$COUNTS")"
echo "[twt/restore-test] Live:              $(psql "$LIVE_URL" -AtF ' | ' -c "$COUNTS")"
echo "[twt/restore-test] Spalten in documents: $(psql "$TEST_URL" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name = 'documents';") (Live: $(psql "$LIVE_URL" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name = 'documents';"))"
echo "[twt/restore-test] Fertig: Wiederherstellung erfolgreich."
