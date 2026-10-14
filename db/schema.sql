-- Nexus Notify PostgreSQL foundation.
-- Apply with: npm run db:migrate (requires DATABASE_URL).
-- Secrets and provider credentials must never be stored in these tables.
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','admin','operator','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_users ALTER COLUMN role SET DEFAULT 'viewer';

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  default_channel text NOT NULL DEFAULT 'email' CHECK (default_channel IN ('email','otp','sms','whatsapp')),
  email_enabled boolean NOT NULL DEFAULT true,
  otp_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT true,
  whatsapp_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_hours_start IS NULL AND quiet_hours_end IS NULL) OR
         (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email','otp','sms','whatsapp')),
  recipient text NOT NULL,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','accepted','sent','delivered','failed','cancelled','dead_letter')),
  provider_message_id text,
  idempotency_key text UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_status_next_attempt_idx
  ON notifications (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_channel_status_created_idx
  ON notifications (channel, status, created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  outcome text NOT NULL CHECK (outcome IN ('started','accepted','delivered','retryable_error','permanent_error')),
  provider_status text,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (notification_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS delivery_attempts_notification_idx
  ON delivery_attempts (notification_id, started_at DESC);

CREATE TABLE IF NOT EXISTS notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  subject_template text,
  body_template text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, channel)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  request_id text,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','denied','failure')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_user_created_idx ON audit_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_alerts (
  id bigserial PRIMARY KEY,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  component text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  fingerprint text,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS system_alerts_open_idx ON system_alerts (severity, created_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS system_alerts_open_fingerprint_idx ON system_alerts (fingerprint)
  WHERE acknowledged_at IS NULL AND fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('001_notification_platform')
ON CONFLICT (version) DO NOTHING;
