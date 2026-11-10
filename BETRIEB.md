# TWT Wiki – Betriebsanleitung

Outline als Team-Wiki von Tech Well Told, selbst gehostet in der EU.
Adresse: https://wiki.tech-well-told.de

**Geheimnisse stehen nie in diesem Repository.** Schlüssel und Passwörter liegen
nur in den Scalingo-Umgebungsvariablen und in 1Password (Tresor „TWT Wiki“).

## Aufbau

| Teil | Wo | Zweck |
|---|---|---|
| App | Scalingo, Region `osc-fr1` (Paris), 1 Container M | Outline: Web, API, Websockets, Collaboration, Worker, Cron in einem Prozess |
| Datenbank | Scalingo PostgreSQL Starter 512M | Texte, Nutzer, Rechte |
| Redis | Scalingo Redis Starter | Warteschlangen, Echtzeit |
| Anhänge | Hetzner Object Storage, Falkenstein | Bilder, Dateien, Importe, Exporte |
| Backup-Kopie | Scaleway Object Storage, Paris | nächtliche Kopie von Datenbank und Anhängen |
| Login | Google (nur tech-well-told.de) + Login per E-Mail-Link | |
| Mail | Google Workspace SMTP-Relay | Einladungen, Anmeldelinks |
| DNS | Strato | `wiki` → Scalingo |

Code: Fork von `outline/outline`. Branch `twt` = letzter offizieller Release plus
**nur** die TWT-Anpassungen unten. Scalingo deployt automatisch aus `twt`.

### TWT-Anpassungen gegenüber Outline

So wenige wie möglich, damit Updates ohne Konflikte durchlaufen.

- `Procfile`: ein Container für alles. Nach jedem Deploy: CORS-Regel des
  Anhang-Buckets setzen, dann Datenbank-Migrationen.
- `twt/s3-cors.js`: setzt die CORS-Regel, damit Browser direkt in den Bucket
  hochladen dürfen (nur für die Adresse aus `URL`).
- `twt/mail-check.js` und `cron.json`: monatliche Testmail (siehe Update).
- `BETRIEB.md`: diese Datei.

Alles andere steuern Umgebungsvariablen. Nach einer Änderung in Scalingo greift
sie erst nach einem Neustart oder Deploy. Wichtig: `SERVICES` muss `cron`
enthalten, sonst laufen geplante Aufgaben (Papierkorb leeren, Aufräumen) nicht.

## Umgebungsvariablen (nur Namen, Werte in Scalingo/1Password)

| Variable | Inhalt |
|---|---|
| `NODE_ENV` | `production` |
| `URL` | `https://wiki.tech-well-told.de` |
| `SERVICES` | `web,websockets,collaboration,worker,cron` |
| `WEB_CONCURRENCY` | `1` |
| `FORCE_HTTPS` | `true` |
| `DEFAULT_LANGUAGE` | `de_DE` |
| `SECRET_KEY`, `UTILS_SECRET` | Zufallswerte, **nie ändern** (sonst sind verschlüsselte Daten weg) |
| `DATABASE_URL`, `REDIS_URL` | setzt Scalingo über die Add-ons |
| `FILE_STORAGE` | `s3` |
| `AWS_REGION` | `fsn1` |
| `AWS_S3_UPLOAD_BUCKET_URL` | `https://fsn1.your-objectstorage.com` |
| `AWS_S3_UPLOAD_BUCKET_NAME` | `twt-wiki-anhaenge` |
| `AWS_S3_FORCE_PATH_STYLE`, `AWS_S3_ACL` | `false`, `private` |
| `FILE_STORAGE_UPLOAD_MAX_SIZE` | `104857600` (100 MB pro Anhang; Standard wäre 1 MB) |
| `FILE_STORAGE_WORKSPACE_IMPORT_MAX_SIZE` | `524288000` (500 MB für den Import ganzer Arbeitsbereiche, z. B. Notion) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Hetzner S3-Zugangsdaten (Projekt „Default“) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Projekt „TWT Outline“, App-Typ intern |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | `smtp-relay.gmail.com`, `587`, `false` (STARTTLS) |
| `SMTP_NAME` | `wiki.tech-well-told.de` |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Alex' Google-Konto plus App-Passwort „TWT Wiki“ |
| `SMTP_FROM_EMAIL`, `SMTP_REPLY_EMAIL` | `TWT Wiki <wiki@tech-well-told.de>`, Antworten an Alex |

