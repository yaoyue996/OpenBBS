'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { config } = require('./config');
const { hashPassword, generatePassword } = require('./passwords');
const { validateUsername } = require('./utils');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new DatabaseSync(config.databasePath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA synchronous = NORMAL;');

const migrations = [
  {
    version: 1,
    sql: fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'),
  },
];

function currentVersion() {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row.user_version || 0);
}

function migrate() {
  const version = currentVersion();
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

migrate();

const DEFAULT_SETTINGS = {
  site_name: config.siteName,
  site_description: config.siteDescription,
  site_announcement: [
    '欢迎来到 **OpenBBS**！这里是一个自由、开放、友善的交流社区。',
    '',
    '- 尊重他人，理性讨论，友善交流',
    '- 分享你的见解、经验与作品',
    '- 遇到问题请先搜索，再发帖提问',
    '',
    '> 管理员可以在「后台 → 站点设置」中修改这条公告。',
  ].join('\n'),
  footer_text: 'Powered by OpenBBS · 开源社区系统',
  registration_open: '1',
  topics_per_page: '20',
  posts_per_page: '20',
  post_cooldown: '15',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSetting.run(key, value);
}

let settingsCache = null;

function getSettings(force = false) {
  if (!settingsCache || force) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    settingsCache = { ...DEFAULT_SETTINGS };
    for (const row of rows) settingsCache[row.key] = row.value;
  }
  return settingsCache;
}

function getSetting(key, fallback = '') {
  const settings = getSettings();
  return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(String(key), String(value ?? ''));
  settingsCache = null;
}

function setSettings(values) {
  const statement = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, value] of Object.entries(values)) statement.run(String(key), String(value ?? ''));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  settingsCache = null;
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw error;
  }
}

const CATEGORY_SEED = [
  { name: '站务公告', description: '社区公告、规则与意见反馈', icon: '📢', color: '#f59e0b' },
  { name: '综合讨论', description: '天南海北，畅所欲言', icon: '💬', color: '#6366f1' },
  { name: '技术分享', description: '编程、开源、数码与折腾', icon: '🧑‍💻', color: '#06b6d4' },
  { name: '问答求助', description: '遇到问题？这里有人帮你', icon: '💡', color: '#ec4899' },
  { name: '资源分享', description: '好物、教程与实用工具', icon: '📦', color: '#8b5cf6' },
  { name: '闲聊灌水', description: '摸鱼、生活与灵感', icon: '☕', color: '#10b981' },
];

const ADMIN_CREDENTIALS_FILE = path.join(path.dirname(config.databasePath), 'initial-admin.txt');

async function seedCategories() {
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n);
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO categories (name, description, icon, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const now = Date.now();
  CATEGORY_SEED.forEach((category, index) => {
    insert.run(category.name, category.description, category.icon, category.color, index, now);
  });
}

