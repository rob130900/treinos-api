import { Router } from 'express';
import { query } from './db.js';
import { authRequired } from './authMiddleware.js';
import { PLANS, PLAN_ORDER } from './plans.js';
import { asaasConfigured, ensureCustomer, createCharge, getPix, cancelCharge } from './asaas.js';
import { accessState } from './access.js';

const router = Router();
router.use(authRequired);

// Status de assinatura. Personal é gratuito; aluno tem trial + planos.
router.get('/', async (req, res) => {
  try {
    if (req.user.role === 'trainer') {
      return res.json({ isTrainer: true, free: true, blocked: false });
    }
    const row = (await query(
      'SELECT plan_status, trial_ends_at, access_until, payment_link FROM users WHERE id = $1',
      [req.user.id]
    )).rows[0] || {};
    const access = await accessState(req.user.id, 'student');
    const now = Date.now();
    const trialEnd = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - now) / 86400000)) : null;

    return res.json({
      isTrainer: false,
      planStatus: row.plan_status || 'trial',
      isTrial: access.reason === 'trial',
      daysLeft,
      accessUntil: row.access_until || null,
      blocked: access.blocked,
      accessReason: access.reason,
      paymentLink: row.payment_link || null,
      plans: PLAN_ORDER.map((k) => PLANS[k]),
    });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao carregar plano.' }); }
});

// Aluno gera a cobrança do plano (PIX / boleto / cartão via Asaas).
router.post('/checkout', async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Apenas alunos assinam um plano.' });
    const { plan, billingType, cpfCnpj } = req.body || {};
    if (!PLANS[plan]) return res.status(400).json({ error: 'Plano inválido.' });

    // Sem chave Asaas -> modo teste (libera na hora pela duração do plano)
    if (!asaasConfigured()) {
      const until = new Date(Date.now() + PLANS[plan].days * 86400000);
      await query(
        "UPDATE users SET plan_status = 'active', pending_plan = NULL, access_until = $1, payment_link = NULL WHERE id = $2",
        [until, req.user.id]
      );
      return res.json({ mode: 'test', planStatus: 'active', accessUntil: until });
    }

    // Tem chave Asaas: tenta gerar a cobrança real. Se o Asaas falhar
    // (chave inválida, ambiente errado, instabilidade), NÃO bloqueia o aluno:
    // cai para o modo teste e libera o acesso, para nunca travar os testes.
    try {
      const u = (await query('SELECT name, email, asaas_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0];
      const customer = await ensureCustomer({ id: u.asaas_customer_id, name: u.name, email: u.email, cpfCnpj });
      if (!u.asaas_customer_id) await query('UPDATE users SET asaas_customer_id = $1 WHERE id = $2', [customer, req.user.id]);

      const due = (await query(
        "SELECT GREATEST(COALESCE(trial_ends_at, NOW()), NOW())::date AS d FROM users WHERE id = $1", [req.user.id]
      )).rows[0].d;
      const bt = ['PIX', 'BOLETO', 'CREDIT_CARD'].includes(billingType) ? billingType : 'UNDEFINED';
      const appUrl = process.env.APP_URL || 'https://treinos-web.onrender.com';
      const charge = await createCharge({
        customer, value: PLANS[plan].price, dueDate: due,
        description: `KIVO Plano ${PLANS[plan].name} — App de Treino`,
        billingType: bt,
        successUrl: appUrl + '/aluno',
      });

      await query(
        "UPDATE users SET pending_plan = $1, plan_status = 'pending', last_payment_id = $2, payment_link = $3 WHERE id = $4",
        [plan, charge.id, charge.invoiceUrl || null, req.user.id]
      );

      let pix = null;
      if (bt === 'PIX') { try { pix = await getPix(charge.id); } catch { /* */ } }

      return res.json({
        mode: 'asaas', paymentId: charge.id, billingType: bt,
        value: PLANS[plan].price, dueDate: due,
        invoiceUrl: charge.invoiceUrl || null, bankSlipUrl: charge.bankSlipUrl || null,
        pix: pix ? { encodedImage: pix.encodedImage, payload: pix.payload } : null,
      });
    } catch (asaasErr) {
      console.error('Asaas falhou, liberando em modo teste:', asaasErr.message);
      const until = new Date(Date.now() + PLANS[plan].days * 86400000);
      await query(
        "UPDATE users SET plan_status = 'active', pending_plan = NULL, access_until = $1, payment_link = NULL WHERE id = $2",
        [until, req.user.id]
      );
      return res.json({ mode: 'test', planStatus: 'active', accessUntil: until, fallback: true });
    }
  } catch (e) { console.error(e); return res.status(500).json({ error: e.message || 'Erro ao gerar pagamento.' }); }
});

router.post('/cancel', async (req, res) => {
  try {
    const u = (await query('SELECT last_payment_id FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (u?.last_payment_id && asaasConfigured()) { try { await cancelCharge(u.last_payment_id); } catch { /* */ } }
    await query(
      "UPDATE users SET pending_plan = NULL, last_payment_id = NULL, payment_link = NULL WHERE id = $1",
      [req.user.id]
    );
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao cancelar.' }); }
});

export default router;
