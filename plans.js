// Planos do PERSONAL (gestão e limite de alunos).
// limit = null  -> ilimitado.
export const PLANS = {
  trial: {
    key: 'trial', name: 'Plano Gratuito', price: 0, limit: 3, trial: true,
    desc: 'Teste o sistema com até 3 alunos por 7 dias',
  },
  basico: {
    key: 'basico', name: 'Plano Básico', price: 19.90, limit: 10,
    desc: 'Ideal para começar e testar o sistema',
  },
  intermediario: {
    key: 'intermediario', name: 'Plano Intermediário', price: 49.90, limit: 30,
    badge: 'Mais escolhido', desc: 'Perfeito para personal em crescimento',
  },
  premium: {
    key: 'premium', name: 'Plano Premium', price: 149.90, limit: null,
    badge: 'Plano profissional', desc: 'Para quem quer escalar sem limites',
  },
};

// Planos pagos exibidos no grid de upgrade (trial não é escolhível).
export const PLAN_ORDER = ['basico', 'intermediario', 'premium'];

export function planKey(value) {
  return value && PLANS[value] ? value : 'trial';
}
