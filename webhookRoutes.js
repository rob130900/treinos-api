import { Router } from 'express';
import { query } from './db.js';

const router = Router();

// Webhook do Asaas. Configure a mesma URL e token no painel do Asaas.
// Validação simples por token no header (ASAAS_WEBHOOK_TOKEN).
router.post('/asaas', async (req, res) => {
  try {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (expected && req.headers['asaas-access-token'] !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const ev = req.body || {};
    const event = ev.event;
    const paymentId = ev.payment?.id;
    if (!paymentId) return res.json({ ok: true });

    const u = (await query('SELECT id, pending_plan FROM users WHERE last_payment_id = $1', [paymentId])).rows[0];
    if (!u) return res.json({ ok: true });

    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      if (u.pending_plan) {
        await query(
          "UPDATE users SET plan = $1, plan_status = 'active', pending_plan = NULL WHERE id = $2",
          [u.pending_plan, u.id]
        );
      }
    } else if (event === 'PAYMENT_OVERDUE') {
      await query("UPDATE users SET plan_status = 'overdue' WHERE id = $1", [u.id]);
    } else if (event === 'PAYMENT_DELETED' || event === 'PAYMENT_REFUNDED') {
      await query("UPDATE users SET plan_status = 'canceled', pending_plan = NULL WHERE id = $1", [u.id]);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('webhook asaas', e);
    return res.json({ ok: true }); // responde 200 para o Asaas não reenviar em loop
  }
});

export default router;
