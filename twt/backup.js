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
  ListObjectVersionsCommand,
  GetObjectLockConfigurationCommand,
  PutBucketVersioningCommand,
  PutObjectLockConfigurationCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const env = process.env;
const BACKUP_BUCKET = env.BACKUP_S3_BUCKET || "twt-wiki-backup";
const KEEP_DAYS = 30; // jeden Dump 30 Tage
const KEEP_MONTHLY_DAYS = 365; // Dump vom 1. des Monats ein Jahr
// Object Lock (Compliance): Backups lassen sich so viele Tage lang von niemandem
// löschen, auch nicht mit dem Backup-Schlüssel. Einschalten ist endgültig.
const LOCK_DAYS = Number(env.BACKUP_LOCK_DAYS) || 30;
const LOCK_ON = env.BACKUP_OBJECT_LOCK === "an";

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

async function listVersions(Prefix) {
  const items = [];
  let KeyMarker;
  let VersionIdMarker;
  do {
    const res = await target.send(
      new ListObjectVersionsCommand({
        Bucket: BACKUP_BUCKET,
        Prefix,
        KeyMarker,
        VersionIdMarker,
      })
    );
    for (const v of [...(res.Versions || []), ...(res.DeleteMarkers || [])]) {
      items.push({
        key: v.Key,
        versionId: v.VersionId,
        latest: v.IsLatest,
        modified: new Date(v.LastModified).getTime(),
      });
    }
    KeyMarker = res.IsTruncated ? res.NextKeyMarker : undefined;
    VersionIdMarker = res.IsTruncated ? res.NextVersionIdMarker : undefined;
  } while (KeyMarker);
  return items;
}

async function deleteVersions(list) {
  for (let i = 0; i < list.length; i += 1000) {
    await target.send(
      new DeleteObjectsCommand({
        Bucket: BACKUP_BUCKET,
        Delete: {
          Objects: list.slice(i, i + 1000).map((v) =>
            v.versionId && v.versionId !== "null"
              ? { Key: v.key, VersionId: v.versionId }
              : { Key: v.key }
          ),
        },
      })
    );
  }
}

// Löscht Dumps nach Ablauf ihrer Aufbewahrung und alte Versionen der
// Statusdatei. Gesperrte Versionen werden erst nach Ablauf der Sperre gelöscht.
async function pruneDumps(today) {
  const now = new Date(`${today}T00:00:00Z`).getTime();
  const lockMs = (LOCK_DAYS + 1) * 86400000;
  const dumps = await listVersions("datenbank/");
  const old = dumps.filter((v) => {
    const m = v.key.match(/datenbank\/(\d{4}-\d{2}-(\d{2}))\.pgsql$/);
    if (!m) {
      return false;
    }
    const age = (now - new Date(`${m[1]}T00:00:00Z`).getTime()) / 86400000;
    const limit = m[2] === "01" ? KEEP_MONTHLY_DAYS : KEEP_DAYS;
    return age > Math.max(limit, LOCK_DAYS + 1) && now - v.modified > lockMs;
  });
  const status = (await listVersions("status/")).filter(
    (v) => !v.latest && now - v.modified > lockMs
  );
  await deleteVersions([...old, ...status]);
  return old.length;
}

async function ensureLock() {
  let enabled = false;
  try {
    const res = await target.send(
      new GetObjectLockConfigurationCommand({ Bucket: BACKUP_BUCKET })
    );
    enabled = res.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled";
  } catch (err) {
    enabled = false;
  }
  if (enabled || !LOCK_ON) {
    return enabled;
  }
  await target.send(
    new PutBucketVersioningCommand({
      Bucket: BACKUP_BUCKET,
      VersioningConfiguration: { Status: "Enabled" },
    })
  );
  await target.send(
    new PutObjectLockConfigurationCommand({
      Bucket: BACKUP_BUCKET,
      ObjectLockConfiguration: {
        ObjectLockEnabled: "Enabled",
        Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: LOCK_DAYS } },
      },
    })
  );
  console.log(`[twt/backup] Object Lock eingeschaltet: ${LOCK_DAYS} Tage Compliance.`);
  return true;
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
  const locked = await ensureLock();
  console.log(`[twt/backup] Object Lock: ${locked ? "an" : "aus"}`);

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
    objectLock: locked,
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
