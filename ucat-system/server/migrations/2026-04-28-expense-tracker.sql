-- Expense tracker tables

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

CREATE INDEX IF NOT EXISTS idx_expense_entries_project_id ON expense_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_expense_entries_expense_date ON expense_entries(expense_date);
CREATE INDEX IF NOT EXISTS idx_expense_entries_created_by ON expense_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_expense_entries_category ON expense_entries(category);

CREATE TABLE IF NOT EXISTS budget_extension_requests (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES users(id),
  requested_amount NUMERIC(18,2) NOT NULL CHECK (requested_amount > 0),
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

CREATE INDEX IF NOT EXISTS idx_budget_extension_requests_project_id ON budget_extension_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_extension_requests_status ON budget_extension_requests(status);
CREATE INDEX IF NOT EXISTS idx_budget_extension_requests_requested_by ON budget_extension_requests(requested_by);

CREATE TABLE IF NOT EXISTS project_budget_alerts (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  warned_75 BOOLEAN DEFAULT false,
  warned_100 BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);
