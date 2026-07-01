import { Router } from 'express';
import { query, pool } from './db.js';
import { authRequired } from './authMiddleware.js';
import { requireAccess } from './access.js';

const router = Router();
router.use(authRequired);
// Bloqueia acesso aos treinos para alunos sem assinatura/trial. Personal passa livre.
router.use(requireAccess());

const TZ = 'America/Sao_Paulo';

async function getWorkoutFull(workoutId) {
  const w = await query('SELECT * FROM workouts WHERE id = $1', [workoutId]);
  if (w.rows.length === 0) return null;
  const workout = w.rows[0];

  const ex = await query(
    `SELECT e.*, (el.id IS NOT NULL) AS completed
       FROM exercises e
       LEFT JOIN exercise_logs el ON el.exercise_id = e.id
      WHERE e.workout_id = $1
      ORDER BY e.order_index, e.id`,
    [workoutId]
  );
  const log = await query('SELECT completed_at, duration_seconds FROM workout_logs WHERE workout_id = $1', [workoutId]);

  workout.exercises = ex.rows;
  workout.completed = log.rows.length > 0;
  workout.completed_at = log.rows[0]?.completed_at || null;
  workout.duration_seconds = log.rows[0]?.duration_seconds || null;
  return workout;
}

router.post('/', requireAccess(), async (req, res) => {
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
      `INSERT INTO workouts (trainer_id, student_id, title, description, scheduled_date, personal_id)
       VALUES ($1, $2, $3, $4, $5, $1) RETURNING id`,
      [req.user.id, student_id, title, description || null, scheduled_date || null]
    );
    const workoutId = wResult.rows[0].id;

    if (Array.isArray(exercises)) {
      for (let i = 0; i < exercises.length; i++) {
        const e = exercises[i];
        if (!e.name) continue;
        await client.query(
          `INSERT INTO exercises
             (workout_id, name, sets, reps, weight, notes, image_url, image_url2, video_id, instructions, muscle_group, rest_seconds, order_index, video_data, personal_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            workoutId, e.name, e.sets || null, e.reps || null, e.weight || null,
            e.notes || null, e.image_url || null, e.image_url2 || null,
            e.video_id || null, e.instructions || null, e.muscle_group || null,
            e.rest_seconds != null ? Number(e.rest_seconds) : 60, i, e.video_data || null, req.user.id,
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

// Duplicar treino (professor) — copia treino + exercicios
router.post('/:id/duplicate', requireAccess(), async (req, res) => {
  if (req.user.role !== 'trainer') return res.status(403).json({ error: 'Apenas o personal.' });
  const client = await pool.connect();
  try {
    const srcId = Number(req.params.id);
    const src = await client.query('SELECT * FROM workouts WHERE id = $1 AND trainer_id = $2', [srcId, req.user.id]);
    if (!src.rows.length) return res.status(404).json({ error: 'Treino nao encontrado.' });
    const w = src.rows[0];
    const targetStudent = req.body?.student_id ? Number(req.body.student_id) : w.student_id;
    const owns = await client.query('SELECT id FROM users WHERE id = $1 AND trainer_id = $2', [targetStudent, req.user.id]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Aluno nao encontrado.' });

    await client.query('BEGIN');
    const nw = await client.query(
      `INSERT INTO workouts (trainer_id, student_id, title, description, scheduled_date, personal_id)
       VALUES ($1, $2, $3, $4, NULL, $1) RETURNING id`,
      [req.user.id, targetStudent, `${w.title} (cópia)`, w.description]
    );
    const newId = nw.rows[0].id;
    await client.query(
      `INSERT INTO exercises
         (workout_id, name, sets, reps, weight, notes, image_url, image_url2, video_id, instructions, muscle_group, rest_seconds, order_index, video_data, personal_id)
       SELECT $1, name, sets, reps, weight, notes, image_url, image_url2, video_id, instructions, muscle_group, rest_seconds, order_index, video_data, $3
         FROM exercises WHERE workout_id = $2`,
      [newId, srcId, req.user.id]
    );
    await client.query('COMMIT');
    const full = await getWorkoutFull(newId);
    return res.status(201).json({ workout: full });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Erro ao duplicar treino.' });
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
                (SELECT COUNT(*) FROM workout_logs wl WHERE wl.workout_id = w.id) > 0 AS completed,
                (SELECT wl.completed_at FROM workout_logs wl WHERE wl.workout_id = w.id) AS completed_at,
                (SELECT wl.duration_seconds FROM workout_logs wl WHERE wl.workout_id = w.id) AS duration_seconds,
                (SELECT COUNT(*) FROM exercises e WHERE e.workout_id = w.id) AS exercise_count
           FROM workouts w
          WHERE w.student_id = $1
          ORDER BY w.scheduled_date NULLS LAST, w.created_at DESC`,
        [req.user.id]
      )).rows;
    } else {
      const studentFilter = req.query.student_id ? Number(req.query.student_id) : null;
      rows = (await query(
        `SELECT w.*, u.name AS student_name,
                (SELECT COUNT(*) FROM workout_logs wl WHERE wl.workout_id = w.id) > 0 AS completed,
                (SELECT COUNT(*) FROM exercises e WHERE e.workout_id = w.id) AS exercise_count
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

// Dashboard do aluno: semana, streak, ultimo treino, proximo treino
router.get('/me/dashboard', async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Apenas para alunos.' });
    const uid = req.user.id;

    const totals = (await query(
      `SELECT
         (SELECT COUNT(*) FROM workouts WHERE student_id = $1)     AS total,
         (SELECT COUNT(*) FROM workout_logs WHERE student_id = $1) AS completed`,
      [uid]
    )).rows[0];

    const week = (await query(
      `SELECT COUNT(*) AS c FROM workout_logs
        WHERE student_id = $1
          AND date_trunc('week', completed_at AT TIME ZONE $2)
            = date_trunc('week', NOW() AT TIME ZONE $2)`,
      [uid, TZ]
    )).rows[0];

    const days = (await query(
      `SELECT DISTINCT to_char((completed_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS d
         FROM workout_logs WHERE student_id = $1
        ORDER BY d DESC`,
      [uid, TZ]
    )).rows.map((r) => r.d);

    const last = (await query(
      `SELECT w.id, w.title, wl.completed_at, wl.duration_seconds
         FROM workout_logs wl JOIN workouts w ON w.id = wl.workout_id
        WHERE wl.student_id = $1
        ORDER BY wl.completed_at DESC LIMIT 1`,
      [uid]
    )).rows[0] || null;

    const next = (await query(
      `SELECT w.id, w.title, w.scheduled_date,
              (SELECT COUNT(*) FROM exercises e WHERE e.workout_id = w.id) AS exercise_count
         FROM workouts w
        WHERE w.student_id = $1
          AND NOT EXISTS (SELECT 1 FROM workout_logs wl WHERE wl.workout_id = w.id)
        ORDER BY w.scheduled_date NULLS LAST, w.created_at
        LIMIT 1`,
      [uid]
    )).rows[0] || null;

    // streak: dias consecutivos terminando hoje ou ontem
    const set = new Set(days);
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const prev = (s) => {
      const dt = new Date(s + 'T00:00:00Z');
      dt.setUTCDate(dt.getUTCDate() - 1);
      return dt.toISOString().slice(0, 10);
    };
    let streak = 0;
    let cursor = todayStr;
    if (!set.has(cursor)) cursor = prev(cursor);
    while (set.has(cursor)) { streak++; cursor = prev(cursor); }

    const total = Number(totals.total);
    const weeklyGoal = Math.min(Math.max(total, 1), 7);

    return res.json({
      totals: { total, completed: Number(totals.completed) },
      week: { completed: Number(week.c), goal: weeklyGoal },
      streak,
      lastWorkout: last,
      nextWorkout: next,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao carregar painel.' });
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

// Editar treino completo (personal): dados + lista de exercícios (substitui)
router.put('/:id', requireAccess(), async (req, res) => {
  if (req.user.role !== 'trainer') return res.status(403).json({ error: 'Apenas o personal pode editar treinos.' });
  const client = await pool.connect();
  try {
    const workoutId = Number(req.params.id);
    const { title, description, scheduled_date, exercises } = req.body || {};

    const owns = await client.query('SELECT id FROM workouts WHERE id = $1 AND trainer_id = $2', [workoutId, req.user.id]);
    if (!owns.rows.length) { client.release(); return res.status(404).json({ error: 'Treino nao encontrado.' }); }
    if (!title) { client.release(); return res.status(400).json({ error: 'Título é obrigatório.' }); }

    await client.query('BEGIN');
    await client.query(
      'UPDATE workouts SET title = $1, description = $2, scheduled_date = $3 WHERE id = $4',
      [title, description || null, scheduled_date || null, workoutId]
    );
    // Substitui os exercícios pela nova lista (cobre editar/reordenar/adicionar/remover)
    await client.query('DELETE FROM exercises WHERE workout_id = $1', [workoutId]);
    if (Array.isArray(exercises)) {
      for (let i = 0; i < exercises.length; i++) {
        const e = exercises[i];
        if (!e.name) continue;
        await client.query(
          `INSERT INTO exercises
             (workout_id, name, sets, reps, weight, notes, image_url, image_url2, video_id, instructions, muscle_group, rest_seconds, order_index, video_data, personal_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            workoutId, e.name, e.sets || null, e.reps || null, e.weight || null,
            e.notes || null, e.image_url || null, e.image_url2 || null,
            e.video_id || null, e.instructions || null, e.muscle_group || null,
            e.rest_seconds != null ? Number(e.rest_seconds) : 60, i, e.video_data || null, req.user.id,
          ]
        );
      }
    }
    await client.query('COMMIT');
    const full = await getWorkoutFull(workoutId);
    return res.json({ workout: full });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Erro ao editar treino.' });
  } finally {
    client.release();
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

// ---- Conclusao por exercicio (treino guiado) ----
async function ownsWorkout(workoutId, studentId) {
  const w = await query('SELECT id FROM workouts WHERE id = $1 AND student_id = $2', [workoutId, studentId]);
  return w.rows.length > 0;
}

router.post('/:id/exercises/:exId/complete', async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Apenas o aluno.' });
    const workoutId = Number(req.params.id);
    const exId = Number(req.params.exId);
    if (!(await ownsWorkout(workoutId, req.user.id))) return res.status(404).json({ error: 'Treino nao encontrado.' });

    await query(
      `INSERT INTO exercise_logs (exercise_id, workout_id, student_id, personal_id)
       VALUES ($1, $2, $3, (SELECT personal_id FROM workouts WHERE id = $2))
       ON CONFLICT (exercise_id, student_id) DO NOTHING`,
      [exId, workoutId, req.user.id]
    );
    return res.json({ ok: true, completed: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao concluir exercicio.' });
  }
});

router.delete('/:id/exercises/:exId/complete', async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Apenas o aluno.' });
    await query(
      'DELETE FROM exercise_logs WHERE exercise_id = $1 AND student_id = $2',
      [Number(req.params.exId), req.user.id]
    );
    return res.json({ ok: true, completed: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao desmarcar exercicio.' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Apenas o aluno pode concluir treinos.' });
    }
    const workoutId = Number(req.params.id);
    const b = req.body || {};
    const duration = b.duration_seconds != null ? Number(b.duration_seconds) : null;
    const difficulty = b.difficulty != null ? Number(b.difficulty) : null;
    const pain = b.pain === true || b.pain === 'true';
    const feedback = b.feedback ? String(b.feedback).trim() : null;

    if (!(await ownsWorkout(workoutId, req.user.id))) return res.status(404).json({ error: 'Treino nao encontrado.' });

    await query(
      `INSERT INTO workout_logs (workout_id, student_id, note, duration_seconds, difficulty, pain, feedback, personal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT personal_id FROM workouts WHERE id = $1))
       ON CONFLICT (workout_id) DO UPDATE
         SET completed_at = NOW(),
             duration_seconds = COALESCE(EXCLUDED.duration_seconds, workout_logs.duration_seconds),
             difficulty = COALESCE(EXCLUDED.difficulty, workout_logs.difficulty),
             pain = EXCLUDED.pain,
             feedback = COALESCE(EXCLUDED.feedback, workout_logs.feedback)`,
      [workoutId, req.user.id, b.note || null, duration, difficulty, pain, feedback]
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
    const workoutId = Number(req.params.id);
    await query('DELETE FROM workout_logs WHERE workout_id = $1 AND student_id = $2', [workoutId, req.user.id]);
    await query('DELETE FROM exercise_logs WHERE workout_id = $1 AND student_id = $2', [workoutId, req.user.id]);
    return res.json({ ok: true, completed: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao desmarcar treino.' });
  }
});

export default router;
