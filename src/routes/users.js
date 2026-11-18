'use strict';

const express = require('express');
const { db, getSettings, getSetting, removeAdminCredentialsFile } = require('../db');
const { renderMarkdown } = require('../markdown');
const { destroyAllSessions } = require('../auth');
const { requireLogin, HTTPError } = require('../middleware');
const { hashPassword, verifyPassword, generatePassword } = require('../passwords');
const { pagination, getUserStats, placeholders } = require('../services');
const {
  toInt,
  normalizeEmail,
  validateEmail,
  validatePassword,
  excerpt,
  truncate,
} = require('../utils');

const router = express.Router();

router.get('/u/:id', (req, res) => {
  const id = toInt(req.params.id, 0);
  const user = db.prepare(
    `SELECT id, username, role, bio, signature, avatar_color, avatar_emoji, is_banned, ban_reason,
       created_at, last_seen_at
     FROM users WHERE id = ?`,
  ).get(id);
  if (!user) throw new HTTPError(404, '用户不存在。');

  const tab = ['topics', 'replies', 'bookmarks'].includes(String(req.query.tab))
    ? String(req.query.tab)
    : 'topics';
  const isSelf = Boolean(req.user && req.user.id === user.id);

  const stats = getUserStats(id);
  const perPage = 15;
  let topics = [];
  let replies = [];
  let bookmarks = [];
  let pager = null;
  let total = 0;

  if (tab === 'topics') {
    total = Number(
      db.prepare('SELECT COUNT(*) AS n FROM topics WHERE user_id = ? AND is_deleted = 0').get(id).n,
    );
    pager = pagination(req, perPage, total);
    topics = db.prepare(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         u.avatar_color AS author_avatar_color, u.avatar_emoji AS author_avatar_emoji,
         (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id AND p.is_deleted = 0) AS post_count
       FROM topics t JOIN categories c ON c.id = t.category_id JOIN users u ON u.id = t.user_id
       WHERE t.user_id = ? AND t.is_deleted = 0
       ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    ).all(id, perPage, pager.offset);
  } else if (tab === 'replies') {
    total = Number(
      db.prepare(
        `SELECT COUNT(*) AS n FROM posts p JOIN topics t ON t.id = p.topic_id
         WHERE p.user_id = ? AND p.is_deleted = 0 AND t.is_deleted = 0`,
      ).get(id).n,
    );
    pager = pagination(req, perPage, total);
    replies = db.prepare(
      `SELECT p.id, p.content, p.created_at, p.topic_id, t.title AS topic_title, t.category_id,
         c.name AS category_name, c.color
       FROM posts p JOIN topics t ON t.id = p.topic_id JOIN categories c ON c.id = t.category_id
       WHERE p.user_id = ? AND p.is_deleted = 0 AND t.is_deleted = 0
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ).all(id, perPage, pager.offset).map((post) => ({ ...post, snippet: excerpt(post.content, 180) }));
  } else {
    if (!isSelf) {
      throw new HTTPError(403, '收藏夹仅对本人可见。');
    }
    total = Number(
      db.prepare(
        `SELECT COUNT(*) AS n FROM bookmarks b JOIN topics t ON t.id = b.topic_id
         WHERE b.user_id = ? AND t.is_deleted = 0`,
      ).get(id).n,
    );
    pager = pagination(req, perPage, total);
    bookmarks = db.prepare(
      `SELECT t.id, t.title, t.replies_count, t.views, t.last_reply_at, t.created_at, t.is_pinned, t.is_locked,
         t.category_id, t.user_id, t.last_reply_user_id, b.created_at AS bookmarked_at,
         c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
         u.username AS author_username, u.avatar_color AS author_avatar_color, u.avatar_emoji AS author_avatar_emoji,
         lu.username AS last_username, lu.avatar_color AS last_avatar_color, lu.avatar_emoji AS last_avatar_emoji
       FROM bookmarks b JOIN topics t ON t.id = b.topic_id
       JOIN categories c ON c.id = t.category_id JOIN users u ON u.id = t.user_id
       LEFT JOIN users lu ON lu.id = t.last_reply_user_id
       WHERE b.user_id = ? AND t.is_deleted = 0
       ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    ).all(id, perPage, pager.offset);
  }

  const online = Date.now() - Number(user.last_seen_at) < 15 * 60 * 1000;

  res.render('profile', {
    page: 'profile',
    pageTitle: user.username,
    metaDescription: `${user.username} 的个人主页`,
    profileUser: user,
    stats,
    tab,
    topics,
    replies,
    bookmarks,
    pager,
    total,
    online,
    isSelf,
    signatureHtml: user.signature ? renderMarkdown(user.signature) : '',
  });
});

router.get('/settings', requireLogin, (req, res) => {
  res.render('settings', {
    page: 'settings',
    pageTitle: '个人设置',
    metaDescription: '管理你的个人资料与账户安全',
    errors: {},
    values: {},
  });
});

router.post('/settings/profile', requireLogin, (req, res) => {
  const bio = String(req.body.bio || '').trim().slice(0, 500);
  const signature = String(req.body.signature || '').trim().slice(0, 300);
  let avatarEmoji = String(req.body.avatar_emoji || '').trim();
  if (Array.from(avatarEmoji).length > 4) avatarEmoji = Array.from(avatarEmoji).slice(0, 4).join('');
  const avatarColor = String(req.body.avatar_color || '').trim();
  const color = /^#[0-9a-fA-F]{6}$/.test(avatarColor) ? avatarColor.toLowerCase() : '';

  db.prepare('UPDATE users SET bio = ?, signature = ?, avatar_emoji = ?, avatar_color = ? WHERE id = ?')
    .run(bio, signature, avatarEmoji, color, req.user.id);
  res.setFlash('success', '个人资料已保存。');
  res.redirect('/settings');
});

