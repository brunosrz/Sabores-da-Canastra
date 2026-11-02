CREATE TABLE IF NOT EXISTS backup_restore_validation (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL
);
INSERT OR REPLACE INTO backup_restore_validation (id, status)
VALUES (1, 'restored');
