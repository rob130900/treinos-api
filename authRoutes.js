import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';
import { authRequired, JWT_SECRET } from './authMiddleware.js';

const router = Router();

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, trainer_id: u.trainer_id };
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }
    const finalRole = role === 'trainer' ? 'trainer' : 'student';

    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Este email ja esta cadastrado.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, email.toLowerCase(), hash, finalRole]
    );

    const user = result.rows[0];
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
  return res.json({ user: publicUser(result.rows[0]) });
});

export default router;
