/* eslint-disable no-console */
// TWT: Hilfsskript für den Wiederherstellungstest. Lädt den neuesten
// Datenbank-Dump aus dem Scaleway-Backup nach <dir> und vergleicht eine
// Anhang-Kopie Byte für Byte mit dem Original bei Hetzner.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const env = process.env;
const BUCKET = env.BACKUP_S3_BUCKET || "twt-wiki-backup";
const target = new S3Client({
  region: env.BACKUP_S3_REGION || "fr-par",
  endpoint: env.BACKUP_S3_ENDPOINT || "https://s3.fr-par.scw.cloud",
  credentials: {
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
  },
});
const source = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.AWS_S3_UPLOAD_BUCKET_URL,
  forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

async function list(client, Bucket, Prefix) {
  const res = await client.send(new ListObjectsV2Command({ Bucket, Prefix }));
  return res.Contents || [];
}

async function sha(client, Bucket, Key) {
  const obj = await client.send(new GetObjectCommand({ Bucket, Key }));
  const buf = Buffer.from(await obj.Body.transformToByteArray());
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const dir = process.argv[2];
  const dumps = (await list(target, BUCKET, "datenbank/")).sort((a, b) =>
    a.Key < b.Key ? 1 : -1
  );
  if (!dumps.length) {
    throw new Error("kein Dump im Backup");
  }
  const latest = dumps[0];
  const file = path.join(dir, "dump.pgsql");
  const obj = await target.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: latest.Key })
  );
  fs.writeFileSync(file, Buffer.from(await obj.Body.transformToByteArray()));
  fs.writeFileSync(path.join(dir, "dump-path"), file);
  console.log(
    `[twt/restore-test] Dump geladen: ${latest.Key} (${latest.Size} Bytes, ${latest.LastModified.toISOString()})`
  );

  const copies = await list(target, BUCKET, "anhaenge/");
  if (!copies.length) {
    console.log("[twt/restore-test] Keine Anhänge im Backup.");
    return;
  }
  const sample = copies[Math.floor(Math.random() * copies.length)];
  const key = sample.Key.slice("anhaenge/".length);
  const [a, b] = await Promise.all([
    sha(target, BUCKET, sample.Key),
    sha(source, env.AWS_S3_UPLOAD_BUCKET_NAME, key),
  ]);
  if (a !== b) {
    throw new Error(`Anhang-Kopie weicht ab: ${key}`);
  }
  console.log(
    `[twt/restore-test] Anhang-Stichprobe identisch (SHA-256): ${key} (${copies.length} Anhänge im Backup)`
  );
}

main().catch((err) => {
  console.error("[twt/restore-test] Fehler:", err.message);
  process.exit(1);
});
