'use strict';

const { db } = require('./db');
const { excerpt, positiveInt } = require('./utils');

function pagination(req, perPage, total) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const requested = positiveInt(req.query.page, 1);
  const page = Math.min(Math.max(1, requested), pageCount);
  return {
    page,
    pageCount,
    perPage,
    total,
    offset: (page - 1) * perPage,
    hasPrev: page > 1,
    hasNext: page < pageCount,
    prevPage: Math.max(1, page - 1),
    nextPage: Math.min(pageCount, page + 1),
  };
}

function placeholders(count) {
  return new Array(count).fill('?').join(', ');
}

function getCategory(id) {
  return db.prepare(
    `SELECT c.*,
      (SELECT COUNT(*) FROM topics t WHERE t.category_id = c.id AND t.is_deleted = 0) AS topic_count,
      (SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id
        WHERE t.category_id = c.id AND t.is_deleted = 0 AND p.is_deleted = 0) AS post_count
     FROM categories c WHERE c.id = ?`,
  ).get(id);
}

function getCategories() {
  return db.prepare(
    `SELECT c.*,
      (SELECT COUNT(*) FROM topics t WHERE t.category_id = c.id AND t.is_deleted = 0) AS topic_count,
      (SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id
        WHERE t.category_id = c.id AND t.is_deleted = 0 AND p.is_deleted = 0) AS post_count
     FROM categories c ORDER BY c.position ASC, c.id ASC`,
  ).all();
}

const TOPIC_SELECT = `
  SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
    u.username AS author_username, u.avatar_color AS author_avatar_color, u.avatar_emoji AS author_avatar_emoji, u.role AS author_role,
    COALESCE(lu.username, u.username) AS last_username,
    COALESCE(lu.avatar_color, u.avatar_color) AS last_avatar_color,
    COALESCE(lu.avatar_emoji, u.avatar_emoji) AS last_avatar_emoji
  FROM topics t
  JOIN categories c ON c.id = t.category_id
  JOIN users u ON u.id = t.user_id
  LEFT JOIN users lu ON lu.id = t.last_reply_user_id
`;

function getLatestTopicsInCategory(categoryId) {
  return db.prepare(
    `${TOPIC_SELECT} WHERE t.category_id = ? AND t.is_deleted = 0
     ORDER BY t.is_pinned DESC, t.last_reply_at DESC LIMIT 1`,
  ).get(categoryId);
}

function getTopics({ categoryId = null, sort = 'latest', limit = 20, offset = 0, userId = null, onlyPinned = false } = {}) {
  const where = ['t.is_deleted = 0'];
  const params = [];
  if (categoryId) {
    where.push('t.category_id = ?');
    params.push(categoryId);
  }
  if (userId) {
    where.push('t.user_id = ?');
    params.push(userId);
  }
  if (onlyPinned) where.push('t.is_pinned = 1');

  let order = 't.is_pinned DESC, t.last_reply_at DESC';
  if (sort === 'new') order = 't.is_pinned DESC, t.created_at DESC';
  if (sort === 'hot') order = 't.is_pinned DESC, (t.replies_count * 4 + t.views) DESC, t.last_reply_at DESC';

  return db.prepare(
    `${TOPIC_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
}

function countTopics({ categoryId = null, userId = null } = {}) {
  const where = ['is_deleted = 0'];
  const params = [];
  if (categoryId) {
    where.push('category_id = ?');
    params.push(categoryId);
  }
  if (userId) {
    where.push('user_id = ?');
    params.push(userId);
  }
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM topics WHERE ${where.join(' AND ')}`).get(...params).n);
}

function getTopic(id, { includeDeleted = false } = {}) {
  const condition = includeDeleted ? '' : 'AND t.is_deleted = 0';
  return db.prepare(`${TOPIC_SELECT} WHERE t.id = ? ${condition}`).get(id);
}

function getPost(id) {
  return db.prepare(
    `SELECT p.*, t.title AS topic_title, t.category_id, t.is_locked, t.user_id AS topic_user_id
     FROM posts p JOIN topics t ON t.id = p.topic_id WHERE p.id = ?`,
  ).get(id);
}

function topicPostCount(topicId) {
  return Number(
    db.prepare('SELECT COUNT(*) AS n FROM posts WHERE topic_id = ? AND is_deleted = 0').get(topicId).n,
  );
}

function getPostsPage(topicId, page, perPage) {
  const total = topicPostCount(topicId);
  const pager = pagination({ query: { page } }, perPage, total);
  const posts = db.prepare(
    `SELECT p.*, u.username, u.avatar_color, u.avatar_emoji, u.role, u.created_at AS user_created_at,
       u.is_banned, u.bio, u.signature
     FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.topic_id = ? AND p.is_deleted = 0
     ORDER BY p.created_at ASC, p.id ASC
     LIMIT ? OFFSET ?`,
  ).all(topicId, perPage, pager.offset);

  const replyIds = [...new Set(posts.map((p) => p.reply_to_post_id).filter(Boolean))];
  const quoted = new Map();
  if (replyIds.length) {
    const rows = db.prepare(
      `SELECT p.id, p.content, p.user_id, u.username
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id IN (${placeholders(replyIds.length)})`,
    ).all(...replyIds);
    for (const row of rows) quoted.set(row.id, row);
  }

  return { posts, total, pager, quoted };
}

