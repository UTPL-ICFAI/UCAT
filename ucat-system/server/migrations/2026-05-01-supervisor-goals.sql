CREATE TABLE IF NOT EXISTS supervisor_goals (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  assigned_to INTEGER REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  due_date DATE,
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supervisor_goals_project_id ON supervisor_goals(project_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_goals_assigned_to ON supervisor_goals(assigned_to);
CREATE INDEX IF NOT EXISTS idx_supervisor_goals_assigned_by ON supervisor_goals(assigned_by);
