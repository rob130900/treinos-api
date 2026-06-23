-- ============================================================
-- Banco de dados do app de treinos para Personal Trainer
-- PostgreSQL
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'student'
                CHECK (role IN ('trainer', 'student')),
  trainer_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_trainer ON users(trainer_id);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);

-- CRM: status e ficha do aluno (idempotente)
ALTER TABLE users ADD COLUMN IF NOT EXISTS status        VARCHAR(20) DEFAULT 'ativo';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date    DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS goal          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_fee   NUMERIC(8,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_notes TEXT;
-- Plano do personal (limite de alunos). Novo personal começa no trial gratuito.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days');
-- Assinatura / pagamento (Asaas)
ALTER TABLE users ADD COLUMN IF NOT EXISTS asaas_customer_id VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_status   VARCHAR(20) DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_plan  VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_payment_id VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_link  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_until  TIMESTAMPTZ;
-- Código de convite do personal (aluno se vincula por ele)
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code) WHERE invite_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS workouts (
  id             SERIAL PRIMARY KEY,
  trainer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          VARCHAR(160) NOT NULL,
  description    TEXT,
  scheduled_date DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workouts_student ON workouts(student_id);
CREATE INDEX IF NOT EXISTS idx_workouts_trainer ON workouts(trainer_id);

CREATE TABLE IF NOT EXISTS exercises (
  id           SERIAL PRIMARY KEY,
  workout_id   INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  name         VARCHAR(160) NOT NULL,
  sets         INTEGER,
  reps         VARCHAR(40),
  weight       VARCHAR(40),
  notes        TEXT,
  image_url    TEXT,
  image_url2   TEXT,
  video_id     VARCHAR(40),
  instructions TEXT,
  muscle_group VARCHAR(40),
  rest_seconds INTEGER DEFAULT 60,
  order_index  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_exercises_workout ON exercises(workout_id);

-- Garante as colunas novas em bancos ja existentes (idempotente)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS image_url    TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS image_url2   TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS video_id     VARCHAR(40);
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS muscle_group VARCHAR(40);
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS rest_seconds INTEGER DEFAULT 60;

CREATE TABLE IF NOT EXISTS workout_logs (
  id           SERIAL PRIMARY KEY,
  workout_id   INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER,
  note         TEXT,
  UNIQUE (workout_id)
);

ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
-- Feedback pos-treino (dificuldade 1-5, dor, comentario)
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS difficulty INTEGER;
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS pain BOOLEAN DEFAULT FALSE;
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS feedback TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_student ON workout_logs(student_id);

-- Conclusao por exercicio (treino guiado)
CREATE TABLE IF NOT EXISTS exercise_logs (
  id           SERIAL PRIMARY KEY,
  exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  workout_id   INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exercise_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exlogs_workout ON exercise_logs(workout_id);
CREATE INDEX IF NOT EXISTS idx_exlogs_student ON exercise_logs(student_id);

-- ============================================================
-- Comunicacao: mensagens (chat aluno <-> professor)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  trainer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role  VARCHAR(10) NOT NULL CHECK (sender_role IN ('student', 'trainer')),
  kind         VARCHAR(16) NOT NULL DEFAULT 'chat'
               CHECK (kind IN ('chat', 'duvida', 'feedback')),
  exercise_name VARCHAR(160),
  workout_id   INTEGER REFERENCES workouts(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  read_by_trainer BOOLEAN NOT NULL DEFAULT FALSE,
  read_by_student BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_pair    ON messages(trainer_id, student_id);
CREATE INDEX IF NOT EXISTS idx_messages_student ON messages(student_id);

-- ============================================================
-- Evolucao: medidas corporais e fotos antes/depois
-- ============================================================
CREATE TABLE IF NOT EXISTS measurements (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  weight       NUMERIC(6,2),
  body_fat     NUMERIC(5,2),
  chest        NUMERIC(6,2),
  waist        NUMERIC(6,2),
  hip          NUMERIC(6,2),
  arm          NUMERIC(6,2),
  thigh        NUMERIC(6,2),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_measurements_student ON measurements(student_id);

CREATE TABLE IF NOT EXISTS progress_photos (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  taken_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  label        VARCHAR(20),
  image_data   TEXT NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photos_student ON progress_photos(student_id);

-- ============================================================
-- CRM Financeiro: pagamentos / mensalidades
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(8,2) NOT NULL,
  due_date    DATE,
  paid_on     DATE,
  method      VARCHAR(30),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_trainer ON payments(trainer_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
