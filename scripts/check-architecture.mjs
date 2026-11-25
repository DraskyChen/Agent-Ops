import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const violations = [];
const sourceExtensions = new Set([".ts", ".tsx"]);

const files = [
  ...(await walk(path.join(root, "apps"))),
  ...(await walk(path.join(root, "packages"))),
].filter((file) => sourceExtensions.has(path.extname(file)));

for (const file of files) {
  const relativeFile = normalize(path.relative(root, file));
  const source = await readFile(file, "utf8");
  const imports = parseImports(source);

  if (relativeFile === "apps/server/src/app.ts") {
    forbidImports(relativeFile, source, imports, [
      [/^\.\/(db|infrastructure|ingest|otlp)\//, "app.ts may only compose HTTP infrastructure"],
    ]);
  }

  if (relativeFile.startsWith("apps/server/src/http/")) {
    forbidImports(relativeFile, source, imports, [
      [/^\.\.\/(db|infrastructure|ingest|otlp)\//, "HTTP code must use application ports"],
      [/^\.\.\/\.\.\/(db|infrastructure|ingest|otlp)\//, "HTTP code must use application ports"],
    ]);
  }

  if (relativeFile.startsWith("apps/server/src/application/")) {
    forbidImports(relativeFile, source, imports, [
      [/^\.\.\/(http|infrastructure|db|ingest|otlp)\//, "application code must not import adapters"],
      [/^(fastify|pg|protobufjs)$/, "application code must not depend on infrastructure libraries"],
    ]);
  }

  if (relativeFile.startsWith("apps/server/src/infrastructure/")) {
    forbidImports(relativeFile, source, imports, [
      [/^\.\.\/(app|http)\//, "infrastructure must not depend on HTTP delivery"],
      [/^\.\.\/composition\.js$/, "infrastructure must not depend on composition"],
    ]);
  }

  if (relativeFile.startsWith("apps/web/src/features/")) {
    forbidImports(relativeFile, source, imports, [
      [/^\.\.\/(Console|Landing|api|mockTraces)\.js$/, "features must not depend on app-shell files"],
      [/^\.\.\/\.\.\/(Console|Landing|api|mockTraces)\.js$/, "features must not depend on app-shell files"],
    ]);
  }

  if (relativeFile.startsWith("apps/web/src/shared/")) {
    forbidImports(relativeFile, source, imports, [
      [/^\.\.\/(Console|Landing)\.js$/, "shared code must not depend on the app shell"],
      [/^\.\.\/features\//, "shared code must not depend on a feature"],
    ]);
  }

  if (relativeFile.startsWith("apps/web/src/") && /\b(MockTrace|MockSpan|mockTraces)\b/.test(source)) {
    fail(relativeFile, 1, "production web code must not use mock model names or fixtures");
  }

  if (relativeFile.startsWith("apps/worker/src/domain/")) {
    forbidImports(relativeFile, source, imports, [
      [/^(pg|fastify)$/, "worker domain code must stay framework-free"],
      [/^\.\.\/(application|infrastructure)\//, "worker domain code must not import outer layers"],
    ]);
  }

  if (relativeFile.startsWith("apps/worker/src/application/")) {
    forbidImports(relativeFile, source, imports, [
      [/^(pg|fastify)$/, "worker application code must depend on ports, not adapters"],
      [/^\.\.\/infrastructure\//, "worker application code must not import adapters"],
    ]);
  }

  if (relativeFile === "apps/worker/src/main.ts" && /\b(select|insert|update|delete)\b/i.test(source)) {
    fail(relativeFile, 1, "worker main.ts must only compose and run the application worker");
  }

  if (
    relativeFile.startsWith("packages/contracts/src/") &&
    imports.some(
      (specifier) =>
        specifier.startsWith("../../apps/") ||
        specifier === "agent-ops-otel-sdk",
    )
  ) {
    fail(relativeFile, 1, "contracts must not depend on apps or SDK packages");
  }
}

for (const duplicate of [
  "TraceDetail",
  "TraceListItem",
  "TraceListQuery",
  "TraceListResponse",
  "TraceSpan",
]) {
  const definition = new RegExp(
    `^\\s*(?:export\\s+)?(?:interface|type)\\s+${duplicate}\\b`,
    "m",
  );
  for (const file of files) {
    const relativeFile = normalize(path.relative(root, file));
    if (
      !relativeFile.startsWith("packages/contracts/") &&
      definition.test(stripImportStatements(await readFile(file, "utf8")))
    ) {
      fail(
        relativeFile,
        1,
        `API contract ${duplicate} must be defined in packages/contracts`,
      );
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    process.stderr.write(
      `${violation.file}:${violation.line} ${violation.message}\n`,
    );
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Architecture check passed for ${files.length} TypeScript files.\n`,
  );
}

function forbidImports(file, source, imports, rules) {
  for (const specifier of imports) {
    for (const [pattern, message] of rules) {
      if (pattern.test(specifier)) {
        fail(file, lineOf(source, specifier), `${message}: ${specifier}`);
      }
    }
  }
}

function parseImports(source) {
  const imports = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) {
        imports.push(match[1]);
      }
    }
  }
  return imports;
}

function stripImportStatements(source) {
  return source.replace(
    /^import[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm,
    "",
  );
}

function lineOf(source, fragment) {
  const index = source.indexOf(fragment);
  return index === -1 ? 1 : source.slice(0, index).split("\n").length;
}

function fail(file, line, message) {
  violations.push({ file, line, message });
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function normalize(value) {
  return value.split(path.sep).join("/");
}
