/** Hand-written, ordered migrations. Append new entries; never edit applied ones. */
export const migrations: { id: string; sql: string }[] = [
  {
    id: '0001_init',
    sql: `
CREATE TABLE guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_e164 TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  consent_at INTEGER,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL
);
CREATE INDEX visits_guest_time_idx ON visits (guest_id, visited_at);
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  thumb_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','hidden')),
  featured_until INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX photos_status_idx ON photos (status, created_at);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tvs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  last_seen_at INTEGER,
  last_photo_id INTEGER,
  user_agent TEXT
);
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER NOT NULL
);
`,
  },
];