function likesForViewer(postIds, userId) {
  if (!userId || !postIds.length) return new Set();
  const rows = db.prepare(
    `SELECT post_id FROM post_likes WHERE user_id = ? AND post_id IN (${placeholders(postIds.length)})`,
  ).all(userId, ...postIds);
  return new Set(rows.map((row) => row.post_id));
}

function getActiveUsers(limit = 8) {
  return db.prepare(
    `SELECT id, username, avatar_color, avatar_emoji, role, last_seen_at,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = users.id AND p.is_deleted = 0) AS post_count
     FROM users WHERE is_banned = 0
     ORDER BY last_seen_at DESC LIMIT ?`,
  ).all(limit);
}

function getHotTopics(limit = 6) {
  return db.prepare(
    `SELECT t.id, t.title, t.views, t.replies_count
     FROM topics t WHERE t.is_deleted = 0
     ORDER BY (t.replies_count * 5 + t.views) DESC, t.last_reply_at DESC LIMIT ?`,
  ).all(limit);
}

function getUserStats(userId) {
  const topics = Number(
    db.prepare('SELECT COUNT(*) AS n FROM topics WHERE user_id = ? AND is_deleted = 0').get(userId).n,
  );
  const posts = Number(
    db.prepare(
      `SELECT COUNT(*) AS n FROM posts p JOIN topics t ON t.id = p.topic_id
       WHERE p.user_id = ? AND p.is_deleted = 0 AND t.is_deleted = 0`,
    ).get(userId).n,
  );
  const likes = Number(
    db.prepare(
      `SELECT COALESCE(SUM(p.likes_count), 0) AS n FROM posts p
       JOIN topics t ON t.id = p.topic_id
       WHERE p.user_id = ? AND p.is_deleted = 0 AND t.is_deleted = 0`,
    ).get(userId).n,
  );
  return { topics, posts, likes };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

function searchTopics(term, limit = 30) {
  const like = `%${escapeLike(term)}%`;
  return db.prepare(
    `${TOPIC_SELECT}
     WHERE t.is_deleted = 0 AND (
       t.title LIKE ? ESCAPE '\\' OR EXISTS (
         SELECT 1 FROM posts p WHERE p.topic_id = t.id AND p.is_deleted = 0 AND p.content LIKE ? ESCAPE '\\'
       )
     )
     ORDER BY t.is_pinned DESC, t.last_reply_at DESC LIMIT ?`,
  ).all(like, like, limit);
}

function searchPosts(term, limit = 30) {
  const like = `%${escapeLike(term)}%`;
  return db.prepare(
    `SELECT p.*, u.username, u.avatar_color, u.avatar_emoji, u.role,
       t.title AS topic_title, t.is_deleted AS topic_deleted, c.name AS category_name
     FROM posts p
     JOIN users u ON u.id = p.user_id
     JOIN topics t ON t.id = p.topic_id
     JOIN categories c ON c.id = t.category_id
     WHERE p.is_deleted = 0 AND t.is_deleted = 0 AND p.content LIKE ? ESCAPE '\\'
     ORDER BY p.created_at DESC LIMIT ?`,
  ).all(like, limit);
}

/** A snippet around the first match, without Markdown syntax. */
function searchSnippet(content, term, length = 180) {
  const plain = excerpt(content, 100000);
  const lower = plain.toLowerCase();
  const index = lower.indexOf(String(term).toLowerCase());
  if (index === -1) return excerpt(plain, length);
  const start = Math.max(0, index - Math.floor(length / 3));
  const end = Math.min(plain.length, start + length);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

function uniqueMentions(content) {
  const names = new Set();
  const regex = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]{2,24})/gu;
  let match;
  while ((match = regex.exec(String(content || ''))) !== null) {
    names.add(match[2]);
  }
  return [...names];
}

function notifyTopicActivity({ topic, post, actor }) {
  const recipients = new Map(); // userId -> type
  if (topic.user_id !== actor.id) recipients.set(topic.user_id, 'reply');

  if (post.reply_to_post_id) {
    const quoted = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(post.reply_to_post_id);
    if (quoted && quoted.user_id !== actor.id) recipients.set(quoted.user_id, 'quote');
  }

  for (const name of uniqueMentions(post.content)) {
    const mentioned = db.prepare('SELECT id FROM users WHERE username = ? AND is_banned = 0').get(name);
    if (mentioned && mentioned.id !== actor.id) {
      recipients.set(mentioned.id, recipients.get(mentioned.id) === 'quote' ? 'quote' : 'mention');
    }
  }

  const insert = db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, topic_id, post_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  for (const [userId, type] of recipients) {
    if (userId === actor.id) continue;
    insert.run(userId, actor.id, type, topic.id, post.id, now);
  }
}

function getPinnedTopics(limit = 5) {
  return getTopics({ onlyPinned: true, limit, sort: 'latest' });
}

module.exports = {
  pagination,
  placeholders,
  getCategory,
  getCategories,
  getTopics,
  countTopics,
  getTopic,
  getPost,
  getPostsPage,
  likesForViewer,
  getLatestTopicsInCategory,
  getActiveUsers,
  getHotTopics,
  getUserStats,
  searchTopics,
  searchPosts,
  searchSnippet,
  notifyTopicActivity,
  getPinnedTopics,
  topicPostCount,
};
