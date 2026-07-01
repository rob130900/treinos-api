import { Router } from 'express';
import { query } from './db.js';
import { authRequired } from './authMiddleware.js';
import { requireAccess } from './access.js';

const router = Router();
router.use(authRequired);
router.use(requireAccess());

// Resolve qual aluno a operação atinge (aluno = ele mesmo; professor = aluno dele)
async function resolveStudent(req) {
  if (req.user.role === 'student') return req.user.id;
  const sid = Number(req.query.student_id || req.body.student_id);
  if (!sid) return null;
  const r = await query(
    "SELECT id FROM users WHERE id = $1 AND trainer_id = $2 AND role = 'student'",
    [sid, req.user.id]
  );
  return r.rows.length ? sid : null;
}

const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

// ---------- MEDIDAS ----------
router.get('/measurements', async (req, res) => {
  try {
    const sid = await resolveStudent(req);
    if (!sid) return res.status(403).json({ error: 'Sem acesso.' });
    const rows = (await query(
      'SELECT * FROM measurements WHERE student_id = $1 ORDER BY measured_on, id',
      [sid]
    )).rows;
    return res.json({ measurements: rows });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao carregar medidas.' }); }
});

router.post('/measurements', async (req, res) => {
  try {
    const sid = await resolveStudent(req);
    if (!sid) return res.status(403).json({ error: 'Sem acesso.' });
    const b = req.body || {};
    const r = (await query(
      `INSERT INTO measurements
         (student_id, measured_on, weight, body_fat, chest, waist, hip, arm, thigh, notes, personal_id)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, (SELECT trainer_id FROM users WHERE id = $1)) RETURNING *`,
      [sid, b.measured_on || null, num(b.weight), num(b.body_fat), num(b.chest),
        num(b.waist), num(b.hip), num(b.arm), num(b.thigh), b.notes || null]
    )).rows[0];
    return res.status(201).json({ measurement: r });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao salvar medidas.' }); }
});

router.delete('/measurements/:id', async (req, res) => {
  try {
    const sid = await resolveStudent(req);
    if (!sid) return res.status(403).json({ error: 'Sem acesso.' });
    await query('DELETE FROM measurements WHERE id = $1 AND student_id = $2', [Number(req.params.id), sid]);
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao excluir.' }); }
});

// ---------- FOTOS ----------
router.get('/photos', async (req, res) => {
  try {
    const sid = await resolveStudent(req);
    if (!sid) return res.status(403).json({ error: 'Sem acesso.' });
    const rows = (await query(
      'SELECT * FROM progress_photos WHERE student_id = $1 ORDER BY taken_on, id',
      [sid]
    )).rows;
    return res.json({ photos: rows });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao carregar fotos.' }); }
});

router.post('/photos', async (req, res) => {
  try {
    const sid = await resolveStudent(req);
    if (!sid) return res.status(403).json({ error: 'Sem acesso.' });
    const b = req.body || {};
    if (!b.image_data) return res.status(400).json({ error: 'Imagem ausente.' });
    const r = (await query(
      `INSERT INTO progress_photos (student_id, taken_on, label, image_data, notes, personal_id)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, (SELECT trainer_id FROM users WHERE id = $1)) RETURNING *`,
      [sid, b.taken_on || null, b.label || null, b.image_data, b.notes || null]
    )).rows[0];
    return res.status(201).json({ photo: r });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao salvar foto.' }); }
});

router.delete('/photos/:id', async (req, res) => {
  try {
    const sid = await resolveStudent(req);
    if (!sid) return res.status(403).json({ error: 'Sem acesso.' });
    await query('DELETE FROM progress_photos WHERE id = $1 AND student_id = $2', [Number(req.params.id), sid]);
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao excluir.' }); }
});

export default router;
