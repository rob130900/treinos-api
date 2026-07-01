import { Router } from 'express';
import { query } from './db.js';
import { authRequired } from './authMiddleware.js';

const router = Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role !== 'trainer') return res.status(403).json({ error: 'Apenas professor.' });
  next();
});

async function ownsStudent(trainerId, studentId) {
  const r = await query(
    "SELECT id FROM users WHERE id = $1 AND trainer_id = $2 AND role = 'student'",
    [studentId, trainerId]
  );
  return r.rows.length > 0;
}

// Resumo financeiro do mês
router.get('/summary', async (req, res) => {
  try {
    const tid = req.user.id;
    const faturadoMes = (await query(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM payments
        WHERE trainer_id = $1 AND paid_on IS NOT NULL
          AND date_trunc('month', paid_on) = date_trunc('month', CURRENT_DATE)`, [tid]
    )).rows[0].v;
    const aReceber = (await query(
      'SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE trainer_id = $1 AND paid_on IS NULL', [tid]
    )).rows[0].v;
    const vencidos = (await query(
      `SELECT p.id, p.amount, p.due_date, u.name AS student_name
         FROM payments p JOIN users u ON u.id = p.student_id
        WHERE p.trainer_id = $1 AND p.paid_on IS NULL AND p.due_date < CURRENT_DATE
        ORDER BY p.due_date`, [tid]
    )).rows;
    const vencidoTotal = vencidos.reduce((s, p) => s + Number(p.amount), 0);
    return res.json({
      faturadoMes: Number(faturadoMes),
      aReceber: Number(aReceber),
      vencidos,
      vencidoTotal,
    });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro no resumo financeiro.' }); }
});

// Listar pagamentos (todos do professor ou de um aluno)
router.get('/', async (req, res) => {
  try {
    const params = [req.user.id];
    let sql = `SELECT p.*, u.name AS student_name FROM payments p
               JOIN users u ON u.id = p.student_id WHERE p.trainer_id = $1`;
    if (req.query.student_id) { params.push(Number(req.query.student_id)); sql += ` AND p.student_id = $2`; }
    sql += ' ORDER BY COALESCE(p.due_date, p.created_at) DESC, p.id DESC';
    const rows = (await query(sql, params)).rows;
    return res.json({ payments: rows });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao listar pagamentos.' }); }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const sid = Number(b.student_id);
    if (!sid || !(await ownsStudent(req.user.id, sid))) return res.status(404).json({ error: 'Aluno não encontrado.' });
    if (b.amount == null || b.amount === '') return res.status(400).json({ error: 'Valor obrigatório.' });
    const r = (await query(
      `INSERT INTO payments (student_id, trainer_id, amount, due_date, paid_on, method, notes, personal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $2) RETURNING *`,
      [sid, req.user.id, Number(b.amount), b.due_date || null, b.paid_on || null, b.method || null, b.notes || null]
    )).rows[0];
    return res.status(201).json({ payment: r });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao salvar pagamento.' }); }
});

router.patch('/:id/pay', async (req, res) => {
  try {
    const r = (await query(
      'UPDATE payments SET paid_on = COALESCE($3, CURRENT_DATE) WHERE id = $1 AND trainer_id = $2 RETURNING *',
      [Number(req.params.id), req.user.id, req.body?.paid_on || null]
    )).rows[0];
    if (!r) return res.status(404).json({ error: 'Pagamento não encontrado.' });
    return res.json({ payment: r });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao baixar pagamento.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM payments WHERE id = $1 AND trainer_id = $2', [Number(req.params.id), req.user.id]);
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao excluir.' }); }
});

export default router;
