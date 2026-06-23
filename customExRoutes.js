import { Router } from 'express';
import { query } from './db.js';
import { authRequired, requireRole } from './authMiddleware.js';

const router = Router();
router.use(authRequired, requireRole('trainer'));

// Lista os exercícios personalizados do personal
router.get('/', async (req, res) => {
  try {
    const rows = (await query(
      'SELECT * FROM custom_exercises WHERE trainer_id = $1 ORDER BY name',
      [req.user.id]
    )).rows;
    return res.json({ exercises: rows });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao listar exercícios.' }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, muscle_group, notes, video_data } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do exercício é obrigatório.' });
    const r = (await query(
      `INSERT INTO custom_exercises (trainer_id, name, description, muscle_group, notes, video_data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, name.trim(), description || null, muscle_group || null, notes || null, video_data || null]
    )).rows[0];
    return res.status(201).json({ exercise: r });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao salvar exercício.' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, muscle_group, notes, video_data } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do exercício é obrigatório.' });
    // mantém o vídeo atual se não vier um novo
    const r = (await query(
      `UPDATE custom_exercises
          SET name = $1, description = $2, muscle_group = $3, notes = $4,
              video_data = COALESCE($5, video_data)
        WHERE id = $6 AND trainer_id = $7 RETURNING *`,
      [name.trim(), description || null, muscle_group || null, notes || null, video_data || null, Number(req.params.id), req.user.id]
    )).rows[0];
    if (!r) return res.status(404).json({ error: 'Exercício não encontrado.' });
    return res.json({ exercise: r });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao editar exercício.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM custom_exercises WHERE id = $1 AND trainer_id = $2', [Number(req.params.id), req.user.id]);
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao excluir.' }); }
});

export default router;
