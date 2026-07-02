import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';
import { authRequired, JWT_SECRET } from './authMiddleware.js';
import { asaasConfigured, ensureCustomer } from './asaas.js';
import { validCPF, cpfHash, cpfLast3, badgeFor } from './cpf.js';

const router = Router();

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    trainer_id: u.trainer_id, invite_code: u.invite_code || null,
    account_type: u.account_type || null, cref: u.cref || null,
    cref_status: u.cref_status || 'nao_informado', badge: badgeFor(u),
  };
}

function codeBase(name) {
  const b = (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 7);
  return b || 'KIVO';
}
async function generateInviteCode(name) {
  const base = codeBase(name);
  for (let i = 0; i < 25; i++) {
    const code = base + Math.floor(100 + Math.random() * 900);
    const exists = await query('SELECT 1 FROM users WHERE invite_code = $1', [code]);
    if (!exists.rows.length) return code;
  }
  return base + String(Date.now()).slice(-5);
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, invite_code, account_type, cref, phone, birth_date, cpf } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }
    // CPF obrigatório: valida dígitos + antiduplicidade (por hash, sem guardar em claro)
    const cpfDigits = String(cpf || '').replace(/\D/g, '');
    if (!cpfDigits) return res.status(400).json({ error: 'CPF é obrigatório.' });
    if (!validCPF(cpfDigits)) return res.status(400).json({ error: 'CPF inválido. Confira os números.' });
    const chash = cpfHash(cpfDigits);
    const cpfDup = await query('SELECT 1 FROM users WHERE cpf_hash = $1', [chash]);
    if (cpfDup.rows.length) return res.status(409).json({ error: 'Este CPF já está cadastrado.' });

    const finalRole = role === 'trainer' ? 'trainer' : 'student';
    const acctType = finalRole === 'trainer' ? (account_type || 'personal_trainer') : null;
    const crefVal = finalRole === 'trainer' && cref ? String(cref).trim() : null;
    const crefStatus = crefVal ? 'em_analise' : 'nao_informado';

    // Aluno que se cadastra sozinho precisa do código do personal
    // Código do personal é opcional no cadastro — o aluno pode vincular depois no app
    let trainerId = null;
    if (finalRole === 'student') {
      const code = (invite_code || '').trim().toUpperCase();
      if (code) {
        const t = await query("SELECT id FROM users WHERE invite_code = $1 AND role = 'trainer'", [code]);
        if (!t.rows.length) return res.status(400).json({ error: 'Código do personal inválido.' });
        trainerId = t.rows[0].id;
      }
    }

    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Este email ja esta cadastrado.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, trainer_id, personal_id,
         account_type, cref, cref_status, phone, birth_date, cpf_hash, cpf_last3)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [name, email.toLowerCase(), hash, finalRole, trainerId,
       acctType, crefVal, crefStatus, phone || null, birth_date || null, chash, cpfLast3(cpfDigits)]
    );
    const user = result.rows[0];

    if (finalRole === 'trainer') {
      const code = await generateInviteCode(user.name);
      await query('UPDATE users SET invite_code = $1, personal_id = id WHERE id = $2', [code, user.id]);
      user.invite_code = code;
      user.personal_id = user.id;
    } else if (asaasConfigured()) {
      // Aluno é quem paga: cria cliente no Asaas
      try {
        const customerId = await ensureCustomer({ name: user.name, email: user.email });
        await query('UPDATE users SET asaas_customer_id = $1 WHERE id = $2', [customerId, user.id]);
      } catch (e) { console.error('asaas customer (register aluno)', e.message); }
    }

    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao cadastrar usuario.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
    }

    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Email ou senha incorretos.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email ou senha incorretos.' });

    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  const result = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario nao encontrado.' });
  const u = result.rows[0];

  // Gera o código de convite para personais antigos que ainda não têm
  if (u.role === 'trainer' && !u.invite_code) {
    try { const code = await generateInviteCode(u.name); await query('UPDATE users SET invite_code = $1 WHERE id = $2', [code, u.id]); u.invite_code = code; }
    catch (e) { console.error('invite code (me)', e.message); }
  }

  let trainerName = null; let trainerBadge = null;
  if (u.role === 'student' && u.trainer_id) {
    const t = (await query('SELECT name, cref, cref_status, account_type, email_verified, phone_verified FROM users WHERE id = $1', [u.trainer_id])).rows[0];
    trainerName = t?.name || null;
    trainerBadge = badgeFor(t);
  }

  return res.json({ user: { ...publicUser(u), trainer_name: trainerName, trainer_badge: trainerBadge } });
});

// Aluno vincula um personal pelo código (só se ainda não tiver vínculo)
router.post('/link-trainer', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Apenas alunos vinculam um personal.' });
    const code = (req.body?.invite_code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Informe o código do personal.' });

    const me = (await query('SELECT trainer_id FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (me?.trainer_id) return res.status(400).json({ error: 'Você já está vinculado a um personal.' });

    const t = (await query("SELECT id, name FROM users WHERE invite_code = $1 AND role = 'trainer'", [code])).rows[0];
    if (!t) return res.status(404).json({ error: 'Código inválido. Confira com o seu personal.' });

    await query('UPDATE users SET trainer_id = $1, personal_id = $1 WHERE id = $2', [t.id, req.user.id]);
    return res.json({ ok: true, trainer_name: t.name });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro ao vincular personal.' });
  }
});

export default router;
