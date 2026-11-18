-- OpenBBS database schema (migration 1)
-- Timestamps are Unix epoch milliseconds (INTEGER).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  email         TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'moderator', 'member')),
  bio           TEXT    NOT NULL DEFAULT '',
  signature     TEXT    NOT NULL DEFAULT '',
  avatar_emoji  TEXT    NOT NULL DEFAULT '',
  avatar_color  TEXT    NOT NULL DEFAULT '',
  is_banned     INTEGER NOT NULL DEFAULT 0,
  ban_reason    TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  last_ip       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT    NOT NULL DEFAULT '',
  user_agent TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT '💬',
  color       TEXT    NOT NULL DEFAULT '#6366f1',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id        INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT    NOT NULL,
  is_pinned          INTEGER NOT NULL DEFAULT 0,
  is_locked          INTEGER NOT NULL DEFAULT 0,
  is_deleted         INTEGER NOT NULL DEFAULT 0,
  views              INTEGER NOT NULL DEFAULT 0,
  replies_count      INTEGER NOT NULL DEFAULT 0,
  last_reply_at      INTEGER NOT NULL,
  last_reply_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id         INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content          TEXT    NOT NULL,
  is_first         INTEGER NOT NULL DEFAULT 0,
  is_deleted       INTEGER NOT NULL DEFAULT 0,
  reply_to_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  likes_count      INTEGER NOT NULL DEFAULT 0,
  edited_count     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  topic_id   INTEGER REFERENCES topics(id) ON DELETE CASCADE,
  post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_topics_category ON topics(category_id, is_deleted, is_pinned DESC, last_reply_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_latest ON topics(is_deleted, is_pinned DESC, last_reply_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_author ON topics(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_topic ON posts(topic_id, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_reply_to ON posts(reply_to_post_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_post ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);
