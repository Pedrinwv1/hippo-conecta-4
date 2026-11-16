-- PostgreSQL schema for HIPPO CONECTA. JSON payloads preserve legacy fields.
BEGIN;
CREATE TABLE IF NOT EXISTS hc_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hc_users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hc_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS hc_channels (
  id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES hc_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, channel_type TEXT NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS hc_server_members (
  server_id TEXT NOT NULL REFERENCES hc_servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES hc_users(id) ON DELETE CASCADE,
  role TEXT, payload JSONB NOT NULL, PRIMARY KEY(server_id,user_id)
);
CREATE TABLE IF NOT EXISTS hc_messages (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ, payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS hc_messages_channel_created_idx ON hc_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hc_members_user_idx ON hc_server_members(user_id);
COMMIT;
