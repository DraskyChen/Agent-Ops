import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import cookie from "@fastify/cookie";

import type { ServerDependencies } from "./application/dependencies.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerHealthRoute } from "./http/routes/health.js";
import { registerContentRoutes } from "./http/routes/content.js";
import { registerCandidateRoutes } from "./http/routes/candidates.js";
import { registerDatasetRoutes } from "./http/routes/datasets.js";
import { registerEvaluationRoutes } from "./http/routes/evaluations.js";
import { registerFeedbackRoute } from "./http/routes/feedback.js";
import { registerOtlpIngestRoute } from "./http/routes/ingest.js";
import { registerMetricsRoutes } from "./http/routes/metrics.js";
import { registerOperationsRoute } from "./http/routes/operations.js";
import { registerPromptRoutes } from "./http/routes/prompts.js";
import { registerReviewRoute } from "./http/routes/reviews.js";
import { registerTraceRoutes } from "./http/routes/traces.js";

export interface BuildAppOptions {
  dependencies: ServerDependencies;
  logger?: FastifyServerOptions["logger"];
  bodyLimit?: number;
  secureCookies?: boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? 4 * 1024 * 1024,
  });

  void app.register(cookie);
  registerProtobufParsers(app);
  registerHealthRoute(app, options.dependencies.healthCheck);
  registerAuthRoutes(app, options.dependencies.humanAuth, {
    secureCookies: options.secureCookies ?? false,
  });
  registerTraceRoutes(
    app,
    options.dependencies.traces,
    options.dependencies.humanAuth,
  );
  registerContentRoutes(
    app,
    options.dependencies.content,
    options.dependencies.authorizeIngest,
    options.dependencies.humanAuth,
  );
  registerCandidateRoutes(
    app,
    options.dependencies.candidates,
    options.dependencies.humanAuth,
  );
  registerDatasetRoutes(
    app,
    options.dependencies.datasets,
    options.dependencies.humanAuth,
  );
  registerEvaluationRoutes(
    app,
    options.dependencies.evaluations,
    options.dependencies.humanAuth,
  );
  registerFeedbackRoute(
    app,
    options.dependencies.feedback,
    options.dependencies.authorizeIngest,
  );
  registerReviewRoute(
    app,
    options.dependencies.reviews,
    options.dependencies.humanAuth,
  );
  registerMetricsRoutes(
    app,
    options.dependencies.metrics,
    options.dependencies.humanAuth,
  );
  registerOperationsRoute(
    app,
    options.dependencies.operations,
    options.dependencies.humanAuth,
  );
  registerPromptRoutes(
    app,
    options.dependencies.prompts,
    options.dependencies.humanAuth,
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

