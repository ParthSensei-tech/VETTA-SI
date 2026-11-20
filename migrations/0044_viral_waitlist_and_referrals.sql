-- Viral waitlist with Robinhood-style referral queue mechanics
CREATE SEQUENCE IF NOT EXISTS waitlist_position_seq START 1;

CREATE TABLE IF NOT EXISTS launch_waitlist (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT NOT NULL,
  founder_name         TEXT NOT NULL,
  company_name         TEXT NOT NULL DEFAULT '',
  role_title           TEXT NOT NULL DEFAULT '',
  waitlist_position    BIGINT NOT NULL DEFAULT nextval('waitlist_position_seq'),
  referral_code        TEXT NOT NULL UNIQUE,
  referred_by_code     TEXT,
  referral_count       INT NOT NULL DEFAULT 0,
  position_bonus       INT NOT NULL DEFAULT 0,
  bonus_calling_credits INT NOT NULL DEFAULT 10,
  is_activated         BOOLEAN NOT NULL DEFAULT FALSE,
  utm_source           TEXT,
  utm_campaign         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT launch_waitlist_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_position ON launch_waitlist (waitlist_position);
CREATE INDEX IF NOT EXISTS idx_waitlist_referral_code ON launch_waitlist (referral_code);
CREATE INDEX IF NOT EXISTS idx_waitlist_referred_by ON launch_waitlist (referred_by_code);
