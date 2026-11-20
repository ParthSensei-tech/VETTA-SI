-- Personal founder intake slugs for /f/:slug WhatsApp bot pages
CREATE TABLE IF NOT EXISTS founder_intake_slugs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    TEXT NOT NULL,
  user_id                   TEXT NOT NULL,
  slug                      TEXT NOT NULL,
  display_name              TEXT NOT NULL DEFAULT '',
  company_name              TEXT NOT NULL DEFAULT '',
  whatsapp_number           TEXT NOT NULL DEFAULT '',
  active_role_ids           TEXT[] NOT NULL DEFAULT '{}',
  total_candidates_ingested INT NOT NULL DEFAULT 0,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT founder_intake_slugs_slug_unique UNIQUE (slug),
  CONSTRAINT founder_intake_slugs_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_intake_slug ON founder_intake_slugs (slug) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_intake_org ON founder_intake_slugs (org_id);
