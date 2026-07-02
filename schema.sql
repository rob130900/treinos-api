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
-- Split: carteira Asaas (subconta) do personal — recebe a mensalidade direto
ALTER TABLE users ADD COLUMN IF NOT EXISTS asaas_wallet_id VARCHAR(60);
-- Código de convite do personal (aluno se vincula por ele)
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code) WHERE invite_code IS NOT NULL;

-- Contas: tipo, CREF opcional (selo), CPF por hash (validação + antiduplicidade, sem guardar em claro)
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS cref        VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS cref_status VARCHAR(20) DEFAULT 'nao_informado';
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf_hash    CHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf_last3   CHAR(3);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cpfhash ON users(cpf_hash) WHERE cpf_hash IS NOT NULL;

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
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS video_data   TEXT;

-- Exercícios personalizados do personal (com vídeo próprio)
CREATE TABLE IF NOT EXISTS custom_exercises (
  id           SERIAL PRIMARY KEY,
  trainer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(160) NOT NULL,
  description  TEXT,
  muscle_group VARCHAR(60),
  notes        TEXT,
  video_data   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customex_trainer ON custom_exercises(trainer_id);

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
-- Mídia (vídeo) nas mensagens
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(10);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_data TEXT;

-- Biblioteca de vídeos modelo de correção (do personal, por exercício)
CREATE TABLE IF NOT EXISTS correction_videos (
  id            SERIAL PRIMARY KEY,
  trainer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name VARCHAR(160),
  label         VARCHAR(120),
  media_data    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_corrvid_trainer ON correction_videos(trainer_id);

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

-- ============================================================
-- MULTI-TENANT (Fases 1-3) — personal_id explícito em toda tabela.
-- Aditivo e idempotente. NÃO habilita RLS aqui (isso é a Fase 5,
-- só depois do backend setar o contexto do tenant). Não afeta o app atual.
-- ============================================================

-- Identidade externa do personal (link/QR sem expor id sequencial)
ALTER TABLE users ADD COLUMN IF NOT EXISTS slug      VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id UUID DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug     ON users(slug)      WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_publicid ON users(public_id) WHERE public_id IS NOT NULL;

-- personal_id (o TENANT) em cada tabela de domínio
ALTER TABLE users             ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE workouts          ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE exercises         ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE custom_exercises  ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE workout_logs      ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE exercise_logs     ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE messages          ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE correction_videos ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE measurements      ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE progress_photos   ADD COLUMN IF NOT EXISTS personal_id INTEGER;
ALTER TABLE payments          ADD COLUMN IF NOT EXISTS personal_id INTEGER;

-- Backfill (idempotente: só onde ainda está nulo)
UPDATE users SET personal_id = CASE WHEN role='trainer' THEN id ELSE trainer_id END WHERE personal_id IS NULL;
UPDATE workouts          SET personal_id = trainer_id WHERE personal_id IS NULL;
UPDATE messages          SET personal_id = trainer_id WHERE personal_id IS NULL;
UPDATE payments          SET personal_id = trainer_id WHERE personal_id IS NULL;
UPDATE custom_exercises  SET personal_id = trainer_id WHERE personal_id IS NULL;
UPDATE correction_videos SET personal_id = trainer_id WHERE personal_id IS NULL;
UPDATE exercises e     SET personal_id = w.personal_id FROM workouts w WHERE e.workout_id = w.id AND e.personal_id IS NULL;
UPDATE workout_logs l  SET personal_id = w.personal_id FROM workouts w WHERE l.workout_id = w.id AND l.personal_id IS NULL;
UPDATE exercise_logs l SET personal_id = w.personal_id FROM workouts w WHERE l.workout_id = w.id AND l.personal_id IS NULL;
UPDATE measurements m    SET personal_id = u.trainer_id FROM users u WHERE m.student_id = u.id AND m.personal_id IS NULL;
UPDATE progress_photos p SET personal_id = u.trainer_id FROM users u WHERE p.student_id = u.id AND p.personal_id IS NULL;

-- Slug do personal (nome sem acento + id para unicidade)
UPDATE users SET slug =
  trim(both '-' from regexp_replace(
    lower(translate(name,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
    '[^a-z0-9]+', '-', 'g'))
  || '-' || id
  WHERE role='trainer' AND slug IS NULL;

-- Índices compostos começando por personal_id (o filtro mais comum)
CREATE INDEX IF NOT EXISTS idx_workouts_tenant  ON workouts(personal_id, student_id);
CREATE INDEX IF NOT EXISTS idx_exercises_tenant ON exercises(personal_id, workout_id);
CREATE INDEX IF NOT EXISTS idx_customex_tenant  ON custom_exercises(personal_id);
CREATE INDEX IF NOT EXISTS idx_wlogs_tenant     ON workout_logs(personal_id, student_id);
CREATE INDEX IF NOT EXISTS idx_exlogs_tenant    ON exercise_logs(personal_id, student_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant  ON messages(personal_id, student_id);
CREATE INDEX IF NOT EXISTS idx_corrvid_tenant   ON correction_videos(personal_id);
CREATE INDEX IF NOT EXISTS idx_meas_tenant      ON measurements(personal_id, student_id);
CREATE INDEX IF NOT EXISTS idx_photos_tenant    ON progress_photos(personal_id, student_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant  ON payments(personal_id, student_id);
