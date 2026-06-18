import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Aplicando schema.sql...');
  await pool.query(sql);
  console.log('Banco criado/atualizado com sucesso.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Erro na migracao:', err);
  process.exit(1);
});
