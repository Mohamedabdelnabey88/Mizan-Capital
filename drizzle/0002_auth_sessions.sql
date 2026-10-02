CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  workspace TEXT NOT NULL,
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER NOT NULL
);
