#!/usr/bin/env bash
# TWT: Nächtliches Backup (cron.json). Datenbank-Dump plus Kopie aller Anhänge
# zu Scaleway (Paris). Bei einem Fehler geht sofort eine Warnmail raus.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "[twt/backup] FEHLER: $1" >&2
  node twt/mail-check.js --fehler "Das nächtliche Backup ist fehlgeschlagen: $1. Details im Scalingo-Log (App twt-wiki, Logs, Suche nach twt/backup)." || true
  exit 1
}
trap 'fail "Abbruch in Zeile $LINENO"' ERR

DB_URL="${SCALINGO_POSTGRESQL_URL:-${DATABASE_URL:-}}"
[ -n "$DB_URL" ] || fail "keine Datenbank-Adresse"

# pg_dump in der Hauptversion des Servers holen (ein älteres pg_dump verweigert neuere Server).
PG_MAJOR=$(node -e '
const { Client } = require("pg");
const url = process.argv[1];
async function version(opts) {
  const c = new Client(opts);
  await c.connect();
  const r = await c.query("SHOW server_version_num");
  await c.end();
  return Math.floor(Number(r.rows[0].server_version_num) / 10000);
}
version({ connectionString: url })
  .catch(() => version({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } }))
  .then((v) => console.log(v))
  .catch((e) => { console.error(e.message); process.exit(1); });
' "$DB_URL")
echo "[twt/backup] PostgreSQL-Server Version $PG_MAJOR"
dbclient-fetcher postgresql "$PG_MAJOR" >/dev/null 2>&1 \
  || dbclient-fetcher pgsql "$PG_MAJOR" >/dev/null 2>&1 \
  || echo "[twt/backup] dbclient-fetcher ohne Erfolg, nutze vorhandenes pg_dump"
export PATH="$HOME/bin:$PATH"
PG_DUMP=$(command -v pg_dump || find / -name pg_dump -type f -perm -u+x 2>/dev/null | head -n 1)
[ -n "$PG_DUMP" ] || fail "pg_dump nicht gefunden"
echo "[twt/backup] $("$PG_DUMP" --version)"

DUMP="${TMPDIR:-/tmp}/twt-wiki.pgsql"
"$PG_DUMP" --clean --if-exists --format c --dbname "$DB_URL" \
  --no-owner --no-privileges --no-comments \
  --exclude-schema 'information_schema' --exclude-schema '^pg_*' \
  --file "$DUMP"
echo "[twt/backup] Dump erstellt: $(du -h "$DUMP" | cut -f1)"

node twt/backup.js "$DUMP"
