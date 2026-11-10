/* eslint-disable no-console */
// TWT: Lädt den Datenbank-Dump zu Scaleway hoch, kopiert neue Anhänge aus dem
// Hetzner-Bucket und räumt alte Dumps auf. Aufruf: node twt/backup.js <dump>
// Liest nur Umgebungsvariablen.
const fs = require("fs");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const env = process.env;
const BACKUP_BUCKET = env.BACKUP_S3_BUCKET || "twt-wiki-backup";
const KEEP_DAYS = 30; // jeden Dump 30 Tage
const KEEP_MONTHLY_DAYS = 365; // Dump vom 1. des Monats ein Jahr

const source = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.AWS_S3_UPLOAD_BUCKET_URL,
  forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

const target = new S3Client({
  region: env.BACKUP_S3_REGION || "fr-par",
  endpoint: env.BACKUP_S3_ENDPOINT || "https://s3.fr-par.scw.cloud",
  credentials: {
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
  },
});

async function listAll(client, Bucket, Prefix) {
  const items = [];
  let ContinuationToken;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken })
    );
    for (const o of res.Contents || []) {
      items.push({ key: o.Key, size: o.Size });
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return items;
}

async function uploadDump(file, day) {
  const Key = `datenbank/${day}.pgsql`;
  await new Upload({
    client: target,
    params: { Bucket: BACKUP_BUCKET, Key, Body: fs.createReadStream(file) },
  }).done();
  return { key: Key, bytes: fs.statSync(file).size };
}

// Kopiert Anhänge, die im Backup fehlen oder eine andere Größe haben.
// Im Wiki gelöschte Anhänge bleiben im Backup erhalten.
async function syncAttachments() {
  const srcBucket = env.AWS_S3_UPLOAD_BUCKET_NAME;
  const [src, dst] = await Promise.all([
    listAll(source, srcBucket),
    listAll(target, BACKUP_BUCKET, "anhaenge/"),
  ]);
  const have = new Map(dst.map((o) => [o.key.slice("anhaenge/".length), o.size]));
  let copied = 0;
  let bytes = 0;
  for (const o of src) {
    if (o.key.endsWith("/") || have.get(o.key) === o.size) {
      continue;
    }
    const obj = await source.send(
      new GetObjectCommand({ Bucket: srcBucket, Key: o.key })
    );
    await new Upload({
      client: target,
      params: {
        Bucket: BACKUP_BUCKET,
        Key: `anhaenge/${o.key}`,
        Body: obj.Body,
        ContentType: obj.ContentType,
      },
    }).done();
    copied += 1;
    bytes += o.size;
  }
  return { total: src.length, copied, bytes };
}

async function pruneDumps(today) {
  const dumps = await listAll(target, BACKUP_BUCKET, "datenbank/");
  const now = new Date(`${today}T00:00:00Z`).getTime();
  const old = dumps.filter((o) => {
    const m = o.key.match(/datenbank\/(\d{4}-\d{2}-(\d{2}))\.pgsql$/);
    if (!m) {
      return false;
    }
    const age = (now - new Date(`${m[1]}T00:00:00Z`).getTime()) / 86400000;
    const limit = m[2] === "01" ? KEEP_MONTHLY_DAYS : KEEP_DAYS;
    return age > limit;
  });
  if (old.length) {
    await target.send(
      new DeleteObjectsCommand({
        Bucket: BACKUP_BUCKET,
        Delete: { Objects: old.map((o) => ({ Key: o.key })) },
      })
    );
  }
  return old.length;
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    throw new Error("Dump-Datei fehlt");
  }
  if (!env.BACKUP_S3_ACCESS_KEY_ID || !env.BACKUP_S3_SECRET_ACCESS_KEY) {
    throw new Error("BACKUP_S3_ACCESS_KEY_ID/BACKUP_S3_SECRET_ACCESS_KEY fehlen");
  }
  const day = new Date().toISOString().slice(0, 10);

  const dump = await uploadDump(file, day);
  console.log(`[twt/backup] Dump hochgeladen: ${dump.key} (${dump.bytes} Bytes)`);

  const att = await syncAttachments();
  console.log(
    `[twt/backup] Anhänge: ${att.total} insgesamt, ${att.copied} neu kopiert (${att.bytes} Bytes)`
  );

  const pruned = await pruneDumps(day);
  console.log(`[twt/backup] Alte Dumps gelöscht: ${pruned}`);

  const status = {
    zeit: new Date().toISOString(),
    dump: dump.key,
    dumpBytes: dump.bytes,
    anhaengeGesamt: att.total,
    anhaengeNeu: att.copied,
  };
  await target.send(
    new PutObjectCommand({
      Bucket: BACKUP_BUCKET,
      Key: "status/letztes-backup.json",
      Body: JSON.stringify(status, null, 2),
      ContentType: "application/json",
    })
  );
  console.log("[twt/backup] Fertig.");
}

main().catch((err) => {
  console.error("[twt/backup] Fehler:", err.message);
  process.exit(1);
});
