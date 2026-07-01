import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { authRequired, requireRole } from './authMiddleware.js';
import { asaasConfigured, ensureCustomer } from './asaas.js';

const router = Router();
router.use(authRequired, requireRole('trainer'));

// Personal é gratuito e ilimitado: cadastra alunos sem limite/bloqueio.
router.post('/', async (req, res) => {
  try {
    const { name, email, password, monthly_fee } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }

    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Este email ja esta cadastrado.' });
    }

    const fee = monthly_fee === '' || monthly_fee == null ? null : Number(monthly_fee);
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, trainer_id, monthly_fee, personal_id)
       VALUES ($1, $2, $3, 'student', $4, $5, $4)
       RETURNING id, name, email, role, trainer_id, monthly_fee, created_at`,
      [name, email.toLowerCase(), hash, req.user.id, fee]
    );
    const student = result.rows[0];

    // Cria o cliente Asaas do aluno (o aluno é quem paga). Não bloqueia se falhar.
    if (asaasConfigured()) {
      try {
        const customerId = await ensureCustomer({ name: student.name, email: student.email });
        await query('UPDATE users SET asaas_customer_id = $1 WHERE id = $2', [customerId, student.id]);
      } catch (e) { console.error('asaas customer (aluno)', e.message); }
    }

    return res.status(201).json({ student });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao cadastrar aluno.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.created_at,
              u.status, u.phone, u.birth_date, u.goal, u.monthly_fee, u.student_notes,
              COUNT(DISTINCT w.id)  AS total_workouts,
              COUNT(DISTINCT wl.id) AS completed_workouts,
              EXISTS (SELECT 1 FROM payments p WHERE p.student_id = u.id
                        AND p.paid_on IS NULL AND p.due_date < CURRENT_DATE) AS overdue
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

// Alertas inteligentes (dor, parou de treinar, pagamento atrasado)
router.get('/alerts', async (req, res) => {
  try {
    const rows = (await query(
      `SELECT u.id, u.name,
              EXISTS (SELECT 1 FROM workout_logs wl
                        WHERE wl.student_id = u.id AND wl.pain = TRUE
                          AND wl.completed_at > NOW() - INTERVAL '14 days') AS pain,
              (SELECT MAX(completed_at) FROM workout_logs wl WHERE wl.student_id = u.id) AS last_workout,
              (SELECT COUNT(*) FROM workouts w WHERE w.student_id = u.id) AS total_workouts,
              (SELECT COUNT(*) FROM payments p WHERE p.student_id = u.id
                        AND p.paid_on IS NULL AND p.due_date < CURRENT_DATE) AS overdue
         FROM users u
        WHERE u.trainer_id = $1 AND u.role = 'student'`,
      [req.user.id]
    )).rows;

    const now = Date.now();
    const alerts = [];
    for (const r of rows) {
      if (r.pain) {
        alerts.push({ student_id: r.id, name: r.name, type: 'dor', text: `${r.name} relatou dor/desconforto em um treino recente.` });
      }
      if (Number(r.overdue) > 0) {
        alerts.push({ student_id: r.id, name: r.name, type: 'pagamento', text: `${r.name} está com pagamento em atraso.` });
      }
      const total = Number(r.total_workouts);
      const last = r.last_workout ? new Date(r.last_workout).getTime() : null;
      const days = last ? Math.floor((now - last) / 86400000) : null;
      if (total > 0 && (last === null || days >= 7)) {
        alerts.push({
          student_id: r.id, name: r.name, type: 'inativo',
          text: last === null
            ? `${r.name} ainda não concluiu nenhum treino.`
            : `${r.name} está há ${days} dias sem treinar.`,
        });
      }
    }
    return res.json({ alerts });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar alertas.' });
  }
});

// Atualizar ficha / status do aluno
router.patch('/:id', async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    const owns = await query(
      "SELECT id FROM users WHERE id = $1 AND trainer_id = $2 AND role = 'student'",
      [studentId, req.user.id]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Aluno não encontrado.' });

    const b = req.body || {};
    const allowed = ['status', 'phone', 'birth_date', 'goal', 'monthly_fee', 'student_notes', 'name'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of allowed) {
      if (b[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(b[f] === '' ? null : b[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
    vals.push(studentId, req.user.id);
    const r = (await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i++} AND trainer_id = $${i}
       RETURNING id, name, email, status, phone, birth_date, goal, monthly_fee, student_notes`,
      vals
    )).rows[0];
    return res.json({ student: r });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar ficha.' });
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
