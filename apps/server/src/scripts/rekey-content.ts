import { Client } from "minio";

import { contentFileExtension } from "../application/content.js";
import { loadServerConfig } from "../config.js";
import { createPool } from "../db/pool.js";

interface ContentRow {
  content_id: string;
  object_key: string;
  media_type: string;
}

const config = loadServerConfig();
const pool = createPool(config.database);
const endpoint = new URL(config.content.endpoint);
const client = new Client({
  endPoint: endpoint.hostname,
  port:
    endpoint.port === ""
      ? endpoint.protocol === "https:"
        ? 443
        : 80
      : Number(endpoint.port),
  useSSL: endpoint.protocol === "https:",
  accessKey: config.content.accessKey,
  secretKey: config.content.secretKey,
  region: config.content.region,
  pathStyle: true,
});

try {
  if (!(await client.bucketExists(config.content.bucket))) {
    throw new Error(`Bucket ${config.content.bucket} does not exist`);
  }

  const result = await pool.query<ContentRow>(
    `select content_id, object_key, media_type
     from content_objects
     where object_key !~ '\\.[a-z0-9]+$'
     order by created_at`,
  );

  let migrated = 0;
  for (const row of result.rows) {
    const newKey = `${row.object_key}.${contentFileExtension(row.media_type)}`;
    const stream = await client.getObject(
      config.content.bucket,
      row.object_key,
    );
    const body = await streamToBuffer(stream);
    await client.putObject(
      config.content.bucket,
      newKey,
      body,
      body.byteLength,
      {
        "Content-Type": row.media_type,
        "Content-Disposition": `inline; filename="${newKey.split("/").at(-1) ?? "content"}"`,
      },
    );
    await pool.query(
      "update content_objects set object_key = $2 where content_id = $1",
      [row.content_id, newKey],
    );
    await client.removeObject(config.content.bucket, row.object_key);
    migrated += 1;
  }

  process.stdout.write(`Rekeyed ${migrated} content object(s).\n`);
} finally {
  await pool.end();
}

async function streamToBuffer(
  stream: NodeJS.ReadableStream,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

