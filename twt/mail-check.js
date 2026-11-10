/* eslint-disable no-console */
// TWT: Mails des Wiki-Betriebs über denselben SMTP-Zugang wie Outline.
//   node twt/mail-check.js            Monatliche Testmail (cron.json) inkl.
//                                     Stand des letzten Backups. Die Monats-
//                                     routine prüft im Postfach, ob sie ankam.
//   node twt/mail-check.js --fehler "Text"   Sofortige Warnmail (Backup).
// Fehlt die Testmail, ist meist das Google-App-Passwort ungültig (z. B. nach
// einer Passwortänderung). Liest nur Umgebungsvariablen.
const nodemailer = require("nodemailer");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const env = process.env;

async function backupStatus() {
  if (!env.BACKUP_S3_ACCESS_KEY_ID || !env.BACKUP_S3_SECRET_ACCESS_KEY) {
    return "Backup: noch nicht eingerichtet.";
  }
  try {
    const client = new S3Client({
      region: env.BACKUP_S3_REGION || "fr-par",
      endpoint: env.BACKUP_S3_ENDPOINT || "https://s3.fr-par.scw.cloud",
      credentials: {
        accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
        secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
      },
    });
    const res = await client.send(
      new GetObjectCommand({
        Bucket: env.BACKUP_S3_BUCKET || "twt-wiki-backup",
        Key: "status/letztes-backup.json",
      })
    );
    const s = JSON.parse(await res.Body.transformToString());
    const hours = Math.round((Date.now() - new Date(s.zeit).getTime()) / 36e5);
    return (
      `Backup: letztes erfolgreiches Backup ${s.zeit} (vor ${hours} Stunden), ` +
      `Dump ${Math.round(s.dumpBytes / 1024)} KB, ${s.anhaengeGesamt} Anhänge, ` +
      `Object Lock ${s.objectLock ? "an" : "AUS"}.` +
      (hours > 48 ? " ACHTUNG: älter als 48 Stunden." : "")
    );
  } catch (err) {
    return `Backup: Status nicht lesbar (${err.message}). ACHTUNG: prüfen.`;
  }
}

async function main() {
  const to = env.SMTP_REPLY_EMAIL || env.SMTP_USERNAME;
  if (!env.SMTP_HOST || !to) {
    console.log("[twt/mail-check] SMTP nicht konfiguriert, übersprungen.");
    return;
  }

  const transport = nodemailer.createTransport({
    name: env.SMTP_NAME,
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USERNAME
      ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
      : undefined,
  });

  if (process.argv[2] === "--fehler") {
    await transport.sendMail({
      from: env.SMTP_FROM_EMAIL,
      to,
      subject: "TWT Wiki: Backup FEHLGESCHLAGEN",
      text: `${process.argv[3] || "Unbekannter Fehler."}\n\nSiehe BETRIEB.md, Abschnitt Backup.`,
    });
    console.log(`[twt/mail-check] Warnmail an ${to} verschickt.`);
    return;
  }

  const month = new Date().toISOString().slice(0, 7);
  await transport.sendMail({
    from: env.SMTP_FROM_EMAIL,
    to,
    subject: `TWT Wiki Mailtest ${month}`,
    text:
      "Automatische Testmail des TWT Wiki. Kommt sie an, funktioniert der " +
      "Mailversand (Einladungen, Anmeldelinks).\n\n" +
      (await backupStatus()),
  });
  console.log(`[twt/mail-check] Testmail ${month} an ${to} verschickt.`);
}

main().catch((err) => {
  console.error("[twt/mail-check] Fehler:", err.message);
  process.exit(1);
});
