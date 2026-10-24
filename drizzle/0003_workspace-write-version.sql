-- Serialize snapshot-based financial writes, including general accounts without a project lock.
CREATE TABLE IF NOT EXISTS workspace_versions (
 owner TEXT PRIMARY KEY NOT NULL,
 version INTEGER NOT NULL DEFAULT 0
);
