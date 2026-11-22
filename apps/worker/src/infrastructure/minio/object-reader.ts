import { Client } from "minio";

import type { MinioContentConfig } from "../../config.js";

export interface ObjectTextReader {
  readText(objectKey: string): Promise<string>;
}

export function createObjectTextReader(
  config: MinioContentConfig,
  maxBytes = 2 * 1024 * 1024,
): ObjectTextReader {
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
    async readText(objectKey) {
      const stream = await client.getObject(config.bucket, objectKey);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxBytes) {
          stream.destroy();
          throw new Error(`Content object exceeds ${maxBytes} bytes`);
        }
        chunks.push(buffer);
      }
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
