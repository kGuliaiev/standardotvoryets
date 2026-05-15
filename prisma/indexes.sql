-- Full-text search on standards (run after prisma migrate)
CREATE INDEX IF NOT EXISTS standards_search_idx ON standards
  USING GIN(to_tsvector('simple', code || ' ' || title));

-- Tasks by due date for overdue query
CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON tasks(due_date, status)
  WHERE status != 'DONE' AND status != 'CANCELLED';
