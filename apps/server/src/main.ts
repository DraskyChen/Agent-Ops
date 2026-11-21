import { buildApp } from "./app.js";
import { createServerDependencies } from "./composition.js";
import { loadServerConfig } from "./config.js";
import { createPool } from "./db/pool.js";

const config = loadServerConfig();
const pool = createPool(config.database);
const app = buildApp({
  dependencies: await createServerDependencies({
    pool,
    auth: config.auth,
    traceMaxLatenessHours: config.traceMaxLatenessHours,
    ...(config.ingestToken === undefined
      ? {}
      : { ingestToken: config.ingestToken }),
    content: config.content,
  }),
  logger: true,
  secureCookies: process.env.NODE_ENV === "production",
});

const close = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Shutting down Agent Ops server");
  await app.close();
  await pool.end();
  process.exitCode = 0;
};

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exitCode = 1;
}

