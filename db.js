import pg from 'pg';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'node:async_hooks';

dotenv.config();

const { Pool } = pg;

const useSSL = process.env.DATABASE_SSL === 'true';
const ssl = useSSL ? { rejectUnauthorized: false } : false;

// Se PGHOST estiver definido, usa campos separados (senha isolada, sem URL-encoding).
// Caso contrario, cai no DATABASE_URL (compatibilidade).
let config;
if (process.env.PGHOST) {
  config = {
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'postgres',
    ssl,
  };
} else {
  config = {
    connectionString: process.env.DATABASE_URL,
    ssl,
  };
}

export const pool = new Pool(config);

// Contexto de tenant por request (multi-tenant): guarda o personal_id atual.
export const tenantStore = new AsyncLocalStorage();

// Query padrão. Se houver tenant no contexto, roda numa transação curta que
// seta app.personal_id (LOCAL) — a RLS do Postgres filtra por tenant sozinha.
// Sem contexto (login, webhook, rotas públicas), roda direto no pool.
export async function query(text, params) {
  const store = tenantStore.getStore();
  const pid = store?.personalId;
  if (pid == null) return pool.query(text, params);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.personal_id', $1, true)", [String(pid)]);
    const r = await client.query(text, params);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
