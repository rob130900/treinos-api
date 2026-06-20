import { Router } from 'express';
import { query } from './db.js';
import { authRequired } from './authMiddleware.js';

const router = Router();
router.use(authRequired);

async function studentTrainerId(studentId) {
  const r = await query('SELECT trainer_id FROM users WHERE id = $1', [studentId]);
  return r.rows[0]?.trainer_id || null;
}
async function trainerOwns(trainerId, studentId) {
  const r = await query(
    "SELECT id FROM users WHERE id = $1 AND trainer_id = $2 AND role = 'student'",
    [studentId, trainerId]
  );
  return r.rows.length > 0;
}

// Thread completa entre aluno e professor (marca como lida pelo papel atual)
router.get('/thread', async (req, res) => {
  try {
    let trainerId;
    let studentId;
    if (req.user.role === 'student') {
      studentId = req.user.id;
      trainerId = await studentTrainerId(studentId);
      if (!trainerId) return res.json({ messages: [], hasTrainer: false });
    } else {
      studentId = Number(req.query.student_id);
      trainerId = req.user.id;
      if (!(await trainerOwns(trainerId, studentId))) return res.status(404).json({ error: 'Aluno nao encontrado.' });
    }

    const msgs = (await query(
      'SELECT * FROM messages WHERE trainer_id = $1 AND student_id = $2 ORDER BY created_at',
      [trainerId, studentId]
    )).rows;

    if (req.user.role === 'student') {
      await query(
        "UPDATE messages SET read_by_student = TRUE WHERE student_id = $1 AND sender_role = 'trainer' AND read_by_student = FALSE",
        [studentId]
      );
    } else {
      await query(
        "UPDATE messages SET read_by_trainer = TRUE WHERE trainer_id = $1 AND student_id = $2 AND sender_role = 'student' AND read_by_trainer = FALSE",
        [trainerId, studentId]
      );
    }

    return res.json({ messages: msgs, hasTrainer: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro ao carregar mensagens.' });
  }
});

// Lista de conversas (professor): aluno + ultima mensagem + nao lidas
router.get('/conversations', async (req, res) => {
  try {
    if (req.user.role !== 'trainer') return res.status(403).json({ error: 'Apenas professor.' });
    const rows = (await query(
      `SELECT u.id AS student_id, u.name AS student_name,
              (SELECT body FROM messages m WHERE m.trainer_id = $1 AND m.student_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM messages m WHERE m.trainer_id = $1 AND m.student_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM messages m WHERE m.trainer_id = $1 AND m.student_id = u.id AND m.sender_role = 'student' AND m.read_by_trainer = FALSE) AS unread
         FROM users u
        WHERE u.trainer_id = $1 AND u.role = 'student'
        ORDER BY last_at DESC NULLS LAST, u.name`,
      [req.user.id]
    )).rows;
    return res.json({ conversations: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro ao carregar conversas.' });
  }
});

// Contagem de nao lidas (badge)
router.get('/unread', async (req, res) => {
  try {
    if (req.user.role === 'student') {
      const r = (await query(
        "SELECT COUNT(*) AS c FROM messages WHERE student_id = $1 AND sender_role = 'trainer' AND read_by_student = FALSE",
        [req.user.id]
      )).rows[0];
      return res.json({ unread: Number(r.c) });
    }
    const r = (await query(
      "SELECT COUNT(*) AS c FROM messages WHERE trainer_id = $1 AND sender_role = 'student' AND read_by_trainer = FALSE",
      [req.user.id]
    )).rows[0];
    return res.json({ unread: Number(r.c) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro.' });
  }
});

// Enviar mensagem
router.post('/', async (req, res) => {
  try {
    const { body, kind, exercise_name, workout_id } = req.body;
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'Mensagem vazia.' });

    let trainerId;
    let studentId;
    let senderRole;
    let finalKind;

    if (req.user.role === 'student') {
      studentId = req.user.id;
      trainerId = await studentTrainerId(studentId);
      if (!trainerId) return res.status(400).json({ error: 'Voce ainda nao tem um personal vinculado.' });
      senderRole = 'student';
      finalKind = exercise_name || kind === 'duvida' ? 'duvida' : 'chat';
    } else {
      studentId = Number(req.body.student_id);
      trainerId = req.user.id;
      if (!(await trainerOwns(trainerId, studentId))) return res.status(404).json({ error: 'Aluno nao encontrado.' });
      senderRole = 'trainer';
      finalKind = kind === 'feedback' ? 'feedback' : 'chat';
    }

    const r = (await query(
      `INSERT INTO messages
         (trainer_id, student_id, sender_role, kind, exercise_name, workout_id, body, read_by_trainer, read_by_student)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        trainerId, studentId, senderRole, finalKind,
        exercise_name || null, workout_id || null, String(body).trim(),
        senderRole === 'trainer', senderRole === 'student',
      ]
    )).rows[0];

    return res.status(201).json({ message: r });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro ao enviar mensagem.' });
  }
});

export default router;
