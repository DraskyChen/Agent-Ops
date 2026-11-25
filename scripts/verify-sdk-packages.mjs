import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const typescriptPackageDir = path.join(root, "packages/sdk-typescript");
const pythonPackageDir = path.join(root, "packages/sdk-python");
const artifactsDir = path.join(root, "artifacts/sdk");
const npmArtifactsDir = path.join(artifactsDir, "npm");
const pythonArtifactsDir = path.join(artifactsDir, "python");
const tempRoot = await mkdtemp(path.join(tmpdir(), "agent-ops-sdk-verify-"));
const commandEnvironment = {
  ...process.env,
  npm_config_cache: path.join(tempRoot, "npm-cache"),
  npm_config_loglevel: "error",
  npm_config_userconfig: path.join(tempRoot, "npmrc"),
  UV_CACHE_DIR: path.join(tempRoot, "uv-cache"),
};

try {
  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(npmArtifactsDir, { recursive: true });
  await mkdir(pythonArtifactsDir, { recursive: true });

  run("pnpm", ["sdk:check"], { env: commandEnvironment });
  run("pnpm", ["contracts:build"], { env: commandEnvironment });
  run(
    "pnpm",
    ["--filter", "agent-ops-sdk", "build"],
    { env: commandEnvironment },
  );

  run(
    "npm",
    ["pack", "--pack-destination", npmArtifactsDir],
    { cwd: typescriptPackageDir, env: commandEnvironment },
  );
  const npmArchive = await onlyFile(npmArtifactsDir, ".tgz");
  await verifyNpmArchive(npmArchive);
  await smokeTypeScript(npmArchive, tempRoot, commandEnvironment);

  run(
    "uv",
    ["build", "--project", pythonPackageDir, "--out-dir", pythonArtifactsDir],
    { env: commandEnvironment },
  );
  const wheel = await onlyFile(pythonArtifactsDir, ".whl");
  const sourceArchive = await onlyFile(pythonArtifactsDir, ".tar.gz");
  await verifyPythonArtifacts(wheel, sourceArchive);
  await smokePython(wheel, tempRoot, commandEnvironment);

  const version = JSON.parse(
    await readFile(path.join(typescriptPackageDir, "package.json"), "utf8"),
  ).version;
  const releaseFiles = [npmArchive, wheel, sourceArchive];
  const checksums = [];
  for (const file of releaseFiles) {
    checksums.push(
      `${createHash("sha256").update(await readFile(file)).digest("hex")}  ` +
        path.basename(file),
    );
  }
  await writeFile(
    path.join(artifactsDir, "SHA256SUMS"),
    `${checksums.join("\n")}\n`,
  );

  process.stdout.write(
    `SDK ${version} packages verified in ${artifactsDir}.\n`,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function verifyNpmArchive(archive) {
  const packageJsonSource = command(
    "tar",
    ["-xOf", archive, "package/package.json"],
    {},
  );
  const packageJson = JSON.parse(packageJsonSource);
  assertEqual(packageJson.name, "agent-ops-sdk", "npm package name");
  assertEqual(packageJson.private, undefined, "npm private flag");
  assertEqual(packageJson.license, "Apache-2.0", "npm license");
  if (JSON.stringify(packageJson.dependencies ?? {}).includes("workspace:")) {
    throw new Error("npm package still contains a workspace dependency");
  }

  const files = command("tar", ["-tf", archive], {}).split("\n");
  for (const required of [
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
  ]) {
    if (!files.includes(required)) {
      throw new Error(`npm package is missing ${required}`);
    }
  }
  process.stdout.write("npm package contents passed.\n");
}

async function verifyPythonArtifacts(wheel, sourceArchive) {
  const wheelFiles = command("unzip", ["-Z1", wheel], {}).split("\n");
  const metadataPath = wheelFiles.find((file) =>
    /agent_ops_sdk-[^/]+\.dist-info\/METADATA$/.test(file),
  );
  if (metadataPath === undefined) {
    throw new Error("Python wheel is missing package metadata");
  }
  const metadata = command("unzip", ["-p", wheel, metadataPath], {});
  assertIncludes(metadata, "\nName: agent-ops-sdk\n", "Python package name");
  assertIncludes(
    metadata,
    "\nLicense-File: LICENSE\n",
    "Python wheel license",
  );
  assertIncludes(
    metadata,
    "\nLicense-Expression: Apache-2.0\n",
    "Python license expression",
  );
  assertIncludes(
    metadata,
    "\nRequires-Python: >=3.11\n",
    "Python minimum version",
  );

  for (const required of [
    "agent_ops/py.typed",
    "agent_ops/_version.py",
  ]) {
    if (!wheelFiles.includes(required)) {
      throw new Error(`Python wheel is missing ${required}`);
    }
  }
  const sourceFiles = command("tar", ["-tzf", sourceArchive], {}).split("\n");
  if (
    !sourceFiles.some((file) =>
      /^agent_ops_sdk-[^/]+\/LICENSE$/.test(file),
    )
  ) {
    throw new Error("Python source distribution is missing LICENSE");
  }
  process.stdout.write("Python package contents passed.\n");
}

async function smokeTypeScript(archive, tempRoot, environment) {
  const directory = await mkdtemp(path.join(tempRoot, "typescript-"));
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  run(
    "npm",
    ["install", "--ignore-scripts", archive],
    { cwd: directory, env: environment },
  );
  const smokeScript = path.join(
    root,
    "scripts/sdk-smoke/typescript.mjs",
  );
  await copyFile(smokeScript, path.join(directory, "smoke.mjs"));
  run("node", ["smoke.mjs", "success"], {
    cwd: directory,
    env: environment,
  });
  run("node", ["smoke.mjs", "failure"], {
    cwd: directory,
    env: environment,
  });
}

async function smokePython(wheel, tempRoot, environment) {
  const directory = await mkdtemp(path.join(tempRoot, "python-"));
  const venv = path.join(directory, ".venv");
  run("uv", ["venv", "--python", "3.12", venv], { env: environment });
  const python = path.join(venv, "bin/python");
  run(
    "uv",
    ["pip", "install", "--python", python, wheel],
    { env: environment },
  );
  const smokeScript = path.join(root, "scripts/sdk-smoke/python.py");
  await copyFile(smokeScript, path.join(directory, "smoke.py"));
  run(python, ["smoke.py", "success"], {
    cwd: directory,
    env: environment,
  });
  run(python, ["smoke.py", "failure"], {
    cwd: directory,
    env: environment,
  });
}

async function onlyFile(directory, suffix) {
  const matches = (await readdir(directory)).filter((file) =>
    file.endsWith(suffix),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${suffix} file in ${directory}, found ${matches.length}`,
    );
  }
  return path.join(directory, matches[0]);
}

function run(commandName, args, options) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  if (result.stdout !== "") {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== "") {
    process.stderr.write(result.stderr);
  }
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${commandName} ${args.join(" ")} failed with ${String(result.status)}`,
    );
  }
}

function command(commandName, args, options) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${commandName} ${args.join(" ")} failed: ${result.stderr}`,
    );
  }
  return result.stdout;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error(`${label} is missing ${JSON.stringify(fragment)}`);
  }
}
