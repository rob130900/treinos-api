import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import { authRequired, requireRole } from './authMiddleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
router.use(authRequired, requireRole('trainer'));

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const TABLES = [
  { name: 'users', cols: ['id', 'name', 'email', 'password_hash', 'role', 'trainer_id', 'created_at'] },
  { name: 'workouts', cols: ['id', 'trainer_id', 'student_id', 'title', 'description', 'scheduled_date', 'created_at'] },
  { name: 'exercises', cols: ['id', 'workout_id', 'name', 'sets', 'reps', 'weight', 'notes', 'image_url', 'image_url2', 'video_id', 'instructions', 'muscle_group', 'rest_seconds', 'order_index'] },
  { name: 'workout_logs', cols: ['id', 'workout_id', 'student_id', 'completed_at', 'duration_seconds', 'note'] },
  { name: 'exercise_logs', cols: ['id', 'exercise_id', 'workout_id', 'student_id', 'completed_at'] },
];

// GET /api/export  -> SQL completo (schema + dados) para migrar de banco (ex: Supabase)
router.get('/', async (req, res) => {
  try {
    let out = '-- ============================================================\n';
    out += '-- KIVO — backup completo (schema + dados)\n';
    out += `-- Gerado em ${new Date().toISOString()}\n`;
    out += '-- Cole este script inteiro no SQL Editor do Supabase e clique RUN.\n';
    out += '-- ============================================================\n\n';

    out += fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    out += '\n\n-- ====================== DADOS ======================\n';

    for (const t of TABLES) {
      const r = await query(`SELECT ${t.cols.join(', ')} FROM ${t.name} ORDER BY id`);
      if (r.rows.length === 0) continue;
      out += `\n-- ${t.name} (${r.rows.length} registros)\n`;
      for (const row of r.rows) {
        const vals = t.cols.map((c) => lit(row[c])).join(', ');
        out += `INSERT INTO ${t.name} (${t.cols.join(', ')}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING;\n`;
      }
      out += `SELECT setval(pg_get_serial_sequence('${t.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${t.name}), 1), true);\n`;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kivo-backup.sql"');
    return res.send(out);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao gerar backup.' });
  }
});

export default router;
