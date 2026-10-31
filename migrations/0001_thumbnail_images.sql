CREATE TABLE IF NOT EXISTS thumbnail_images (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image_data BLOB NOT NULL CHECK (length(image_data) <= 1048576),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS thumbnail_images_team_id_idx
  ON thumbnail_images(team_id);
