import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './authRoutes.js';
import studentRoutes from './studentRoutes.js';
import workoutRoutes from './workoutRoutes.js';
import exportRoutes from './exportRoutes.js';
import messageRoutes from './messageRoutes.js';
import progressRoutes from './progressRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import planRoutes from './planRoutes.js';

dotenv.config();

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || '*';
const origins = corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim());
app.use(cors({ origin: origins }));

app.use(express.json({ limit: '8mb' }));

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

app.use((req, res) => res.status(404).json({ error: 'Rota nao encontrada.' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
