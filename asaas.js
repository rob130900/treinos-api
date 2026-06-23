// Wrapper da API do Asaas. A chave NUNCA fica no código — vem de
// process.env.ASAAS_API_KEY (definida no Render pelo usuário).
// ASAAS_ENV = 'sandbox' | 'production' (padrão production).

const ENV = process.env.ASAAS_ENV || 'production';
const BASE = ENV === 'sandbox'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

export function asaasConfigured() {
  return !!process.env.ASAAS_API_KEY;
}

async function call(path, { method = 'GET', body } = {}) {
  if (!asaasConfigured()) throw new Error('Asaas não configurado (defina ASAAS_API_KEY).');
  if (typeof fetch !== 'function') throw new Error('Runtime sem fetch (requer Node 18+).');
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: process.env.ASAAS_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.errors?.[0]?.description || `Erro Asaas (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export async function ensureCustomer({ id, name, email, cpfCnpj }) {
  if (id) return id;
  const c = await call('/customers', { method: 'POST', body: { name, email, cpfCnpj } });
  return c.id;
}

export async function createCharge({ customer, value, dueDate, description, billingType, successUrl }) {
  const body = { customer, billingType: billingType || 'UNDEFINED', value, dueDate, description };
  // Após pagar, o Asaas redireciona o usuário de volta ao app
  if (successUrl) body.callback = { successUrl, autoRedirect: true };
  return call('/payments', { method: 'POST', body });
}

export async function getPix(paymentId) {
  return call(`/payments/${paymentId}/pixQrCode`);
}

export async function cancelCharge(paymentId) {
  return call(`/payments/${paymentId}`, { method: 'DELETE' });
}
