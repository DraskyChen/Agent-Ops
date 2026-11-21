import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import type { ServerDependencies } from "./application/dependencies.js";
import { registerHealthRoute } from "./http/routes/health.js";
import { registerContentRoutes } from "./http/routes/content.js";
import { registerOtlpIngestRoute } from "./http/routes/ingest.js";
import { registerTraceRoutes } from "./http/routes/traces.js";

export interface BuildAppOptions {
  dependencies: ServerDependencies;
  logger?: FastifyServerOptions["logger"];
  bodyLimit?: number;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? 4 * 1024 * 1024,
  });

  registerProtobufParsers(app);
  registerHealthRoute(app, options.dependencies.healthCheck);
  registerTraceRoutes(app, options.dependencies.traces);
  registerContentRoutes(
    app,
    options.dependencies.content,
    options.dependencies.authorizeIngest,
  );
  registerOtlpIngestRoute(
    app,
    options.dependencies.ingest,
    options.dependencies.authorizeIngest,
  );

  return app;
}

function registerProtobufParsers(app: FastifyInstance): void {
  for (const contentType of [
    "application/x-protobuf",
    "application/protobuf",
  ]) {
    app.addContentTypeParser(
      contentType,
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, Buffer.from(body));
      },
    );
  }
}

