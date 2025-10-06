const { Pool } = require("pg");
let _pool = null;
function getPool() {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
    application_name: "apgms-node",
  });
  return _pool;
}
module.exports = { getPool };
