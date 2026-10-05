const { startPostgres } = require('embedded-postgres-node');
const { Pool } = require('pg');

describe('repository (one database per suite)', () => {
  let database;
  let pool;
  beforeAll(async () => {
    database = await startPostgres({
      ...(process.env.EP_TEST_BINARIES ? { binaries: process.env.EP_TEST_BINARIES } : {}),
      ...(process.env.EP_TEST_VERSION ? { postgresVersion: process.env.EP_TEST_VERSION } : {}),
    });
    pool = new Pool({ connectionString: database.connectionUrl });
    await pool.query('CREATE TABLE widgets (id integer PRIMARY KEY)');
  }, 180000);
  afterAll(async () => {
    try { await pool?.end(); }
    finally { await database?.stop(); }
  }, 20000);
  test('queries the database', async () => {
    expect((await pool.query('SELECT 42 AS answer')).rows[0].answer).toBe(42);
  });
});
