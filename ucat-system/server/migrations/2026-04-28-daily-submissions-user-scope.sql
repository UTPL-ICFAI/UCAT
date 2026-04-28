DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'daily_submissions'::regclass
      AND conname = 'daily_submissions_project_id_template_id_submission_date_key'
  ) THEN
    ALTER TABLE daily_submissions
      DROP CONSTRAINT daily_submissions_project_id_template_id_submission_date_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'daily_submissions'::regclass
      AND conname = 'daily_submissions_project_id_template_id_submitted_by_submission_date_key'
  ) THEN
    ALTER TABLE daily_submissions
      ADD CONSTRAINT daily_submissions_project_id_template_id_submitted_by_submission_date_key
      UNIQUE (project_id, template_id, submitted_by, submission_date);
  END IF;
END $$;
