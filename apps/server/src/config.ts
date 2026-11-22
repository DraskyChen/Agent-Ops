import type { PoolConfig } from "pg";

import type { HumanRole } from "@agent-ops/contracts";

const DEFAULT_DATABASE_URL =
  "postgres://agent_ops:agent_ops_dev@127.0.0.1:5433/agent_ops";

export interface DevAuthConfig {
  subject: string;
  displayName: string;
  email: string | null;
  role: HumanRole;
}

export interface OidcAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  roleClaim: string;
  adminGroups: string[];
  reviewerGroups: string[];
}

export interface ServerConfig {
  host: string;
  port: number;
  database: PoolConfig;
  ingestToken?: string;
  traceMaxLatenessHours: number;
  auth:
    | {
        mode: "dev";
        sessionTtlHours: number;
        dev: DevAuthConfig;
      }
    | {
        mode: "oidc";
        sessionTtlHours: number;
        oidc: OidcAuthConfig;
      };
  content: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    maxBytes: number;
    retentionDays: number;
    datasetRetentionDays: number;
  };
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const port = Number(environment.AGENT_OPS_SERVER_PORT ?? "4318");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("AGENT_OPS_SERVER_PORT must be a valid TCP port");
  }

  const max = Number(environment.DATABASE_POOL_SIZE ?? "10");
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error("DATABASE_POOL_SIZE must be a positive integer");
  }

  const contentMaxBytes = Number(
    environment.S3_CONTENT_MAX_BYTES ?? String(2 * 1024 * 1024),
  );
  if (!Number.isInteger(contentMaxBytes) || contentMaxBytes <= 0) {
    throw new Error("S3_CONTENT_MAX_BYTES must be a positive integer");
  }

  const contentRetentionDays = Number(
    environment.S3_CONTENT_RETENTION_DAYS ?? "30",
  );
  if (!Number.isInteger(contentRetentionDays) || contentRetentionDays <= 0) {
    throw new Error("S3_CONTENT_RETENTION_DAYS must be a positive integer");
  }
  const datasetContentRetentionDays = Number(
    environment.DATASET_CONTENT_RETENTION_DAYS ?? "180",
  );
  if (
    !Number.isInteger(datasetContentRetentionDays) ||
    datasetContentRetentionDays <= 0
  ) {
    throw new Error(
      "DATASET_CONTENT_RETENTION_DAYS must be a positive integer",
    );
  }

  const sessionTtlHours = positiveInteger(
    environment.AGENT_OPS_SESSION_TTL_HOURS ?? "8",
    "AGENT_OPS_SESSION_TTL_HOURS",
  );
  const traceMaxLatenessHours = positiveInteger(
    environment.TRACE_MAX_LATENESS_HOURS ?? "24",
    "TRACE_MAX_LATENESS_HOURS",
  );
  const authMode =
    environment.AGENT_OPS_AUTH_MODE ??
    (environment.NODE_ENV === "production" ? "oidc" : "dev");
  if (authMode !== "dev" && authMode !== "oidc") {
    throw new Error("AGENT_OPS_AUTH_MODE must be dev or oidc");
  }
  if (authMode === "dev" && environment.NODE_ENV === "production") {
    throw new Error("AGENT_OPS_AUTH_MODE=dev is not allowed in production");
  }

  return {
    host: environment.AGENT_OPS_SERVER_HOST ?? "127.0.0.1",
    port,
    database: {
      connectionString: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
      max,
    },
    ...(environment.AGENT_OPS_INGEST_TOKEN === undefined
      ? {}
      : { ingestToken: environment.AGENT_OPS_INGEST_TOKEN }),
    traceMaxLatenessHours,
    auth:
      authMode === "dev"
        ? {
            mode: "dev",
            sessionTtlHours,
            dev: {
              subject:
                environment.AGENT_OPS_DEV_SUBJECT ?? "local-developer",
              displayName:
                environment.AGENT_OPS_DEV_NAME ?? "Local Developer",
              email: optionalText(
                environment.AGENT_OPS_DEV_EMAIL ?? "developer@example.com",
              ),
              role: parseRole(environment.AGENT_OPS_DEV_ROLE ?? "admin"),
            },
          }
        : {
            mode: "oidc",
            sessionTtlHours,
            oidc: {
              issuer: required(environment.OIDC_ISSUER, "OIDC_ISSUER"),
              clientId: required(environment.OIDC_CLIENT_ID, "OIDC_CLIENT_ID"),
              clientSecret: required(
                environment.OIDC_CLIENT_SECRET,
                "OIDC_CLIENT_SECRET",
              ),
              redirectUri: required(
                environment.OIDC_REDIRECT_URI,
                "OIDC_REDIRECT_URI",
              ),
              scopes: environment.OIDC_SCOPES ?? "openid profile email groups",
              roleClaim: environment.OIDC_ROLE_CLAIM ?? "groups",
              adminGroups: groupList(
                environment.OIDC_ADMIN_GROUPS ?? "agent-ops-admins",
              ),
              reviewerGroups: groupList(
                environment.OIDC_REVIEWER_GROUPS ?? "agent-ops-reviewers",
              ),
            },
          },
    content: {
      endpoint: environment.S3_ENDPOINT ?? "http://127.0.0.1:9000",
      region: environment.S3_REGION ?? "us-east-1",
      bucket: environment.S3_BUCKET ?? "agent-ops-content",
      accessKey: environment.S3_ACCESS_KEY ?? "agent_ops",
      secretKey: environment.S3_SECRET_KEY ?? "agent_ops_dev_secret",
      maxBytes: contentMaxBytes,
      retentionDays: contentRetentionDays,
      datasetRetentionDays: datasetContentRetentionDays,
    },
  };
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required when AGENT_OPS_AUTH_MODE=oidc`);
  }
  return value.trim();
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function parseRole(value: string): HumanRole {
  if (value !== "viewer" && value !== "reviewer" && value !== "admin") {
    throw new Error("AGENT_OPS_DEV_ROLE must be viewer, reviewer, or admin");
  }
  return value;
}

function groupList(value: string): string[] {
  return value
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group !== "");
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
