import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { authRequired, requireRole } from './authMiddleware.js';

const router = Router();
router.use(authRequired, requireRole('trainer'));

router.post('/', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }

    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Este email ja esta cadastrado.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, trainer_id)
       VALUES ($1, $2, $3, 'student', $4)
       RETURNING id, name, email, role, trainer_id, created_at`,
      [name, email.toLowerCase(), hash, req.user.id]
    );

    return res.status(201).json({ student: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao cadastrar aluno.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.created_at,
              COUNT(DISTINCT w.id)  AS total_workouts,
              COUNT(DISTINCT wl.id) AS completed_workouts
         FROM users u
         LEFT JOIN workouts w      ON w.student_id = u.id
         LEFT JOIN workout_logs wl ON wl.student_id = u.id
        WHERE u.trainer_id = $1 AND u.role = 'student'
        GROUP BY u.id
        ORDER BY u.name`,
      [req.user.id]
    );
    return res.json({ students: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar alunos.' });
  }
});

router.get('/:id/progress', async (req, res) => {
  try {
    const studentId = Number(req.params.id);

    const owns = await query(
      'SELECT id, name FROM users WHERE id = $1 AND trainer_id = $2',
      [studentId, req.user.id]
    );
    if (owns.rows.length === 0) return res.status(404).json({ error: 'Aluno nao encontrado.' });

    const totals = await query(
      `SELECT
         (SELECT COUNT(*) FROM workouts WHERE student_id = $1)     AS total,
         (SELECT COUNT(*) FROM workout_logs WHERE student_id = $1) AS completed`,
      [studentId]
    );

    const history = await query(
      `SELECT w.id, w.title, wl.completed_at
         FROM workout_logs wl
         JOIN workouts w ON w.id = wl.workout_id
        WHERE wl.student_id = $1
        ORDER BY wl.completed_at DESC
        LIMIT 30`,
      [studentId]
    );

    return res.json({ student: owns.rows[0], totals: totals.rows[0], history: history.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar progresso.' });
  }
});

export default router;
