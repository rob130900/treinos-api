import { Router } from 'express';
import { query } from './db.js';
import { authRequired } from './authMiddleware.js';
import { PLANS, PLAN_ORDER, PLATFORM_FEE, studentBilling } from './plans.js';
import { asaasConfigured, ensureCustomer, createCharge, getPix, cancelCharge, createSubaccount } from './asaas.js';
import { accessState } from './access.js';

const router = Router();
router.use(authRequired);

// Status de assinatura. Personal é gratuito; aluno tem trial + planos.
router.get('/', async (req, res) => {
  try {
    if (req.user.role === 'trainer') {
      const w = (await query('SELECT asaas_wallet_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      return res.json({
        isTrainer: true, free: true, blocked: false,
        paymentActive: asaasConfigured(),
        connected: !!w.asaas_wallet_id, walletId: w.asaas_wallet_id || null,
      });
    }
    const row = (await query(
      'SELECT plan_status, trial_ends_at, access_until, payment_link, monthly_fee FROM users WHERE id = $1',
      [req.user.id]
    )).rows[0] || {};
    const access = await accessState(req.user.id, 'student');
    const now = Date.now();
    const trialEnd = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - now) / 86400000)) : null;

    // Modelo de mensalidade: o personal define o valor; a plataforma soma a taxa.
    const billing = studentBilling(row.monthly_fee);

    return res.json({
      isTrainer: false,
      planStatus: row.plan_status || 'trial',
      isTrial: access.reason === 'trial',
      daysLeft,
      accessUntil: row.access_until || null,
      blocked: access.blocked,
      accessReason: access.reason,
      paymentLink: row.payment_link || null,
      // mensalidade (modelo atual): valor único que o aluno paga
      hasMensalidade: !!billing,
      mensalidade: billing ? billing.mensalidade : null,
      platformFee: PLATFORM_FEE,
      total: billing ? billing.total : null,
      // catálogo legado (compatibilidade)
      plans: PLAN_ORDER.map((k) => PLANS[k]),
    });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Erro ao carregar plano.' }); }
});

// Personal conecta o recebimento: cria a subconta Asaas (BaaS) e guarda o walletId.
// Com o walletId, a mensalidade cai DIRETO na carteira do personal via split.
router.post('/connect', async (req, res) => {
  try {
    if (req.user.role !== 'trainer') return res.status(403).json({ error: 'Apenas o personal conecta o recebimento.' });
    if (!asaasConfigured()) return res.status(400).json({ error: 'Pagamento ainda não está ativo (Asaas não configurado).' });

    const existing = (await query('SELECT asaas_wallet_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    if (existing.asaas_wallet_id) return res.json({ connected: true, walletId: existing.asaas_wallet_id, already: true });

    const me = (await query('SELECT name, email FROM users WHERE id = $1', [req.user.id])).rows[0];
    const b = req.body || {};
    const required = ['cpfCnpj', 'mobilePhone', 'incomeValue', 'address', 'addressNumber', 'province', 'postalCode'];
    const missing = required.filter((f) => b[f] === undefined || b[f] === null || b[f] === '');
    if (missing.length) return res.status(400).json({ error: 'Preencha: ' + missing.join(', ') });

    const payload = {
      name: b.name || me.name,
      email: b.email || me.email,
      cpfCnpj: String(b.cpfCnpj).replace(/\D/g, ''),
      mobilePhone: String(b.mobilePhone).replace(/\D/g, ''),
      incomeValue: Number(b.incomeValue),
      address: b.address, addressNumber: String(b.addressNumber),
      province: b.province, postalCode: String(b.postalCode).replace(/\D/g, ''),
    };
    if (b.companyType) payload.companyType = b.companyType; // MEI|LIMITED|INDIVIDUAL|ASSOCIATION (PJ)
    if (b.birthDate) payload.birthDate = b.birthDate;        // PF
    if (b.complement) payload.complement = b.complement;

    const acc = await createSubaccount(payload);
    if (!acc.walletId) return res.status(502).json({ error: 'Asaas não retornou a carteira (walletId).' });
    await query('UPDATE users SET asaas_wallet_id = $1 WHERE id = $2', [acc.walletId, req.user.id]);
    return res.json({ connected: true, walletId: acc.walletId });
  } catch (e) {
    console.error('connect subaccount', e.message);
    return res.status(500).json({ error: e.message || 'Erro ao conectar recebimento.' });
  }
});

// Aluno gera a cobrança do plano (PIX / boleto / cartão via Asaas).
router.post('/checkout', async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Apenas alunos assinam um plano.' });
    const { plan, billingType, cpfCnpj } = req.body || {};

    // Modelo de mensalidade: o personal define quanto quer receber; a plataforma
    // soma a taxa fixa. O aluno paga o total. (Fallback p/ catálogo legado.)
    const meRow = (await query('SELECT monthly_fee FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const billing = studentBilling(meRow.monthly_fee);
    let chargeValue, chargeDays, chargeName, pendingKey;
    if (billing) {
      chargeValue = billing.total; chargeDays = billing.days; chargeName = 'Mensalidade'; pendingKey = 'mensal';
    } else if (PLANS[plan]) {
      chargeValue = PLANS[plan].price; chargeDays = PLANS[plan].days; chargeName = PLANS[plan].name; pendingKey = plan;
    } else {
      return res.status(400).json({ error: 'Seu personal ainda não definiu sua mensalidade. Fale com ele para liberar o pagamento.' });
    }

    // Sem chave Asaas -> modo teste (libera na hora pela duração do plano)
    if (!asaasConfigured()) {
      const until = new Date(Date.now() + chargeDays * 86400000);
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

      // Split: se o personal do aluno tem carteira (subconta), a mensalidade vai
      // direto pra ele (valor cheio). A plataforma fica com o resto (taxa - tarifa).
      let splits;
      if (billing) {
        const tw = (await query(
          'SELECT t.asaas_wallet_id FROM users s JOIN users t ON t.id = s.trainer_id WHERE s.id = $1',
          [req.user.id]
        )).rows[0];
        if (tw && tw.asaas_wallet_id) splits = [{ walletId: tw.asaas_wallet_id, fixedValue: billing.mensalidade }];
      }

      const charge = await createCharge({
        customer, value: chargeValue, dueDate: due,
        description: `KIVO ${chargeName} — App de Treino`,
        billingType: bt,
        successUrl: appUrl + '/aluno',
        splits,
      });

      await query(
        "UPDATE users SET pending_plan = $1, plan_status = 'pending', last_payment_id = $2, payment_link = $3 WHERE id = $4",
        [pendingKey, charge.id, charge.invoiceUrl || null, req.user.id]
      );

      let pix = null;
      if (bt === 'PIX') { try { pix = await getPix(charge.id); } catch { /* */ } }

      return res.json({
        mode: 'asaas', paymentId: charge.id, billingType: bt,
        value: chargeValue, dueDate: due,
        invoiceUrl: charge.invoiceUrl || null, bankSlipUrl: charge.bankSlipUrl || null,
        pix: pix ? { encodedImage: pix.encodedImage, payload: pix.payload } : null,
      });
    } catch (asaasErr) {
      console.error('Asaas falhou, liberando em modo teste:', asaasErr.message);
      const until = new Date(Date.now() + chargeDays * 86400000);
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
