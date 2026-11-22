import { Client } from "minio";

import type { MinioContentConfig } from "../../config.js";

export interface ObjectTextWriter {
  putText(objectKey: string, text: string, mediaType: string): Promise<void>;
}

export function createObjectTextWriter(
  config: MinioContentConfig,
): ObjectTextWriter {
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
  let bucketReady: Promise<void> | undefined;

  return {
    async putText(objectKey, text, mediaType) {
      await ensureBucket();
      const body = Buffer.from(text, "utf8");
      await client.putObject(config.bucket, objectKey, body, body.byteLength, {
        "Content-Type": mediaType,
        "Content-Disposition": `inline; filename="${objectKey.split("/").at(-1) ?? "judge.json"}"`,
      });
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
