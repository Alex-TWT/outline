/* eslint-disable no-console */
// TWT: Schickt einmal im Monat eine Testmail über denselben SMTP-Zugang wie
// Outline (cron.json). Die monatliche Update-Routine prüft im Postfach, ob sie
// angekommen ist. Fehlt sie, ist meist das Google-App-Passwort ungültig
// (z. B. nach einer Passwortänderung). Liest nur Umgebungsvariablen.
const nodemailer = require("nodemailer");

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_NAME,
  SMTP_USERNAME,
  SMTP_PASSWORD,
  SMTP_FROM_EMAIL,
  SMTP_REPLY_EMAIL,
} = process.env;

async function main() {
  const to = SMTP_REPLY_EMAIL || SMTP_USERNAME;
  if (!SMTP_HOST || !to) {
    console.log("[twt/mail-check] SMTP nicht konfiguriert, übersprungen.");
    return;
  }

  const transport = nodemailer.createTransport({
    name: SMTP_NAME,
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: SMTP_SECURE === "true",
    auth: SMTP_USERNAME ? { user: SMTP_USERNAME, pass: SMTP_PASSWORD } : undefined,
  });

  const month = new Date().toISOString().slice(0, 7);
  await transport.sendMail({
    from: SMTP_FROM_EMAIL,
    to,
    subject: `TWT Wiki Mailtest ${month}`,
    text:
      "Automatische Testmail des TWT Wiki. Kommt sie an, funktioniert der " +
      "Mailversand (Einladungen, Anmeldelinks). Kein Handlungsbedarf.",
  });
  console.log(`[twt/mail-check] Testmail ${month} an ${to} verschickt.`);
}

main().catch((err) => {
  console.error("[twt/mail-check] Fehler:", err.message);
  process.exit(1);
});
