import crypto from 'crypto';

// Valida os dígitos verificadores do CPF (sem consultar Receita).
export function validCPF(cpf) {
  const s = String(cpf || '').replace(/\D/g, '');
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(s[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(s[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === parseInt(s[10], 10);
}

// Hash determinístico (HMAC + pepper do servidor) — permite checar duplicidade
// SEM guardar o CPF em claro. Defina CPF_PEPPER no ambiente para produção.
export function cpfHash(cpf) {
  const s = String(cpf || '').replace(/\D/g, '');
  const pepper = process.env.CPF_PEPPER || 'kivo-cpf-pepper-troque-no-env';
  return crypto.createHmac('sha256', pepper).update(s).digest('hex');
}

export function cpfLast3(cpf) {
  return String(cpf || '').replace(/\D/g, '').slice(-3);
}

// Selo derivado das flags (não armazenar em duplicidade).
// "Personal Verificado" exige CPF+CREF+email+telefone verificados (futuro, quando houver OTP/validação).
export function badgeFor(u) {
  if (!u) return null;
  if (u.cref && u.email_verified && u.phone_verified && u.cpf_verified && u.cref_status === 'validado') {
    return 'Personal Verificado';
  }
  if (u.cref) return 'Profissional Registrado';
  if (u.account_type === 'estudante_ed_fisica') return 'Estudante';
  return null;
}
