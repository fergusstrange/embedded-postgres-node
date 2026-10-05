import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startPostgres } from 'embedded-postgres-node';
import { options } from './options.mjs';

describe('repository (one database per suite)', () => {
  let database;
  let pool;
  beforeAll(async () => {
    database = await startPostgres(options);
    pool = new pg.Pool({ connectionString: database.connectionUrl });
    await pool.query('CREATE TABLE widgets (id integer PRIMARY KEY)');
  }, 180000);
  afterAll(async () => {
    try { await pool?.end(); }
    finally { await database?.stop(); }
  }, 20000);
  it('queries the database', async () => {
    expect((await pool.query('SELECT 42 AS answer')).rows[0].answer).toBe(42);
  });
});