router.post('/settings/account', requireLogin, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const currentPassword = String(req.body.current_password || '');
    const newPassword = String(req.body.new_password || '');
    const confirmPassword = String(req.body.confirm_password || '');
    const renderError = (message) => res.status(400).render('settings', {
      page: 'settings',
      pageTitle: '个人设置',
      metaDescription: '管理你的个人资料与账户安全',
      errors: { account: message },
      values: { email },
    });

    if (!validateEmail(email)) return renderError('请输入有效的邮箱地址。');
    if (!currentPassword) return renderError('修改账户信息需要输入当前密码。');
    const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!current || !(await verifyPassword(currentPassword, current.password_hash))) {
      return renderError('当前密码不正确。');
    }
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, req.user.id);
    if (taken) return renderError('该邮箱已被其他账户使用。');

    let passwordChanged = false;
    let newHash = current.password_hash;
    if (newPassword) {
      if (!validatePassword(newPassword)) return renderError('新密码长度需为 8–128 个字符。');
      if (newPassword !== confirmPassword) return renderError('两次输入的新密码不一致。');
      if (newPassword === currentPassword) return renderError('新密码不能与当前密码相同。');
      newHash = await hashPassword(newPassword);
      passwordChanged = true;
    }

    const emailChanged = email !== String(req.user.email).toLowerCase();
    if (!emailChanged && !passwordChanged) {
      res.setFlash('info', '没有需要保存的更改。');
      return res.redirect('/settings');
    }

    db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?')
      .run(email, newHash, req.user.id);

    if (passwordChanged) {
      destroyAllSessions(req.user.id, req.sessionId);
      if (req.user.role === 'admin') removeAdminCredentialsFile();
      res.setFlash('success', '账户已更新，密码修改成功。其他设备上的登录已失效。');
    } else {
      res.setFlash('success', '账户已更新。');
    }
    return res.redirect('/settings');
  } catch (error) {
    return next(error);
  }
});

router.get('/bookmarks', requireLogin, (req, res) => {
  const perPage = 20;
  const total = Number(
    db.prepare(
      `SELECT COUNT(*) AS n FROM bookmarks b JOIN topics t ON t.id = b.topic_id
       WHERE b.user_id = ? AND t.is_deleted = 0`,
    ).get(req.user.id).n,
  );
  const pager = pagination(req, perPage, total);
  const topics = db.prepare(
    `SELECT t.id, t.title, t.replies_count, t.views, t.last_reply_at, t.created_at, t.category_id, t.user_id,
       b.created_at AS bookmarked_at,
       c.name AS category_name, c.color AS category_color, c.icon AS category_icon, u.username AS author_username
     FROM bookmarks b JOIN topics t ON t.id = b.topic_id
     JOIN categories c ON c.id = t.category_id JOIN users u ON u.id = t.user_id
     WHERE b.user_id = ? AND t.is_deleted = 0
     ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
  ).all(req.user.id, perPage, pager.offset);
  res.render('bookmarks', {
    page: 'bookmarks',
    pageTitle: '我的收藏',
    metaDescription: '你收藏的主题',
    topics,
    pager,
    total,
  });
});

router.get('/notifications', requireLogin, (req, res) => {
  const perPage = 30;
  const total = Number(
    db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(req.user.id).n,
  );
  const pager = pagination(req, perPage, total);
  const notifications = db.prepare(
    `SELECT n.*, u.username AS actor_username, u.avatar_color AS actor_avatar_color, u.avatar_emoji AS actor_avatar_emoji,
       t.title AS topic_title, t.is_deleted AS topic_deleted,
       p.content AS post_content
     FROM notifications n
     JOIN users u ON u.id = n.actor_id
     LEFT JOIN topics t ON t.id = n.topic_id
     LEFT JOIN posts p ON p.id = n.post_id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
  ).all(req.user.id, perPage, pager.offset);
  res.render('notifications', {
    page: 'notifications',
    pageTitle: '通知',
    metaDescription: '你的社区通知',
    notifications,
    pager,
    total,
  });
});

router.get('/notifications/:id', requireLogin, (req, res) => {
  const id = toInt(req.params.id, 0);
  const notification = db.prepare(
    'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
  ).get(id, req.user.id);
  if (!notification) throw new HTTPError(404, '通知不存在。');

  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  const topic = notification.topic_id
    ? db.prepare('SELECT id, is_deleted FROM topics WHERE id = ?').get(notification.topic_id)
    : null;
  if (!topic || topic.is_deleted) {
    res.setFlash('info', '该通知对应的内容已被删除。');
    return res.redirect('/notifications');
  }

  let page = 1;
  if (notification.post_id) {
    const perPage = Math.min(100, Math.max(5, toInt(getSetting('posts_per_page', '20'), 20)));
    const before = Number(
      db.prepare('SELECT COUNT(*) AS n FROM posts WHERE topic_id = ? AND is_deleted = 0 AND id <= ?')
        .get(topic.id, notification.post_id).n,
    );
    page = Math.max(1, Math.ceil(before / perPage));
  }
  const anchor = notification.post_id ? `#post-${notification.post_id}` : '';
  return res.redirect(`/t/${topic.id}?page=${page}${anchor}`);
});

router.post('/notifications/read', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  res.setFlash('success', '所有通知已标记为已读。');
  res.redirect('/notifications');
});

module.exports = router;
