import { query } from './db.js';

// Estado de acesso (validado sempre no backend).
// Modelo: o ALUNO paga. O PERSONAL é gratuito (nunca bloqueado).
//  Aluno:  plano ativo (dentro da validade) OU trial válido -> liberado
//          trial vencido sem assinatura ativa               -> BLOQUEADO
export async function accessState(userId, role) {
  if (role === 'trainer') return { blocked: false, reason: 'trainer_free' };

  const r = await query(
    'SELECT plan_status, trial_ends_at, access_until FROM users WHERE id = $1',
    [userId]
  );
  const u = r.rows[0] || {};
  const now = Date.now();
  const accessUntil = u.access_until ? new Date(u.access_until).getTime() : null;

  if (u.plan_status === 'active' && accessUntil && now < accessUntil) {
    return { blocked: false, reason: 'active' };
  }
  const trialEnd = u.trial_ends_at ? new Date(u.trial_ends_at).getTime() : null;
  if (trialEnd && now < trialEnd) {
    return { blocked: false, reason: 'trial' };
  }
  return { blocked: true, reason: u.plan_status === 'active' ? 'expired' : 'trial_expired' };
}

// Middleware: bloqueia ações/leituras do ALUNO sem assinatura ativa / trial válido.
// Personal nunca é bloqueado.
export function requireAccess() {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.role === 'trainer') return next();
      const st = await accessState(req.user.id, 'student');
      if (st.blocked) {
        return res.status(402).json({
          error: 'Seu acesso expirou. Assine um plano para continuar treinando.',
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