Achtung Variablennamen: exakt so schreiben. Ein Tippfehler (z. B.
`AWS_ACESS_KEY_ID`) fällt nicht beim Start auf, sondern erst, wenn Uploads scheitern.

**Mail bricht ab, wenn Alex sein Google-Passwort ändert:** Dann wird das
App-Passwort ungültig. Neues App-Passwort anlegen (myaccount.google.com →
App-Passwörter), in 1Password und als `SMTP_PASSWORD` in Scalingo ersetzen.

## Einstellungen im Wiki (Admin)

- Authentifizierung: Google an, erlaubte Domain nur `tech-well-told.de`.
  Login per E-Mail an (braucht SMTP). Mail-Login funktioniert nur für bereits
  eingeladene Personen; unbekannte Adressen bekommen keinen Link.
- Sicherheit: Standard-Rolle „Betrachter“, Einladungen nur durch Admins.
- KI: MCP-Server an. Adresse für Claude: `https://wiki.tech-well-told.de/mcp`
  (Anmeldung per OAuth, Rechte wie die verbundene Person).

## Zugänge (wer verwaltet was)

| Dienst | Konto | Zugang in 1Password |
|---|---|---|
| GitHub | `Alex-TWT` | ja |
| Scalingo | GmbH-Account | ja |
| Hetzner | GmbH-Account | ja |
| Scaleway | GmbH-Account | ja |
| Google Cloud | Admin tech-well-told.de, Projekt „TWT Outline“ | ja |
| Strato | TWT-Account | ja |

Notfallhilfe: Vorbild ist `ignitevideo/outline-knowledge-base` (Branch `scalingo`),
gleiche Architektur. Abweichungen bei TWT: aktueller Release, cron-Dienst aktiv,
Anhänge in S3 statt auf der Container-Festplatte.

## Update (monatlich)

Läuft automatisch als geplante Aufgabe in Claude („TWT Wiki Monatsupdate“,
am ersten Samstag jedes Monats um 10:47 Uhr, damit ein Ausfall das Team nicht
trifft). Ablauf:

1. Neuesten offiziellen Outline-Release suchen (keine Vorabversionen).
2. Gleiche Hauptversion (z. B. 1.x → 1.y) und keine Hinweise auf nötige
   Umbauten in den Release-Notes: Release in `twt` mergen, pushen. Scalingo
   deployt, Migrationen laufen im `postdeploy`.
3. Neue Hauptversion, Merge-Konflikt außerhalb der TWT-Dateien oder geänderte
   Pflicht-Variablen: **kein** Merge. Die Routine meldet, was zu tun ist.
4. Prüfen: `/_health` antwortet `OK`, Anmeldeseite lädt, MCP antwortet.
5. Mailversand prüfen (siehe unten).
6. Kurzer Bericht an Alex.

**Mail-Check:** `cron.json` startet am 1. jedes Monats um 05:00 UTC
`twt/mail-check.js`. Das Skript schickt über den Wiki-Mailzugang eine Testmail
„TWT Wiki Mailtest JJJJ-MM“ an `SMTP_REPLY_EMAIL`. Die Routine sucht sie am ersten Samstag im
Postfach. Fehlt sie, ist fast immer das App-Passwort ungültig (siehe oben:
Google-Passwort geändert). Manuell testen: in Scalingo `scalingo --app twt-wiki
run node twt/mail-check.js`.

**Deploy schiefgegangen:** Scalingo lässt bei einem fehlgeschlagenen Build die
alte Version laufen. Startet die neue Version nicht, in Scalingo unter
Deployments die vorige Version neu deployen und die Datenbank prüfen (Backup
unten).

## Backup

_Wird beim Aufbau ergänzt._

- Datenbank: Scalingo erstellt täglich ein Backup und erlaubt Wiederherstellung
  auf jeden Zeitpunkt der letzten 7 Tage. Zusätzlich nächtlicher Dump zu Scaleway.
- Anhänge: nächtliche Kopie des Hetzner-Buckets zu Scaleway.

## Wiederherstellung

_Wird beim Aufbau ergänzt und vor dem Livegang einmal komplett getestet._
