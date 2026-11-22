import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = resolve(
  process.env.ENV_FILE ?? resolve(root, ".env.production"),
);

let source;
try {
  source = await readFile(envFile, "utf8");
} catch {
  fail(`Production environment file not found: ${envFile}`);
}

if (/replace-with|id\.example\.com|agent-ops\.example\.com/.test(source)) {
  fail("Production environment still contains example placeholders.");
}

const values = new Map();
for (const rawLine of source.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) {
    continue;
  }
  const separator = line.indexOf("=");
  if (separator <= 0) {
    fail(`Invalid environment line: ${line}`);
  }
  const key = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  values.set(key, value);
}

for (const key of [
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "AGENT_OPS_INGEST_TOKEN",
]) {
  if ((values.get(key) ?? "").trim() === "") {
    fail(`${key} is required`);
  }
}

minimumLength(values, "POSTGRES_PASSWORD", 16);
minimumLength(values, "S3_SECRET_KEY", 16);
minimumLength(values, "AGENT_OPS_INGEST_TOKEN", 32);
if (
  values.get("EVALUATION_JUDGE_ENABLED") === "true" &&
  (values.get("DEEPSEEK_API_KEY") ?? "").trim() === ""
) {
  fail("DEEPSEEK_API_KEY is required when EVALUATION_JUDGE_ENABLED=true");
}

const result = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    envFile,
    "-f",
    resolve(root, "infra/docker-compose/compose.production.yaml"),
    "config",
    "--quiet",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.stdout.write("Production configuration passed validation.\n");

function minimumLength(map, key, length) {
  const value = map.get(key) ?? "";
  if (value.length < length) {
    fail(`${key} must be at least ${length} characters`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
