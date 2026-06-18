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
  instructions TEXT,
  muscle_group VARCHAR(40),
  order_index  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_exercises_workout ON exercises(workout_id);

-- Garante as colunas novas em bancos ja existentes (idempotente)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS image_url    TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS image_url2   TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS muscle_group VARCHAR(40);

CREATE TABLE IF NOT EXISTS workout_logs (
  id           SERIAL PRIMARY KEY,
  workout_id   INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT,
  UNIQUE (workout_id)
);

CREATE INDEX IF NOT EXISTS idx_logs_student ON workout_logs(student_id);
