import { Client } from "minio";

import type { ContentBlobDeleter } from "../../application/content-retention.js";

export interface MinioContentDeleterConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export function createMinioContentDeleter(
  config: MinioContentDeleterConfig,
): ContentBlobDeleter {
  const url = new URL(config.endpoint);
  const client = new Client({
    endPoint: url.hostname,
    port:
      url.port === ""
        ? url.protocol === "https:"
          ? 443
          : 80
        : Number(url.port),
    useSSL: url.protocol === "https:",
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    pathStyle: true,
  });

  return {
    async delete(objectKey) {
      await client.removeObject(config.bucket, objectKey);
    },
  };
}
