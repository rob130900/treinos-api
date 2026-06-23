import { query } from './db.js';

// Estado de acesso do PERSONAL (validado sempre no backend):
//  - plano ativo (pago)            -> liberado
//  - trial ainda válido            -> liberado
//  - trial vencido e não pago      -> BLOQUEADO
export async function accessState(trainerId) {
  const r = await query('SELECT plan_status, trial_ends_at FROM users WHERE id = $1', [trainerId]);
  const u = r.rows[0] || {};
  const status = u.plan_status || 'trial';

  if (status === 'active') return { blocked: false, reason: 'active' };

  const trialEnd = u.trial_ends_at ? new Date(u.trial_ends_at).getTime() : null;
  const trialActive = trialEnd != null && Date.now() < trialEnd;
  if (trialActive) return { blocked: false, reason: status === 'pending' ? 'pending' : 'trial' };

  return {
    blocked: true,
    reason: status === 'overdue' ? 'overdue' : (status === 'pending' ? 'pending_expired' : 'trial_expired'),
  };
}

// Middleware: bloqueia ações de personal sem assinatura ativa / trial válido.
// Alunos não são bloqueados pela assinatura do personal.
export function requireAccess() {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.role !== 'trainer') return next();
      const st = await accessState(req.user.id);
      if (st.blocked) {
        return res.status(402).json({
          error: 'Seu período gratuito terminou. Assine um plano para continuar.',
          code: 'ACCESS_BLOCKED',
          reason: st.reason,
        });
      }
      return next();
    } catch (e) {
      console.error('requireAccess', e);
      return next();
    }
  };
}
