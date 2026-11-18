'use strict';

const express = require('express');
const { db, getSettings, getSetting, transaction } = require('../db');
const { renderMarkdown } = require('../markdown');
const {
  HTTPError,
  requireLogin,
  requireModerator,
  rateLimit,
  backUrl,
} = require('../middleware');
const {
  getCategories,
  getCategory,
  getTopic,
  getPost,
  getPostsPage,
  likesForViewer,
  pagination,
  notifyTopicActivity,
  topicPostCount,
} = require('../services');
const { toInt, excerpt, timeAgo } = require('../utils');

const router = express.Router();

const postLimiter = rateLimit({
  scope: 'post',
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: '发帖过于频繁，请稍后再试。',
});

const topicLimiter = rateLimit({
  scope: 'topic',
  windowMs: 30 * 60 * 1000,
  max: 10,
  message: '发布主题过于频繁，请稍后再试。',
});

function wantsJson(req) {
  return req.get('accept')?.includes('application/json') || req.get('x-requested-with') === 'fetch';
}

function notFound(message = '页面不存在。') {
  return new HTTPError(404, message);
}

function postPage(topicId, postId, perPage) {
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM posts WHERE topic_id = ? AND is_deleted = 0 AND id <= ?',
  ).get(topicId, postId);
  return Math.max(1, Math.ceil(Number(row.n) / perPage));
}

function cooldownRemaining(user) {
  if (!user || ['admin', 'moderator'].includes(user.role)) return 0;
  const seconds = Math.max(0, toInt(getSetting('post_cooldown', '15'), 15));
  if (!seconds) return 0;
  const row = db.prepare('SELECT MAX(created_at) AS ts FROM posts WHERE user_id = ? AND is_deleted = 0').get(user.id);
  if (!row || !row.ts) return 0;
  const remaining = Number(row.ts) + seconds * 1000 - Date.now();
  return Math.max(0, remaining);
}

function softDeleteTopic(topic) {
  db.prepare('UPDATE topics SET is_deleted = 1, updated_at = ? WHERE id = ?').run(Date.now(), topic.id);
}

router.get('/new', requireLogin, (req, res) => {
  const categories = getCategories();
  const selectedCategory = toInt(req.query.category, 0);
  res.render('new-topic', {
    page: 'new-topic',
    pageTitle: '发布新主题',
    metaDescription: '在社区中发起一个新的讨论',
    categories,
    selectedCategory,
    error: null,
    values: { title: '', content: '' },
  });
});

