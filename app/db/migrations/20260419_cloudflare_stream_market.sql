-- Cloudflare Stream marketplace schema migration for Neon/PostgreSQL
-- Date: 2026-04-19

BEGIN;

ALTER TABLE IF EXISTS courses
  ADD COLUMN IF NOT EXISTS fair_usage_multiplier DOUBLE PRECISION DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS fair_usage_override_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS admin_fair_usage_override_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS courses
  ALTER COLUMN fair_usage_multiplier SET DEFAULT 2.5;

UPDATE courses
SET fair_usage_multiplier = 2.5
WHERE fair_usage_multiplier IS NULL OR fair_usage_multiplier > 2.5;

CREATE TABLE IF NOT EXISTS creators (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_creator_user_id UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_purchases (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  payment_ref VARCHAR(120),
  status VARCHAR(30) NOT NULL DEFAULT 'paid',
  admin_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_course_purchase_user_course UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS lesson_videos (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  creator_id BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  internal_id VARCHAR(64) NOT NULL,
  cloudflare_video_uid VARCHAR(120) NOT NULL,
  upload_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ready_status BOOLEAN NOT NULL DEFAULT FALSE,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  thumbnail_url VARCHAR(1000),
  playback_hls_url VARCHAR(1000),
  direct_upload_url VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lesson_videos_internal_id UNIQUE (internal_id),
  CONSTRAINT uq_lesson_videos_cloudflare_uid UNIQUE (cloudflare_video_uid)
);

CREATE TABLE IF NOT EXISTS video_watch_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  lesson_video_id BIGINT NOT NULL REFERENCES lesson_videos(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  consumed_seconds INTEGER NOT NULL DEFAULT 0,
  last_position_seconds INTEGER NOT NULL DEFAULT 0,
  client_app VARCHAR(30) NOT NULL DEFAULT 'web',
  ip_address VARCHAR(100),
  user_agent VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS video_watch_progress (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  lesson_video_id BIGINT NOT NULL REFERENCES lesson_videos(id) ON DELETE CASCADE,
  total_watched_seconds INTEGER NOT NULL DEFAULT 0,
  resume_position_seconds INTEGER NOT NULL DEFAULT 0,
  completion_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  first_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usage_warning_level INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_video_watch_progress_user_video UNIQUE (user_id, lesson_video_id)
);

CREATE TABLE IF NOT EXISTS live_stream_sessions (
  id BIGSERIAL PRIMARY KEY,
  creator_id BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  cloudflare_input_id VARCHAR(120),
  cloudflare_live_uid VARCHAR(120),
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  scheduled_start_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_live_stream_input_id UNIQUE (cloudflare_input_id),
  CONSTRAINT uq_live_stream_live_uid UNIQUE (cloudflare_live_uid)
);

CREATE INDEX IF NOT EXISTS idx_course_purchases_user ON course_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_course_purchases_course ON course_purchases(course_id);
CREATE INDEX IF NOT EXISTS idx_lesson_videos_course ON lesson_videos(course_id);
CREATE INDEX IF NOT EXISTS idx_lesson_videos_lesson ON lesson_videos(lesson_id);
CREATE INDEX IF NOT EXISTS idx_video_watch_sessions_user ON video_watch_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_video_watch_progress_user_course ON video_watch_progress(user_id, course_id);

COMMIT;
