// Planos de assinatura do ALUNO (modelo: o aluno paga; o personal é gratuito).
// days = quantos dias de acesso cada pagamento libera.
export const PLANS = {
  mensal: {
    key: 'mensal', name: 'Mensal', price: 19.90, days: 30,
    desc: 'Acesso completo aos treinos. Renova a cada mês.',
  },
  trimestral: {
    key: 'trimestral', name: 'Trimestral', price: 49.90, days: 90,
    badge: 'Mais escolhido', desc: '3 meses de acesso com melhor custo-benefício.',
  },
  anual: {
    key: 'anual', name: 'Anual', price: 179.90, days: 365,
    badge: 'Melhor preço', desc: '1 ano de acesso pelo menor valor por mês.',
  },
};

export const PLAN_ORDER = ['mensal', 'trimestral', 'anual'];

export function planKey(value) {
  return value && PLANS[value] ? value : null;
}
