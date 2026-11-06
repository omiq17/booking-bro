CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('member', 'professional');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('booked', 'cancelled', 'rescheduled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_kind AS ENUM (
    'reminder_24h',
    'reminder_1h',
    'session_cancelled',
    'session_rescheduled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          user_role NOT NULL,
  timezone      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash       TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS professional_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty      TEXT NOT NULL DEFAULT 'Counsellor & Wellbeing Coach',
  bio            TEXT NOT NULL DEFAULT '',
  buffer_minutes SMALLINT NOT NULL DEFAULT 10 CHECK (buffer_minutes IN (10, 20, 30)),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS availability_windows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at            TIMESTAMPTZ NOT NULL,
  end_at              TIMESTAMPTZ NOT NULL,
  blocked_until       TIMESTAMPTZ NOT NULL,
  buffer_minutes      SMALLINT NOT NULL CHECK (buffer_minutes IN (10, 20, 30)),
  status              session_status NOT NULL DEFAULT 'booked',
  rescheduled_from_id UUID REFERENCES booking_sessions(id),
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_duration_50m CHECK (end_at = start_at + interval '50 minutes'),
  CONSTRAINT session_blocked_until_valid CHECK (blocked_until = end_at + (buffer_minutes * interval '1 minute')),
  CONSTRAINT member_not_professional CHECK (member_id <> professional_id)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_professional_overlap'
  ) THEN
    ALTER TABLE booking_sessions ADD CONSTRAINT no_professional_overlap
      EXCLUDE USING gist (
        professional_id WITH =,
        tstzrange(start_at, blocked_until, '[)') WITH &&
      ) WHERE (status = 'booked');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_member_overlap'
  ) THEN
    ALTER TABLE booking_sessions ADD CONSTRAINT no_member_overlap
      EXCLUDE USING gist (
        member_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      ) WHERE (status = 'booked');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES booking_sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        notification_kind NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_session_user_notification UNIQUE (session_id, user_id, kind)
);
