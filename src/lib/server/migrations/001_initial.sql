-- Initial schema for Maude chat application.
-- All timestamps are Unix epoch milliseconds (INTEGER).
-- Using IF NOT EXISTS makes this migration idempotent — safe to re-run on every startup.

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT    PRIMARY KEY,
  title      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
  content         TEXT    NOT NULL,
  thinking        TEXT,            -- nullable; populated only for assistant messages with <think> blocks
  created_at      INTEGER NOT NULL
);

-- Enable cascade deletes for messages when a conversation is removed.
-- better-sqlite3 does not enable foreign keys by default; db.ts must run
-- PRAGMA foreign_keys = ON after opening the connection.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed defaults so getSettings() always returns a complete record.
INSERT OR IGNORE INTO settings (key, value) VALUES ('name', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('personalizationPrompt', '');
