import pg from 'pg';
import dotenv from 'dotenv';

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

export const query = (text, params) => pool.query(text, params);
