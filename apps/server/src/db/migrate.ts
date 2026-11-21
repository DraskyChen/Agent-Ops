import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadServerConfig } from "../config.js";
import { createPool } from "./pool.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

async function migrate(): Promise<void> {
  const config = loadServerConfig();
  const pool = createPool(config.database);
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();
    const applied = await client.query<{ filename: string }>(
      "select filename from schema_migrations",
    );
    const appliedFiles = new Set(applied.rows.map((row) => row.filename));

    for (const filename of files) {
      if (appliedFiles.has(filename)) {
        continue;
      }

      const sql = await readFile(`${migrationsDirectory}/${filename}`, "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (filename) values ($1)",
          [filename],
        );
        await client.query("commit");
        process.stdout.write(`Applied migration ${filename}\n`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

await migrate();

