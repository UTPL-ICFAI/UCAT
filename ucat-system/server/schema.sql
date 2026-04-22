-- UCAT Construction Analysis Tracker System - PostgreSQL Schema

-- Drop existing objects (cascade deletes)
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS communications CASCADE;
DROP TABLE IF EXISTS daily_budget_tracking CASCADE;
DROP TABLE IF EXISTS troubleshoot_issues CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS site_images CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS workers CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS project_assignments CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  age INTEGER CHECK (age >= 1 AND age <= 99),
  gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other')),
  employment_id VARCHAR(50) UNIQUE NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('superadmin','project_manager','site_engineer','supervisor')),
  user_id VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_user_id ON users(user_id);

-- Create projects table
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  location TEXT,
  city VARCHAR(100),
  description TEXT,
  work_status VARCHAR(50) DEFAULT 'active' CHECK (work_status IN ('active', 'past', 'ongoing', 'completed')),
  start_date DATE,
  end_date DATE,
  contractor_name VARCHAR(200),
  contractor_details JSONB DEFAULT '{}',
  contractor_contact VARCHAR(20),
  contractor_license VARCHAR(100),
  contractor_insurance_number VARCHAR(100),
  total_budget NUMERIC(18,2),
  budget_allocated NUMERIC(18,2),
  insurance_details JSONB DEFAULT '{}',
  safety_certifications JSONB DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_projects_created_by ON projects(created_by);

-- Create project assignments table
CREATE TABLE project_assignments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_assignments_project_id ON project_assignments(project_id);
CREATE INDEX idx_project_assignments_user_id ON project_assignments(user_id);

-- Create tasks table
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  assigned_to INTEGER REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  due_date DATE,
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','overdue')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);

-- Create workers table
CREATE TABLE workers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other')),
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  supervisor_id INTEGER REFERENCES users(id),
  site_engineer_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_workers_project_id ON workers(project_id);
CREATE INDEX idx_workers_supervisor_id ON workers(supervisor_id);

-- Create attendance table
CREATE TABLE attendance (
  id SERIAL PRIMARY KEY,
  worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id),
  supervisor_id INTEGER REFERENCES users(id),
  date DATE NOT NULL,
  status VARCHAR(10) CHECK (status IN ('present','absent','half_day')),
  marked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(worker_id, date)
);

CREATE INDEX idx_attendance_worker_id ON attendance(worker_id);
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_worker_date ON attendance(worker_id, date);

-- Create site images table
CREATE TABLE site_images (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id),
  file_path TEXT NOT NULL,
  original_name TEXT,
  description TEXT,
  upload_timestamp TIMESTAMPTZ DEFAULT now(),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);

CREATE INDEX idx_site_images_project_id ON site_images(project_id);
CREATE INDEX idx_site_images_status ON site_images(status);
CREATE INDEX idx_site_images_project_status ON site_images(project_id, status);

-- Create documents table
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id),
  title VARCHAR(200),
  file_path TEXT NOT NULL,
  original_name TEXT,
  doc_type VARCHAR(50),
  revision_no VARCHAR(20),
  drawing_no VARCHAR(50),
  discipline VARCHAR(100),
  sub_discipline VARCHAR(100),
  design_status VARCHAR(50),
  doc_status VARCHAR(50),
  package VARCHAR(100),
  corridor VARCHAR(100),
  category VARCHAR(100),
  confidential BOOLEAN DEFAULT false,
  revision_date DATE,
  doc_date DATE,
  weightage NUMERIC(5,2),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_documents_project_id ON documents(project_id);

-- Create troubleshoot issues table
CREATE TABLE troubleshoot_issues (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  raised_by INTEGER REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','escalated','resolved')),
  escalated_to INTEGER REFERENCES users(id),
  escalated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_troubleshoot_issues_project_id ON troubleshoot_issues(project_id);
CREATE INDEX idx_troubleshoot_issues_status ON troubleshoot_issues(status);
CREATE INDEX idx_troubleshoot_issues_project_status ON troubleshoot_issues(project_id, status);

-- Create daily budget tracking table
CREATE TABLE daily_budget_tracking (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  recorded_by INTEGER REFERENCES users(id),
  date DATE NOT NULL,
  amount_spent NUMERIC(18,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_daily_budget_tracking_project_id ON daily_budget_tracking(project_id);

-- Create communications table
CREATE TABLE communications (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_communications_project_id ON communications(project_id);

-- Create templates table
CREATE TABLE templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  template_type VARCHAR(20) NOT NULL DEFAULT 'form' CHECK (template_type IN ('form', 'table')),
  fields JSONB NOT NULL DEFAULT '[]',
  rows JSONB DEFAULT '[]',
  columns JSONB DEFAULT '[]',
  row_limit INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pushed' CHECK (status IN ('draft','scheduled','pushed')),
  scheduled_at TIMESTAMPTZ,
  scheduled_config JSONB,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_templates_user_id ON templates(user_id);
CREATE INDEX idx_templates_is_active ON templates(is_active);
CREATE INDEX idx_templates_is_default ON templates(is_default);

-- Create project_templates junction table (multiple templates per project)
CREATE TABLE project_templates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  repetition_type VARCHAR(20) DEFAULT 'daily' CHECK (repetition_type IN ('daily', 'weekly', 'monthly', 'custom')),
  repetition_days JSONB DEFAULT '["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]',
  is_active BOOLEAN DEFAULT true,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, template_id)
);

CREATE INDEX idx_project_templates_project_id ON project_templates(project_id);
CREATE INDEX idx_project_templates_template_id ON project_templates(template_id);

-- Create daily_submissions table (site engineer submits filled templates)
CREATE TABLE daily_submissions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES templates(id) ON DELETE CASCADE,
  submitted_by INTEGER REFERENCES users(id),
  submission_date DATE NOT NULL,
  data JSONB NOT NULL,
  template_snapshot JSONB NOT NULL DEFAULT '{}',
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  review_comment TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, template_id, submission_date)
);

CREATE INDEX idx_daily_submissions_project_id ON daily_submissions(project_id);
CREATE INDEX idx_daily_submissions_template_id ON daily_submissions(template_id);
CREATE INDEX idx_daily_submissions_submitted_by ON daily_submissions(submitted_by);
CREATE INDEX idx_daily_submissions_date ON daily_submissions(submission_date);

-- Create daily_workers table (site engineer adds daily labour workers)
CREATE TABLE daily_workers (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  added_by INTEGER REFERENCES users(id),
  worker_name VARCHAR(150) NOT NULL,
  gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other')),
  worker_category VARCHAR(100),
  attendance_marked BOOLEAN DEFAULT false,
  attendance_marked_by INTEGER REFERENCES users(id),
  attendance_marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, work_date, worker_name)
);

CREATE INDEX idx_daily_workers_project_id ON daily_workers(project_id);
CREATE INDEX idx_daily_workers_date ON daily_workers(work_date);
-- Create permissions table
CREATE TABLE permissions (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
  can_view_documents BOOLEAN DEFAULT false,
  can_upload_documents BOOLEAN DEFAULT false,
  can_view_images BOOLEAN DEFAULT false,
  can_create_tasks BOOLEAN DEFAULT false,
  can_view_reports BOOLEAN DEFAULT false,
  can_manage_workers BOOLEAN DEFAULT false
);
