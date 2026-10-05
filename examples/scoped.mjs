import assert from 'node:assert/strict';
import pg from 'pg';
import { startPostgres, withPostgres } from 'embedded-postgres-node';
import { options } from './options.mjs';

// Explicit ownership works in every supported Node version.
const database = await startPostgres(options);
try {
  const client = new pg.Client({ connectionString: database.connectionUrl });
  try {
    await client.connect();
    assert.equal((await client.query('SELECT 42 AS answer')).rows[0].answer, 42);
  } finally { await client.end(); }
} finally { await database.stop(); }

// Return values and errors pass through; PostgreSQL is always stopped.
await withPostgres(options, async database => {
  const pool = new pg.Pool({ connectionString: database.connectionUrl });
  try { assert.equal((await pool.query('SELECT 7 AS answer')).rows[0].answer, 7); }
  finally { await pool.end(); }
});
