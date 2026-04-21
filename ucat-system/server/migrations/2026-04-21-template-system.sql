-- Template System Migration (safe, additive)

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS template_type VARCHAR(20) NOT NULL DEFAULT 'form' CHECK (template_type IN ('form', 'table')),
  ADD COLUMN IF NOT EXISTS columns JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS row_limit INTEGER;

ALTER TABLE daily_submissions
  ADD COLUMN IF NOT EXISTS template_snapshot JSONB NOT NULL DEFAULT '{}';

UPDATE templates
SET template_type = 'form'
WHERE template_type IS NULL;
