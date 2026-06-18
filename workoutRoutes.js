import { Router } from 'express';
import { query, pool } from './db.js';
import { authRequired } from './authMiddleware.js';

const router = Router();
router.use(authRequired);

async function getWorkoutFull(workoutId) {
  const w = await query('SELECT * FROM workouts WHERE id = $1', [workoutId]);
  if (w.rows.length === 0) return null;
  const workout = w.rows[0];

  const ex = await query(
    'SELECT * FROM exercises WHERE workout_id = $1 ORDER BY order_index, id',
    [workoutId]
  );
  const log = await query('SELECT completed_at FROM workout_logs WHERE workout_id = $1', [workoutId]);

  workout.exercises = ex.rows;
  workout.completed = log.rows.length > 0;
  workout.completed_at = log.rows[0]?.completed_at || null;
  return workout;
}

router.post('/', async (req, res) => {
  if (req.user.role !== 'trainer') {
    return res.status(403).json({ error: 'Apenas o personal pode criar treinos.' });
  }

  const client = await pool.connect();
  try {
    const { student_id, title, description, scheduled_date, exercises } = req.body;
    if (!student_id || !title) {
      return res.status(400).json({ error: 'Aluno e titulo sao obrigatorios.' });
    }

    const owns = await client.query(
      'SELECT id FROM users WHERE id = $1 AND trainer_id = $2',
      [student_id, req.user.id]
    );
    if (owns.rows.length === 0) {
      return res.status(404).json({ error: 'Aluno nao encontrado.' });
    }

    await client.query('BEGIN');
    const wResult = await client.query(
      `INSERT INTO workouts (trainer_id, student_id, title, description, scheduled_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, student_id, title, description || null, scheduled_date || null]
    );
    const workoutId = wResult.rows[0].id;

    if (Array.isArray(exercises)) {
      for (let i = 0; i < exercises.length; i++) {
        const e = exercises[i];
        if (!e.name) continue;
        await client.query(
          `INSERT INTO exercises
             (workout_id, name, sets, reps, weight, notes, image_url, image_url2, instructions, muscle_group, order_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            workoutId, e.name, e.sets || null, e.reps || null, e.weight || null,
            e.notes || null, e.image_url || null, e.image_url2 || null,
            e.instructions || null, e.muscle_group || null, i,
          ]
        );
      }
    }
    await client.query('COMMIT');

    const full = await getWorkoutFull(workoutId);
    return res.status(201).json({ workout: full });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar treino.' });
  } finally {
    client.release();
  }
});

router.get('/', async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'student') {
      rows = (await query(
        `SELECT w.*,
                (SELECT COUNT(*) FROM workout_logs wl WHERE wl.workout_id = w.id) > 0 AS completed
           FROM workouts w
          WHERE w.student_id = $1
          ORDER BY w.scheduled_date NULLS LAST, w.created_at DESC`,
        [req.user.id]
      )).rows;
    } else {
      const studentFilter = req.query.student_id ? Number(req.query.student_id) : null;
      rows = (await query(
        `SELECT w.*, u.name AS student_name,
                (SELECT COUNT(*) FROM workout_logs wl WHERE wl.workout_id = w.id) > 0 AS completed
           FROM workouts w
           JOIN users u ON u.id = w.student_id
          WHERE w.trainer_id = $1
            AND ($2::int IS NULL OR w.student_id = $2)
          ORDER BY w.scheduled_date NULLS LAST, w.created_at DESC`,
        [req.user.id, studentFilter]
      )).rows;
    }
    return res.json({ workouts: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar treinos.' });
  }
});

router.get('/me/progress', async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Apenas para alunos.' });
    const totals = await query(
      `SELECT
         (SELECT COUNT(*) FROM workouts WHERE student_id = $1)     AS total,
         (SELECT COUNT(*) FROM workout_logs WHERE student_id = $1) AS completed`,
      [req.user.id]
    );
    return res.json({ totals: totals.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar progresso.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const workout = await getWorkoutFull(Number(req.params.id));
    if (!workout) return res.status(404).json({ error: 'Treino nao encontrado.' });

    const allowed =
      (req.user.role === 'student' && workout.student_id === req.user.id) ||
      (req.user.role === 'trainer' && workout.trainer_id === req.user.id);
    if (!allowed) return res.status(403).json({ error: 'Acesso negado.' });

    return res.json({ workout });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar treino.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'trainer') {
      return res.status(403).json({ error: 'Apenas o personal pode excluir treinos.' });
    }
    const result = await query(
      'DELETE FROM workouts WHERE id = $1 AND trainer_id = $2 RETURNING id',
      [Number(req.params.id), req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Treino nao encontrado.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao excluir treino.' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Apenas o aluno pode concluir treinos.' });
    }
    const workoutId = Number(req.params.id);

    const w = await query('SELECT id FROM workouts WHERE id = $1 AND student_id = $2', [workoutId, req.user.id]);
    if (w.rows.length === 0) return res.status(404).json({ error: 'Treino nao encontrado.' });

    await query(
      `INSERT INTO workout_logs (workout_id, student_id, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (workout_id) DO NOTHING`,
      [workoutId, req.user.id, req.body?.note || null]
    );

    return res.json({ ok: true, completed: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao concluir treino.' });
  }
});

router.delete('/:id/complete', async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Apenas o aluno pode alterar isso.' });
    }
    await query('DELETE FROM workout_logs WHERE workout_id = $1 AND student_id = $2', [Number(req.params.id), req.user.id]);
    return res.json({ ok: true, completed: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao desmarcar treino.' });
  }
});

export default router;