router.post('/topics', requireLogin, topicLimiter, (req, res) => {
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  const categoryId = toInt(req.body.category_id, 0);
  const categories = getCategories();
  const values = { title, content };

  const renderError = (message, status = 400) => res.status(status).render('new-topic', {
    page: 'new-topic',
    pageTitle: '发布新主题',
    metaDescription: '在社区中发起一个新的讨论',
    categories,
    selectedCategory: categoryId,
    error: message,
    values,
  });

  if (title.length < 4 || title.length > 120) return renderError('标题长度需为 4–120 个字符。');
  if (content.length < 2 || content.length > 50000) return renderError('内容长度需为 2–50000 个字符。');
  const category = getCategory(categoryId);
  if (!category) return renderError('请选择一个有效的分类。');

  const remaining = cooldownRemaining(req.user);
  if (remaining > 0) {
    return renderError(`发帖冷却中，请在 ${Math.ceil(remaining / 1000)} 秒后重试。`, 429);
  }

  const now = Date.now();
  const topicId = transaction(() => {
    const topicInfo = db.prepare(
      `INSERT INTO topics (category_id, user_id, title, last_reply_at, last_reply_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(category.id, req.user.id, title, now, req.user.id, now, now);
    const id = Number(topicInfo.lastInsertRowid);
    db.prepare(
      `INSERT INTO posts (topic_id, user_id, content, is_first, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(id, req.user.id, content, now, now);
    return id;
  });

  const topic = db.prepare('SELECT id, user_id FROM topics WHERE id = ?').get(topicId);
  const post = db.prepare('SELECT * FROM posts WHERE topic_id = ? AND is_first = 1').get(topicId);
  notifyTopicActivity({ topic, post, actor: req.user });

  res.setFlash('success', '主题发布成功。');
  res.redirect(`/t/${topicId}`);
});

router.get('/t/:id', (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const topic = getTopic(id);
    if (!topic) throw notFound('主题不存在或已被删除。');

    const settings = getSettings();
    const perPage = Math.min(100, Math.max(5, toInt(settings.posts_per_page, 20)));
    const { posts, total, pager, quoted } = getPostsPage(id, req.query.page, perPage);
    const liked = likesForViewer(posts.map((post) => post.id), req.user ? req.user.id : 0);

    let bookmarked = false;
    if (req.user) {
      bookmarked = Boolean(
        db.prepare('SELECT 1 AS found FROM bookmarks WHERE topic_id = ? AND user_id = ?').get(id, req.user.id),
      );
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND topic_id = ? AND is_read = 0')
        .run(req.user.id, id);
    }

    db.prepare('UPDATE topics SET views = views + 1 WHERE id = ?').run(id);
    topic.views = Number(topic.views) + 1;

    const quoteId = toInt(req.query.quote, 0);
    let quotePost = null;
    if (quoteId) {
      quotePost = db.prepare(
        `SELECT p.id, p.content, u.username FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.id = ? AND p.topic_id = ? AND p.is_deleted = 0`,
      ).get(quoteId, id);
    }
    const quoteText = quotePost
      ? `> @${quotePost.username}: ${excerpt(quotePost.content, 220).replace(/\n+/g, ' ')}\n\n`
      : '';

    res.render('topic', {
      page: 'topic',
      pageTitle: topic.title,
      metaDescription: excerpt(posts.find((p) => p.is_first)?.content || topic.title, 160),
      topic,
      posts,
      pager,
      totalPosts: total,
      quoted,
      liked,
      bookmarked,
      quotePost,
      quoteText,
      perPage,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/p/:id', (req, res, next) => {
  try {
    const post = getPost(toInt(req.params.id, 0));
    if (!post || post.is_deleted) throw notFound('回复不存在。');
    const topic = getTopic(post.topic_id);
    if (!topic) throw notFound('主题不存在或已被删除。');
    const perPage = Math.min(100, Math.max(5, toInt(getSettings().posts_per_page, 20)));
    const page = postPage(topic.id, post.id, perPage);
    return res.redirect(`/t/${topic.id}?page=${page}#post-${post.id}`);
  } catch (error) {
    return next(error);
  }
});

router.post('/t/:id/reply', requireLogin, postLimiter, (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const topic = getTopic(id);
    if (!topic) throw notFound('主题不存在或已被删除。');
    if (topic.is_locked && !['admin', 'moderator'].includes(req.user.role)) {
      throw new HTTPError(403, '该主题已被锁定，无法回复。');
    }

    const content = String(req.body.content || '').trim();
    if (content.length < 2 || content.length > 50000) {
      res.setFlash('error', '回复内容长度需为 2–50000 个字符。');
      return res.redirect(`/t/${id}#reply`);
    }

    const remaining = cooldownRemaining(req.user);
    if (remaining > 0) {
      res.setFlash('error', `发帖冷却中，请在 ${Math.ceil(remaining / 1000)} 秒后重试。`);
      return res.redirect(`/t/${id}#reply`);
    }

    let replyToPostId = toInt(req.body.reply_to_post_id, 0) || null;
    if (replyToPostId) {
      const target = db.prepare('SELECT id FROM posts WHERE id = ? AND topic_id = ? AND is_deleted = 0')
        .get(replyToPostId, id);
      if (!target) replyToPostId = null;
    }

    const now = Date.now();
    const postId = transaction(() => {
      const info = db.prepare(
        `INSERT INTO posts (topic_id, user_id, content, is_first, reply_to_post_id, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
      ).run(id, req.user.id, content, replyToPostId, now, now);
      db.prepare(
        `UPDATE topics SET replies_count = replies_count + 1, last_reply_at = ?, last_reply_user_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(now, req.user.id, now, id);
      return Number(info.lastInsertRowid);
    });

    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
    notifyTopicActivity({ topic, post, actor: req.user });

    const updated = db.prepare('SELECT replies_count FROM topics WHERE id = ?').get(id);
    const perPage = Math.min(100, Math.max(5, toInt(getSettings().posts_per_page, 20)));
    const page = Math.max(1, Math.ceil((Number(updated.replies_count) + 1) / perPage));
    res.redirect(`/t/${id}?page=${page}#post-${postId}`);
  } catch (error) {
    next(error);
  }
});

router.post('/t/:id/bookmark', requireLogin, (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const topic = getTopic(id);
    if (!topic) throw notFound('主题不存在或已被删除。');

    const existing = db.prepare('SELECT 1 AS found FROM bookmarks WHERE topic_id = ? AND user_id = ?')
      .get(id, req.user.id);
    let bookmarked;
    if (existing) {
      db.prepare('DELETE FROM bookmarks WHERE topic_id = ? AND user_id = ?').run(id, req.user.id);
      bookmarked = false;
    } else {
      db.prepare('INSERT INTO bookmarks (topic_id, user_id, created_at) VALUES (?, ?, ?)')
        .run(id, req.user.id, Date.now());
      bookmarked = true;
    }
    if (wantsJson(req)) return res.json({ ok: true, bookmarked });
    res.setFlash('success', bookmarked ? '已收藏该主题。' : '已取消收藏。');
    return res.redirect(`/t/${id}`);
  } catch (error) {
    return next(error);
  }
});

router.post('/posts/:id/like', requireLogin, (req, res, next) => {
  try {
    const post = getPost(toInt(req.params.id, 0));
    if (!post || post.is_deleted) throw notFound('回复不存在。');
    const topic = getTopic(post.topic_id);
    if (!topic) throw notFound('主题不存在或已被删除。');

    const existing = db.prepare('SELECT 1 AS found FROM post_likes WHERE post_id = ? AND user_id = ?')
      .get(post.id, req.user.id);
    let liked;
    if (existing) {
      db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
      liked = false;
    } else {
      db.prepare('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)')
        .run(post.id, req.user.id, Date.now());
      liked = true;
    }
    const count = Number(db.prepare('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?').get(post.id).n);
    db.prepare('UPDATE posts SET likes_count = ? WHERE id = ?').run(count, post.id);

    if (wantsJson(req)) return res.json({ ok: true, liked, count });
    return res.redirect(`/t/${post.topic_id}#post-${post.id}`);
  } catch (error) {
    return next(error);
  }
});

router.get('/posts/:id/edit', requireLogin, (req, res, next) => {
  try {
    const post = getPost(toInt(req.params.id, 0));
    if (!post || post.is_deleted) throw notFound('回复不存在。');
    const topic = getTopic(post.topic_id, { includeDeleted: req.user.role === 'admin' });
    if (!topic) throw notFound('主题不存在或已被删除。');
    if (post.user_id !== req.user.id && !['admin', 'moderator'].includes(req.user.role)) {
      throw new HTTPError(403, '你不能编辑这条回复。');
    }
    return res.render('edit-post', {
      page: 'edit-post',
      pageTitle: '编辑内容',
      metaDescription: '编辑帖子内容',
      post,
      topic,
      isFirst: Boolean(post.is_first),
      error: null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/posts/:id/edit', requireLogin, (req, res, next) => {
  try {
    const post = getPost(toInt(req.params.id, 0));
    if (!post || post.is_deleted) throw notFound('回复不存在。');
    const topic = getTopic(post.topic_id, { includeDeleted: req.user.role === 'admin' });
    if (!topic) throw notFound('主题不存在或已被删除。');
    if (post.user_id !== req.user.id && !['admin', 'moderator'].includes(req.user.role)) {
      throw new HTTPError(403, '你不能编辑这条回复。');
    }

    const content = String(req.body.content || '').trim();
    let title = String(req.body.title || '').trim();
    const renderError = (message) => res.status(400).render('edit-post', {
      page: 'edit-post',
      pageTitle: '编辑内容',
      metaDescription: '编辑帖子内容',
      post: { ...post, content },
      topic: { ...topic, title: title || topic.title },
      isFirst: Boolean(post.is_first),
      error: message,
    });

    if (content.length < 2 || content.length > 50000) return renderError('内容长度需为 2–50000 个字符。');
    if (post.is_first) {
      if (title.length < 4 || title.length > 120) return renderError('标题长度需为 4–120 个字符。');
    } else {
      title = topic.title;
    }

    const now = Date.now();
    transaction(() => {
      db.prepare(
        'UPDATE posts SET content = ?, edited_count = edited_count + 1, updated_at = ? WHERE id = ?',
      ).run(content, now, post.id);
      if (post.is_first) {
        db.prepare('UPDATE topics SET title = ?, updated_at = ? WHERE id = ?').run(title, now, post.topic_id);
      }
    });

    const perPage = Math.min(100, Math.max(5, toInt(getSettings().posts_per_page, 20)));
    const page = postPage(post.topic_id, post.id, perPage);
    res.setFlash('success', '内容已更新。');
    return res.redirect(`/t/${post.topic_id}?page=${page}#post-${post.id}`);
  } catch (error) {
    return next(error);
  }
});

router.post('/posts/:id/delete', requireLogin, (req, res, next) => {
  try {
    const post = getPost(toInt(req.params.id, 0));
    if (!post || post.is_deleted) throw notFound('回复不存在。');
    if (post.user_id !== req.user.id && !['admin', 'moderator'].includes(req.user.role)) {
      throw new HTTPError(403, '你不能删除这条回复。');
    }
    const topic = getTopic(post.topic_id, { includeDeleted: req.user.role === 'admin' });
    if (!topic) throw notFound('主题不存在或已被删除。');

    if (post.is_first) {
      softDeleteTopic(topic);
      res.setFlash('success', '主题已删除。');
      return res.redirect(`/c/${topic.category_id}`);
    }

    const now = Date.now();
    transaction(() => {
      db.prepare('UPDATE posts SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, post.id);
      const remaining = Number(
        db.prepare('SELECT COUNT(*) AS n FROM posts WHERE topic_id = ? AND is_deleted = 0').get(post.topic_id).n,
      );
      const latest = db.prepare(
        `SELECT user_id, created_at FROM posts WHERE topic_id = ? AND is_deleted = 0
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      ).get(post.topic_id);
      db.prepare(
        `UPDATE topics SET replies_count = ?, last_reply_at = ?, last_reply_user_id = ?, updated_at = ? WHERE id = ?`,
      ).run(
        Math.max(0, remaining - 1),
        latest ? latest.created_at : topic.created_at,
        latest ? latest.user_id : topic.user_id,
        now,
        topic.id,
      );
    });
    res.setFlash('success', '回复已删除。');
    return res.redirect(`/t/${topic.id}`);
  } catch (error) {
    return next(error);
  }
});

router.post('/t/:id/delete', requireLogin, (req, res, next) => {
  try {
    const topic = getTopic(toInt(req.params.id, 0));
    if (!topic) throw notFound('主题不存在或已被删除。');
    if (topic.user_id !== req.user.id && !['admin', 'moderator'].includes(req.user.role)) {
      throw new HTTPError(403, '你不能删除该主题。');
    }
    softDeleteTopic(topic);
    res.setFlash('success', '主题已删除。');
    return res.redirect(`/c/${topic.category_id}`);
  } catch (error) {
    return next(error);
  }
});

router.post('/t/:id/moderate', requireLogin, requireModerator, (req, res, next) => {
  try {
    const topic = getTopic(toInt(req.params.id, 0));
    if (!topic) throw notFound('主题不存在或已被删除。');
    const action = String(req.body.action || '');
    const now = Date.now();
    if (action === 'pin') {
      db.prepare('UPDATE topics SET is_pinned = 1, updated_at = ? WHERE id = ?').run(now, topic.id);
      res.setFlash('success', '主题已置顶。');
    } else if (action === 'unpin') {
      db.prepare('UPDATE topics SET is_pinned = 0, updated_at = ? WHERE id = ?').run(now, topic.id);
      res.setFlash('success', '已取消置顶。');
    } else if (action === 'lock') {
      db.prepare('UPDATE topics SET is_locked = 1, updated_at = ? WHERE id = ?').run(now, topic.id);
      res.setFlash('success', '主题已锁定。');
    } else if (action === 'unlock') {
      db.prepare('UPDATE topics SET is_locked = 0, updated_at = ? WHERE id = ?').run(now, topic.id);
      res.setFlash('success', '主题已解锁。');
    } else if (action === 'delete') {
      softDeleteTopic(topic);
      res.setFlash('success', '主题已删除。');
      return res.redirect(`/c/${topic.category_id}`);
    } else {
      throw new HTTPError(400, '未知的操作。');
    }
    return res.redirect(`/t/${topic.id}`);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