function seedWelcome(admin) {
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM topics').get().n);
  if (count > 0) return;
  const category = db.prepare('SELECT * FROM categories ORDER BY position ASC, id ASC LIMIT 1').get();
  if (!category) return;
  const now = Date.now();
  const content = [
    `# 欢迎来到 ${getSetting('site_name', 'OpenBBS')} 👋`,
    '',
    '这是一个由 **OpenBBS** 驱动的开源社区。你可以在这里分享见解、提出疑问、记录折腾过程，或者只是随便聊聊。',
    '',
    '## 你可以做什么',
    '',
    '- 在 **综合讨论** 中开启一个话题',
    '- 在 **技术分享** 中写下你的经验',
    '- 在 **问答求助** 中寻求帮助，也别忘了帮助别人',
    '- 喜欢的内容可以收藏，有价值的回复可以点赞',
    '',
    '## 给管理员的小提示',
    '',
    '- 后台入口：`/admin`，可以管理分类、用户、内容和站点设置',
    '- 请尽快在 **个人设置** 中修改初始管理员密码',
    '- 支持 Markdown：**粗体**、*斜体*、`代码`、列表、引用和代码块',
    '',
    '> 保持友善，享受交流。',
  ].join('\n');
  transaction(() => {
    const topic = db.prepare(
      `INSERT INTO topics (category_id, user_id, title, is_pinned, last_reply_at, last_reply_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
    ).run(category.id, admin.id, `欢迎来到 ${getSetting('site_name', 'OpenBBS')} 👋`, now, admin.id, now, now);
    const topicId = Number(topic.lastInsertRowid);
    db.prepare(
      `INSERT INTO posts (topic_id, user_id, content, is_first, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(topicId, admin.id, content, now, now);
  });
}

let seedPromise = null;

/**
 * Create the first administrator and initial content. Safe to call repeatedly;
 * only performs work when the users table is empty.
 */
function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    seedCategories();
    const userCount = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n);
    if (userCount > 0) return { created: false };

    let username = String(config.adminUsername || 'admin').trim();
    if (!validateUsername(username)) {
      username = 'admin';
    }
    const email = config.adminEmail || 'admin@example.com';
    const generated = !config.adminPassword;
    const password = config.adminPassword || generatePassword(16);
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    const result = transaction(() => {
      const insert = db.prepare(
        `INSERT INTO users (username, email, password_hash, role, created_at, last_seen_at)
         VALUES (?, ?, ?, 'admin', ?, ?)`,
      );
      const info = insert.run(username, email, passwordHash, now, now);
      return Number(info.lastInsertRowid);
    });

    const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(result);
    seedWelcome(admin);

    if (generated) {
      const body = [
        'OpenBBS 初始管理员账户',
        '========================',
        `用户名: ${username}`,
        `密码:   ${password}`,
        `登录:   ${config.siteUrl}/login`,
        '',
        '请在登录后立即在「个人设置」中修改密码。',
        '修改密码后此文件会被自动删除。',
        '',
      ].join('\n');
      fs.writeFileSync(ADMIN_CREDENTIALS_FILE, body, { mode: 0o600 });
      console.log('');
      console.log('  ┌──────────────────────────────────────────────────────┐');
      console.log('  │  OpenBBS 初始管理员账户                              │');
      console.log('  └──────────────────────────────────────────────────────┘');
      console.log(`     用户名: ${username}`);
      console.log(`     密  码: ${password}`);
      console.log(`     凭据文件: ${ADMIN_CREDENTIALS_FILE}`);
      console.log('     请登录后立即修改密码。');
      console.log('');
    } else {
      console.log(`[openbbs] 已创建管理员账户 "${username}"（密码来自 ADMIN_PASSWORD）。`);
    }

    return { created: true, username, generated, credentialsFile: generated ? ADMIN_CREDENTIALS_FILE : null };
  })();
  return seedPromise;
}

function removeAdminCredentialsFile() {
  try {
    if (fs.existsSync(ADMIN_CREDENTIALS_FILE)) fs.unlinkSync(ADMIN_CREDENTIALS_FILE);
  } catch {
    /* non-fatal */
  }
}

function cleanupExpiredSessions() {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
}

function getStats() {
  const users = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n);
  const topics = Number(db.prepare('SELECT COUNT(*) AS n FROM topics WHERE is_deleted = 0').get().n);
  const posts = Number(
    db.prepare(
      'SELECT COUNT(*) AS n FROM posts p JOIN topics t ON t.id = p.topic_id WHERE p.is_deleted = 0 AND t.is_deleted = 0',
    ).get().n,
  );
  const online = Number(
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE last_seen_at > ?').get(Date.now() - 15 * 60 * 1000).n,
  );
  const newest = db.prepare('SELECT id, username, avatar_color, avatar_emoji, created_at FROM users ORDER BY id DESC LIMIT 1').get();
  return { users, topics, posts, online, newest };
}

module.exports = {
  db,
  DEFAULT_SETTINGS,
  ADMIN_CREDENTIALS_FILE,
  transaction,
  getSettings,
  getSetting,
  setSetting,
  setSettings,
  ensureSeed,
  removeAdminCredentialsFile,
  cleanupExpiredSessions,
  getStats,
  migrate,
};
