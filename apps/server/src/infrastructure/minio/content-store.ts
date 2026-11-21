import type { Readable } from "node:stream";

import { Client } from "minio";

import type { ContentBlobStore } from "../../application/content.js";

export interface MinioContentStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export function createMinioContentStore(
  config: MinioContentStoreConfig,
): ContentBlobStore {
  const url = new URL(config.endpoint);
  const client = new Client({
    endPoint: url.hostname,
    port: url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port),
    useSSL: url.protocol === "https:",
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    pathStyle: true,
  });
  let bucketReady: Promise<void> | undefined;

  return {
    async put(objectKey, mediaType, body) {
      await ensureBucket();
      await client.putObject(
        config.bucket,
        objectKey,
        Buffer.from(body),
        body.byteLength,
        {
          "Content-Type": mediaType,
          "Content-Disposition": `inline; filename="${objectKey.split("/").at(-1) ?? "content"}"`,
        },
      );
    },

    async get(objectKey): Promise<Readable> {
      await ensureBucket();
      return client.getObject(config.bucket, objectKey);
    },

    async delete(objectKey) {
      await ensureBucket();
      await client.removeObject(config.bucket, objectKey);
    },
  };

  function ensureBucket(): Promise<void> {
    bucketReady ??= (async () => {
      if (!(await client.bucketExists(config.bucket))) {
        await client.makeBucket(config.bucket, config.region);
      }
    })();
    return bucketReady;
  }
}

