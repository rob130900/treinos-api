import { Router } from 'express';
import { query } from './db.js';
import { authRequired } from './authMiddleware.js';
import { PLANS, PLAN_ORDER, planKey } from './plans.js';

const router = Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role !== 'trainer') return res.status(403).json({ error: 'Apenas professor.' });
  next();
});

async function studentCount(trainerId) {
  const r = await query("SELECT COUNT(*) AS c FROM users WHERE trainer_id = $1 AND role = 'student'", [trainerId]);
  return Number(r.rows[0].c);
}

// Plano atual + uso + catálogo + info do trial
router.get('/', async (req, res) => {
  try {
    const row = (await query('SELECT plan, trial_ends_at FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const key = planKey(row.plan);
    const used = await studentCount(req.user.id);
    const isTrial = key === 'trial';
    let daysLeft = null;
    if (isTrial && row.trial_ends_at) {
      daysLeft = Math.max(0, Math.ceil((new Date(row.trial_ends_at).getTime() - Date.now()) / 86400000));
    }
    return res.json({
      current: key,
      used,
      limit: PLANS[key].limit,
      plan: PLANS[key],
      isTrial,
      trialEndsAt: row.trial_ends_at || null,
      daysLeft,
      plans: PLAN_ORDER.map((k) => PLANS[k]),
    });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao carregar plano.' }); }
});

// Upgrade / troca de plano (libera o limite na hora).
// Pagamento via Asaas será acoplado aqui depois.
router.post('/upgrade', async (req, res) => {
  try {
    const key = req.body?.plan;
    if (!PLANS[key]) return res.status(400).json({ error: 'Plano inválido.' });
    await query('UPDATE users SET plan = $1 WHERE id = $2', [key, req.user.id]);
    const used = await studentCount(req.user.id);
    return res.json({ current: key, used, limit: PLANS[key].limit, plan: PLANS[key] });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao trocar de plano.' }); }
});

export default router;
