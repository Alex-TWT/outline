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
- `BETRIEB.md`: diese Datei.

Alles andere steuern Umgebungsvariablen. Wichtig: `SERVICES` muss `cron`
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
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Hetzner S3-Zugangsdaten (Projekt „Default“) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Projekt „TWT Outline“, App-Typ intern |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_SECURE` | Workspace-Relay |

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

_Wird beim Aufbau ergänzt: automatische Vorbereitung als Pull Request, Freigabe,
Deploy, Prüfung von `/_health`, Login und MCP._

## Backup

_Wird beim Aufbau ergänzt._

- Datenbank: Scalingo erstellt täglich ein Backup und erlaubt Wiederherstellung
  auf jeden Zeitpunkt der letzten 7 Tage. Zusätzlich nächtlicher Dump zu Scaleway.
- Anhänge: nächtliche Kopie des Hetzner-Buckets zu Scaleway.

## Wiederherstellung

_Wird beim Aufbau ergänzt und vor dem Livegang einmal komplett getestet._
