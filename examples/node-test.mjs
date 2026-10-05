import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startPostgres } from 'embedded-postgres-node';
import { options } from './options.mjs';

describe('repository (one database per suite)', () => {
  let database;
  let pool;
  before(async () => {
    database = await startPostgres(options);
    pool = new pg.Pool({ connectionString: database.connectionUrl });
    await pool.query('CREATE TABLE widgets (id integer PRIMARY KEY)');
  }, { timeout: 180000 });
  after(async () => {
    try { await pool?.end(); }
    finally { await database?.stop(); }
  });
  it('queries the database', async () => {
    assert.equal((await pool.query('SELECT 42 AS answer')).rows[0].answer, 42);
  });
});
