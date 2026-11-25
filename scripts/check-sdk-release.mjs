import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const typescriptPackage = await readJson(
  "packages/sdk-typescript/package.json",
);
const typescriptVersionSource = await readText(
  "packages/sdk-typescript/src/version.ts",
);
const pythonVersionSource = await readText(
  "packages/sdk-python/src/agent_ops/_version.py",
);
const pythonProject = await readText("packages/sdk-python/pyproject.toml");
const contractsSource = await readText("packages/contracts/src/generated.ts");
const sdkContractsSource = await readText(
  "packages/sdk-typescript/src/generated.ts",
);

assertEqual(typescriptPackage.name, "agent-ops-otel-sdk", "TypeScript package name");
assertEqual(typescriptPackage.private, undefined, "TypeScript private flag");
assertEqual(
  typescriptPackage.license,
  "Apache-2.0",
  "TypeScript license",
);
assertEqual(
  typescriptPackage.publishConfig?.access,
  "public",
  "TypeScript publish access",
);
assertEqual(
  typescriptPackage.engines?.node,
  ">=20",
  "TypeScript Node.js support",
);
assertAbsent(
  typescriptPackage.dependencies,
  "workspace:",
  "TypeScript workspace dependency",
);
assertEqual(
  sdkContractsSource,
  contractsSource,
  "TypeScript SDK contract snapshot",
);
assertMatches(
  typescriptVersionSource,
  /new URL\("\.\.\/package\.json", import\.meta\.url\)/,
  "TypeScript SDK_VERSION package metadata source",
);

assertMatches(
  pythonProject,
  /^name = "agent-ops-otel-sdk"$/m,
  "Python package name",
);
assertMatches(pythonProject, /^dynamic = \["version"\]$/m, "Python dynamic version");
assertMatches(
  pythonProject,
  /^version = \{ attr = "agent_ops\._version\.__version__" \}$/m,
  "Python version source",
);
assertMatches(pythonProject, /^readme = "README\.md"$/m, "Python readme");
assertMatches(pythonProject, /^license = "Apache-2\.0"$/m, "Python license");
assertMatches(
  pythonProject,
  /^license-files = \["LICENSE"\]$/m,
  "Python license file",
);

const pythonVersion = pythonVersionSource.match(
  /^__version__ = "([0-9]+\.[0-9]+\.[0-9]+)"$/m,
)?.[1];
if (pythonVersion === undefined) {
  fail("Python __version__ must be a semantic x.y.z version.");
}
assertEqual(
  pythonVersion,
  typescriptPackage.version,
  "synchronized SDK version",
);

const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith("sdk-v")) {
  assertEqual(
    tag,
    `sdk-v${typescriptPackage.version}`,
    "release tag version",
  );
}

process.stdout.write(
  `SDK release metadata passed: agent-ops-otel-sdk ${typescriptPackage.version}.\n`,
);

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function assertAbsent(value, fragment, label) {
  if (JSON.stringify(value ?? {}).includes(fragment)) {
    fail(`${label} must not contain ${fragment}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertMatches(source, pattern, label) {
  if (!pattern.test(source)) {
    fail(`${label} is missing or invalid.`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
