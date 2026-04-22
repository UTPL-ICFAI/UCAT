-- Template Library + Scheduling Migration (safe, additive)
ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pushed' CHECK (status IN ('draft','scheduled','pushed')),
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_config JSONB;
