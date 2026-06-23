import { Router } from 'express';
import { query } from './db.js';
import { authRequired } from './authMiddleware.js';
import { PLANS, PLAN_ORDER, planKey } from './plans.js';
import { asaasConfigured, ensureCustomer, createCharge, getPix, cancelCharge } from './asaas.js';
import { accessState } from './access.js';

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

// Plano atual + uso + catálogo + trial + status de pagamento
router.get('/', async (req, res) => {
  try {
    const row = (await query(
      'SELECT plan, trial_ends_at, plan_status, pending_plan, payment_link FROM users WHERE id = $1',
      [req.user.id]
    )).rows[0] || {};
    const key = planKey(row.plan);
    const used = await studentCount(req.user.id);
    const isTrial = key === 'trial';
    let daysLeft = null;
    if (isTrial && row.trial_ends_at) {
      daysLeft = Math.max(0, Math.ceil((new Date(row.trial_ends_at).getTime() - Date.now()) / 86400000));
    }
    const access = await accessState(req.user.id);
    return res.json({
      blocked: access.blocked,
      accessReason: access.reason,
      current: key,
      used,
      limit: PLANS[key].limit,
      plan: PLANS[key],
      isTrial,
      trialEndsAt: row.trial_ends_at || null,
      daysLeft,
      planStatus: row.plan_status || 'trial',
      pendingPlan: row.pending_plan || null,
      paymentLink: row.payment_link || null,
      asaas: asaasConfigured(),
      plans: PLAN_ORDER.map((k) => PLANS[k]),
    });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao carregar plano.' }); }
});

// Gera a cobrança do plano (PIX / boleto / cartão via página do Asaas).
// Sem chave do Asaas configurada -> modo teste (ativa na hora).
router.post('/checkout', async (req, res) => {
  try {
    const { plan, billingType, cpfCnpj } = req.body || {};
    if (!PLANS[plan] || plan === 'trial') return res.status(400).json({ error: 'Plano inválido.' });

    if (!asaasConfigured()) {
      await query(
        "UPDATE users SET plan = $1, plan_status = 'active', pending_plan = NULL, payment_link = NULL WHERE id = $2",
        [plan, req.user.id]
      );
      return res.json({ mode: 'test', current: plan, plan: PLANS[plan] });
    }

    const u = (await query('SELECT name, email, asaas_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0];
    const customer = await ensureCustomer({ id: u.asaas_customer_id, name: u.name, email: u.email, cpfCnpj });
    if (!u.asaas_customer_id) await query('UPDATE users SET asaas_customer_id = $1 WHERE id = $2', [customer, req.user.id]);

    // Vence no fim do trial (ou hoje, se já passou)
    const due = (await query(
      "SELECT GREATEST(COALESCE(trial_ends_at, NOW()), NOW())::date AS d FROM users WHERE id = $1", [req.user.id]
    )).rows[0].d;

    const bt = ['PIX', 'BOLETO', 'CREDIT_CARD'].includes(billingType) ? billingType : 'UNDEFINED';
    const charge = await createCharge({
      customer, value: PLANS[plan].price, dueDate: due,
      description: `KIVO ${PLANS[plan].name}`, billingType: bt,
    });

    await query(
      "UPDATE users SET pending_plan = $1, plan_status = 'pending', last_payment_id = $2, payment_link = $3 WHERE id = $4",
      [plan, charge.id, charge.invoiceUrl || null, req.user.id]
    );

    let pix = null;
    if (bt === 'PIX') { try { pix = await getPix(charge.id); } catch { /* */ } }

    return res.json({
      mode: 'asaas',
      paymentId: charge.id,
      billingType: bt,
      value: PLANS[plan].price,
      dueDate: due,
      invoiceUrl: charge.invoiceUrl || null,
      bankSlipUrl: charge.bankSlipUrl || null,
      pix: pix ? { encodedImage: pix.encodedImage, payload: pix.payload } : null,
    });
  } catch (e) { console.error(e); return res.status(500).json({ error: e.message || 'Erro ao gerar pagamento.' }); }
});

// Cancela a assinatura/cobrança pendente e volta ao trial
router.post('/cancel', async (req, res) => {
  try {
    const u = (await query('SELECT last_payment_id FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (u?.last_payment_id && asaasConfigured()) { try { await cancelCharge(u.last_payment_id); } catch { /* */ } }
    await query(
      "UPDATE users SET plan_status = 'trial', pending_plan = NULL, last_payment_id = NULL, payment_link = NULL WHERE id = $1",
      [req.user.id]
    );
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao cancelar.' }); }
});

// Mantido para testes manuais (ativa o plano sem pagamento)
router.post('/upgrade', async (req, res) => {
  try {
    const key = req.body?.plan;
    if (!PLANS[key]) return res.status(400).json({ error: 'Plano inválido.' });
    await query("UPDATE users SET plan = $1, plan_status = 'active' WHERE id = $2", [key, req.user.id]);
    const used = await studentCount(req.user.id);
    return res.json({ current: key, used, limit: PLANS[key].limit, plan: PLANS[key] });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao trocar de plano.' }); }
});

export default router;
