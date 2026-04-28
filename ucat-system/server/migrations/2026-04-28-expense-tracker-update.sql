-- Expense tracker schema update (non-destructive)

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  description VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_project_id ON expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

CREATE TABLE IF NOT EXISTS budget_extension_requests (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES users(id),
  requested_amount NUMERIC(18,2) NOT NULL CHECK (requested_amount > 0),
  amount_requested NUMERIC(18,2),
  justification TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  budget_before NUMERIC(18,2),
  spent_before NUMERIC(18,2),
  percent_used_before NUMERIC(6,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT
);

ALTER TABLE budget_extension_requests
  ADD COLUMN IF NOT EXISTS amount_requested NUMERIC(18,2);

UPDATE budget_extension_requests
SET amount_requested = requested_amount
WHERE amount_requested IS NULL AND requested_amount IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_budget_alerts (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  warned_75 BOOLEAN DEFAULT false,
  warned_100 BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_entries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  expense_date DATE NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expense_entries') THEN
    INSERT INTO expenses (project_id, user_id, description, category, amount, date, notes, created_at)
    SELECT project_id, created_by, description, category, amount, expense_date, notes, created_at
    FROM expense_entries
    WHERE NOT EXISTS (SELECT 1 FROM expenses);
  END IF;
END $$;
