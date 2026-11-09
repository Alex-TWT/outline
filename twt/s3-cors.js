/* eslint-disable no-console */
// TWT: Setzt die CORS-Regel des Anhang-Buckets, damit Browser Dateien direkt
// hochladen dürfen (Outline nutzt vorsignierte Uploads). Läuft nach jedem
// Deploy (Procfile: postdeploy) und ist idempotent. Liest nur Umgebungsvariablen.
const { S3Client, PutBucketCorsCommand } = require("@aws-sdk/client-s3");

const {
  URL: appUrl,
  FILE_STORAGE,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  AWS_S3_UPLOAD_BUCKET_URL,
  AWS_S3_UPLOAD_BUCKET_NAME,
  AWS_S3_FORCE_PATH_STYLE,
} = process.env;

async function main() {
  if (FILE_STORAGE && FILE_STORAGE !== "s3") {
    console.log("[twt/s3-cors] FILE_STORAGE ist nicht s3, übersprungen.");
    return;
  }
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_S3_UPLOAD_BUCKET_NAME) {
    console.log("[twt/s3-cors] S3-Zugangsdaten fehlen noch, übersprungen.");
    return;
  }

  const origin = new URL(appUrl).origin;
  const client = new S3Client({
    region: AWS_REGION,
    endpoint: AWS_S3_UPLOAD_BUCKET_URL,
    forcePathStyle: AWS_S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });

  await client.send(
    new PutBucketCorsCommand({
      Bucket: AWS_S3_UPLOAD_BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [origin],
            AllowedMethods: ["GET", "HEAD", "PUT", "POST"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    })
  );
  console.log(`[twt/s3-cors] CORS für ${AWS_S3_UPLOAD_BUCKET_NAME} gesetzt: ${origin}`);
}

main().catch((err) => {
  console.error("[twt/s3-cors] Fehler:", err.message);
  process.exit(1);
});
