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

export async function createCharge({ customer, value, dueDate, description, billingType, successUrl, splits }) {
  const body = { customer, billingType: billingType || 'UNDEFINED', value, dueDate, description };
  // Após pagar, o Asaas redireciona o usuário de volta ao app
  if (successUrl) body.callback = { successUrl, autoRedirect: true };
  // Split: divide o valor recebido. Cada item { walletId, fixedValue|percentualValue }.
  // O que não for dividido fica com quem emitiu a cobrança (a plataforma).
  if (Array.isArray(splits) && splits.length) body.split = splits;
  return call('/payments', { method: 'POST', body });
}

// Cria uma subconta Asaas (BaaS) para o personal e retorna { walletId, apiKey, id, ... }.
// Só funciona se a conta-raiz da plataforma for CNPJ (PJ). walletId é usado no split.
// data: { name, email, cpfCnpj, mobilePhone, incomeValue, address, addressNumber,
//         province, postalCode, companyType?, birthDate? }
export async function createSubaccount(data) {
  return call('/accounts', { method: 'POST', body: data });
}

export async function getPix(paymentId) {
  return call(`/payments/${paymentId}/pixQrCode`);
}

export async function cancelCharge(paymentId) {
  return call(`/payments/${paymentId}`, { method: 'DELETE' });
}
