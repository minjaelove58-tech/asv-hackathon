-- Core application schema. This migration is intentionally idempotent so it can
-- be applied to an existing D1 database without removing any user data.

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_number INTEGER NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  access_code_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  game_url TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'published')),
  submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_token TEXT NOT NULL UNIQUE,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id INTEGER NOT NULL UNIQUE REFERENCES visitors(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS submissions_team_id_idx ON submissions(team_id);
CREATE INDEX IF NOT EXISTS votes_team_id_idx ON votes(team_id);
CREATE INDEX IF NOT EXISTS admin_logs_admin_id_idx ON admin_logs(admin_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('plaza_open', 'false'),
  ('voting_open', 'false'),
  ('submission_open', 'false'),
  ('results_public', 'false');
