import assert from 'node:assert/strict';
import pg from 'pg';
import { withPostgres } from 'embedded-postgres-node';
import { options } from './options.mjs';

// Your driver and migration framework are application dependencies.
await withPostgres(options, async database => {
  const pool = new pg.Pool({ connectionString: database.connectionUrl });
  try {
    // Replace this with your framework's awaited migration hook.
    await pool.query('CREATE TABLE accounts (id integer PRIMARY KEY, name text NOT NULL)');
    await pool.query('INSERT INTO accounts VALUES ($1, $2)', [1, 'Ada']);
    assert.equal((await pool.query('SELECT name FROM accounts WHERE id = 1')).rows[0].name, 'Ada');
    // Extension libraries must already exist in the selected distribution.
    // await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  } finally { await pool.end(); }
});
