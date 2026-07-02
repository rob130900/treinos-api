import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

import { pool, tenantStore } from './db.js';
import { JWT_SECRET } from './authMiddleware.js';
import authRoutes from './authRoutes.js';
import studentRoutes from './studentRoutes.js';
import workoutRoutes from './workoutRoutes.js';
import exportRoutes from './exportRoutes.js';
import messageRoutes from './messageRoutes.js';
import progressRoutes from './progressRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import planRoutes from './planRoutes.js';
import webhookRoutes from './webhookRoutes.js';
import customExRoutes from './customExRoutes.js';

dotenv.config();

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || '*';
const origins = corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim());
app.use(cors({ origin: origins }));

app.use(express.json({ limit: '25mb' })); // vídeos curtos em base64

// Multi-tenant: se a request tem token válido, estabelece o contexto do tenant
// (personal_id) para toda a request. A partir daí a RLS filtra por tenant.
// O personal_id vem do banco (à prova de token defasado quando o aluno vincula depois).
app.use(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next();
  let uid;
  try { uid = jwt.verify(token, JWT_SECRET).id; } catch { return next(); }
  let pid = null;
  try {
    const r = await pool.query('SELECT personal_id FROM users WHERE id = $1', [uid]);
    pid = r.rows[0]?.personal_id ?? null;
  } catch { /* segue sem contexto */ }
  tenantStore.run({ personalId: pid }, () => next());
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'treinos-api' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/workouts', workoutRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/custom-exercises', customExRoutes);

app.use((req, res) => res.status(404).json({ error: 'Rota nao encontrada.' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
