// Minimal forward-only migration runner.
//
// Applied files are recorded in schema_migrations so re-runs are no-ops.
// Each file runs inside a transaction: a failed migration leaves no partial DDL.
//
// Run with Node's native type stripping:
//   npm run migrate
//
// ponytail: no down/rollback migrations and no checksum drift detection.
// Add a `--down` path and per-file hashes when a second environment needs to
// reverse a release, not while schema changes are still additive.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set<string>(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (row) => row.name,
    ),
  );
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? 'no pending migrations' : `${count} migration(s) applied`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
