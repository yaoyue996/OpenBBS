'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { config } = require('../config');
const {
  db,
  getSettings,
  setSettings,
  getStats,
  ADMIN_CREDENTIALS_FILE,
  transaction,
} = require('../db');
const { requireAdmin, HTTPError, backUrl } = require('../middleware');
const { generatePassword, hashPassword } = require('../passwords');
const { getCategories, getCategory, pagination, escapeLike } = require('../services');
const { toInt } = require('../utils');

const router = express.Router();
router.use(requireAdmin);

const ROLE_LABELS = { admin: '管理员', moderator: '版主', member: '成员' };

router.get('/', (req, res) => {
  const stats = getStats();
  const extra = {
    categories: Number(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n),
    banned: Number(db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_banned = 1').get().n),
    deletedTopics: Number(db.prepare('SELECT COUNT(*) AS n FROM topics WHERE is_deleted = 1').get().n),
    moderators: Number(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'moderator'").get().n),
    admins: Number(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n),
  };
  const recentUsers = db.prepare(
    `SELECT id, username, email, role, is_banned, created_at, avatar_color, avatar_emoji
     FROM users ORDER BY id DESC LIMIT 8`,
  ).all();
  const recentTopics = db.prepare(
    `SELECT t.id, t.title, t.is_deleted, t.created_at, u.username, c.name AS category_name
     FROM topics t JOIN users u ON u.id = t.user_id JOIN categories c ON c.id = t.category_id
     ORDER BY t.id DESC LIMIT 8`,
  ).all();
  const recentPosts = db.prepare(
    `SELECT p.id, p.topic_id, p.content, p.created_at, p.is_deleted, u.username, t.title
     FROM posts p JOIN users u ON u.id = p.user_id JOIN topics t ON t.id = p.topic_id
     ORDER BY p.id DESC LIMIT 8`,
  ).all();

  const warnings = [];
  if (fs.existsSync(ADMIN_CREDENTIALS_FILE)) {
    warnings.push({ level: 'warning', text: '初始管理员密码文件仍然存在。登录后请在「个人设置」中修改密码，文件会自动删除。' });
  }
  if (/localhost|127\.0\.0\.1/.test(config.siteUrl)) {
    warnings.push({ level: 'info', text: 'SITE_URL 仍指向 localhost。上线时请在 .env 中设置为公开域名。' });
  }
  if (getSettings().registration_open === '1') {
    warnings.push({ level: 'info', text: '当前开放注册。如站点仅限邀请，可在「站点设置」中关闭注册。' });
  }

  res.render('admin/dashboard', {
    page: 'admin',
    pageTitle: '管理后台',
    metaDescription: '站点管理',
    stats,
    extra,
    recentUsers,
    recentTopics,
    recentPosts,
    warnings,
    system: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      database: config.databasePath,
      uptime: Math.round(process.uptime()),
      siteUrl: config.siteUrl,
    },
  });
});

router.get('/categories', (req, res) => {
  const categories = getCategories();
  const editId = toInt(req.query.edit, 0);
  const editCategory = editId ? getCategory(editId) : null;
  res.render('admin/categories', {
    page: 'admin',
    pageTitle: '分类管理',
    metaDescription: '管理论坛分类',
    categories,
    editCategory,
  });
});

router.post('/categories/save', (req, res, next) => {
  try {
    const id = toInt(req.body.id, 0);
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim().slice(0, 200);
    let icon = String(req.body.icon || '').trim();
    if (Array.from(icon).length > 4) icon = Array.from(icon).slice(0, 4).join('');
    if (!icon) icon = '💬';
    const colorInput = String(req.body.color || '').trim();
    const color = /^#[0-9a-fA-F]{6}$/.test(colorInput) ? colorInput.toLowerCase() : '#6366f1';
    const position = toInt(req.body.position, 0);

    if (name.length < 1 || name.length > 40) throw new HTTPError(400, '分类名称需为 1–40 个字符。');
    if (description.length > 200) throw new HTTPError(400, '分类描述不能超过 200 个字符。');

    if (id) {
      if (!getCategory(id)) throw new HTTPError(404, '分类不存在。');
      db.prepare('UPDATE categories SET name = ?, description = ?, icon = ?, color = ?, position = ? WHERE id = ?')
        .run(name, description, icon, color, position, id);
      res.setFlash('success', '分类已更新。');
    } else {
      db.prepare(
        'INSERT INTO categories (name, description, icon, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(name, description, icon, color, position, Date.now());
      res.setFlash('success', '分类已创建。');
    }
    return res.redirect('/admin/categories');
  } catch (error) {
    return next(error);
  }
});

router.post('/categories/:id/delete', (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const category = getCategory(id);
    if (!category) throw new HTTPError(404, '分类不存在。');
    const topics = Number(db.prepare('SELECT COUNT(*) AS n FROM topics WHERE category_id = ?').get(id).n);
    if (topics > 0) {
      res.setFlash('error', `该分类下仍有 ${topics} 个主题（含回收站），无法删除。请先移动或清理主题。`);
      return res.redirect('/admin/categories');
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.setFlash('success', '分类已删除。');
    return res.redirect('/admin/categories');
  } catch (error) {
    return next(error);
  }
});

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const role = ['admin', 'moderator', 'member'].includes(String(req.query.role)) ? String(req.query.role) : '';
  const status = ['active', 'banned'].includes(String(req.query.status)) ? String(req.query.status) : '';
  const where = ['1 = 1'];
  const params = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push("(username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (role) {
    where.push('role = ?');
    params.push(role);
  }
  if (status === 'active') where.push('is_banned = 0');
  if (status === 'banned') where.push('is_banned = 1');

  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${where.join(' AND ')}`).get(...params).n);
  const pager = pagination(req, 25, total);
  const users = db.prepare(
    `SELECT u.*,
       (SELECT COUNT(*) FROM topics t WHERE t.user_id = u.id AND t.is_deleted = 0) AS topic_count,
       (SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id
         WHERE p.user_id = u.id AND p.is_deleted = 0 AND t.is_deleted = 0) AS post_count
     FROM users u WHERE ${where.join(' AND ')}
     ORDER BY u.id ASC LIMIT ? OFFSET ?`,
  ).all(...params, 25, pager.offset);

  res.render('admin/users', {
    page: 'admin',
    pageTitle: '用户管理',
    metaDescription: '管理社区用户',
    users,
    pager,
    total,
    q,
    role,
    status,
  });
});

router.post('/users/:id/action', async (req, res, next) => {
  try {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(toInt(req.params.id, 0));
    if (!target) throw new HTTPError(404, '用户不存在。');
    const action = String(req.body.action || '');
    const redirectTo = backUrl(req, '/admin/users');

    if (action === 'role') {
      const newRole = String(req.body.role || '');
      if (!['admin', 'moderator', 'member'].includes(newRole)) throw new HTTPError(400, '无效的用户组。');
      if (target.id === req.user.id) {
        res.setFlash('error', '不能修改自己的用户组。');
        return res.redirect(redirectTo);
      }
      if (target.role === 'admin' && newRole !== 'admin') {
        const admins = Number(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n);
        if (admins <= 1) {
          res.setFlash('error', '站点必须至少保留一名管理员。');
          return res.redirect(redirectTo);
        }
      }
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, target.id);
      res.setFlash('success', `已将 ${target.username} 的用户组改为${ROLE_LABELS[newRole]}。`);
      return res.redirect(redirectTo);
    }

    if (action === 'ban') {
      if (target.id === req.user.id) {
        res.setFlash('error', '不能封禁自己。');
        return res.redirect(redirectTo);
      }
      if (target.role === 'admin') {
        res.setFlash('error', '请先将该管理员降级为用户，再执行封禁。');
        return res.redirect(redirectTo);
      }
      const reason = String(req.body.reason || '').trim().slice(0, 200);
      db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(reason, target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      res.setFlash('success', `已封禁 ${target.username}。`);
      return res.redirect(redirectTo);
    }

    if (action === 'unban') {
      db.prepare("UPDATE users SET is_banned = 0, ban_reason = '' WHERE id = ?").run(target.id);
      res.setFlash('success', `已解除 ${target.username} 的封禁。`);
      return res.redirect(redirectTo);
    }

    if (action === 'reset-password') {
      if (target.role === 'admin' && target.id !== req.user.id) {
        res.setFlash('error', '不能重置其他管理员的密码。请让该管理员自行修改。');
        return res.redirect(redirectTo);
      }
      const password = generatePassword(14);
      const hash = await hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      res.setFlash('success', `已重置 ${target.username} 的密码。临时密码：${password} （仅显示一次，请立即转交并提醒修改）`);
      return res.redirect(redirectTo);
    }

    throw new HTTPError(400, '未知的操作。');
  } catch (error) {
    return next(error);
  }
});

router.get('/topics', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const categoryId = toInt(req.query.category, 0);
  const status = ['visible', 'deleted', 'pinned', 'locked'].includes(String(req.query.status))
    ? String(req.query.status)
    : '';
  const where = ['1 = 1'];
  const params = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push("t.title LIKE ? ESCAPE '\\'");
    params.push(like);
  }
  if (categoryId) {
    where.push('t.category_id = ?');
    params.push(categoryId);
  }
  if (status === 'visible') where.push('t.is_deleted = 0');
  if (status === 'deleted') where.push('t.is_deleted = 1');
  if (status === 'pinned') where.push('t.is_pinned = 1');
  if (status === 'locked') where.push('t.is_locked = 1');

  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM topics t WHERE ${where.join(' AND ')}`).get(...params).n);
  const pager = pagination(req, 25, total);
  const topics = db.prepare(
    `SELECT t.*, u.username, c.name AS category_name,
       (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id AND p.is_deleted = 0) AS post_count
     FROM topics t JOIN users u ON u.id = t.user_id JOIN categories c ON c.id = t.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, 25, pager.offset);

  res.render('admin/topics', {
    page: 'admin',
    pageTitle: '内容管理',
    metaDescription: '管理社区主题',
    topics,
    categories: getCategories(),
    pager,
    total,
    q,
    categoryId,
    status,
  });
});

router.post('/topics/:id/action', (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
    if (!topic) throw new HTTPError(404, '主题不存在。');
    const action = String(req.body.action || '');
    const now = Date.now();
    if (action === 'pin') {
      db.prepare('UPDATE topics SET is_pinned = 1, updated_at = ? WHERE id = ?').run(now, id);
    } else if (action === 'unpin') {
      db.prepare('UPDATE topics SET is_pinned = 0, updated_at = ? WHERE id = ?').run(now, id);
    } else if (action === 'lock') {
      db.prepare('UPDATE topics SET is_locked = 1, updated_at = ? WHERE id = ?').run(now, id);
    } else if (action === 'unlock') {
      db.prepare('UPDATE topics SET is_locked = 0, updated_at = ? WHERE id = ?').run(now, id);
    } else if (action === 'delete') {
      db.prepare('UPDATE topics SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    } else if (action === 'restore') {
      db.prepare('UPDATE topics SET is_deleted = 0, updated_at = ? WHERE id = ?').run(now, id);
    } else {
      throw new HTTPError(400, '未知的操作。');
    }
    res.setFlash('success', '操作已完成。');
    return res.redirect(backUrl(req, '/admin/topics'));
  } catch (error) {
    return next(error);
  }
});

router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    page: 'admin',
    pageTitle: '站点设置',
    metaDescription: '配置站点信息',
    settings: getSettings(),
  });
});

router.post('/settings', (req, res, next) => {
  try {
    const siteName = String(req.body.site_name || '').trim();
    const description = String(req.body.site_description || '').trim();
    const announcement = String(req.body.site_announcement || '').trim();
    const footer = String(req.body.footer_text || '').trim();
    const registrationOpen = req.body.registration_open === '1' ? '1' : '0';
    const topicsPerPage = toInt(req.body.topics_per_page, 20);
    const postsPerPage = toInt(req.body.posts_per_page, 20);
    const cooldown = toInt(req.body.post_cooldown, 15);

    if (!siteName || siteName.length > 60) throw new HTTPError(400, '站点名称需为 1–60 个字符。');
    if (description.length > 200) throw new HTTPError(400, '站点描述不能超过 200 个字符。');
    if (announcement.length > 10000) throw new HTTPError(400, '公告内容不能超过 10000 个字符。');
    if (footer.length > 200) throw new HTTPError(400, '页脚文字不能超过 200 个字符。');
    if (topicsPerPage < 5 || topicsPerPage > 100) throw new HTTPError(400, '每页主题数需在 5–100 之间。');
    if (postsPerPage < 5 || postsPerPage > 100) throw new HTTPError(400, '每页回复数需在 5–100 之间。');
    if (cooldown < 0 || cooldown > 3600) throw new HTTPError(400, '发帖冷却时间需在 0–3600 秒之间。');

    setSettings({
      site_name: siteName,
      site_description: description,
      site_announcement: announcement,
      footer_text: footer,
      registration_open: registrationOpen,
      topics_per_page: String(topicsPerPage),
      posts_per_page: String(postsPerPage),
      post_cooldown: String(cooldown),
    });
    res.setFlash('success', '站点设置已保存。');
    return res.redirect('/admin/settings');
  } catch (error) {
    return next(error);
  }
});

router.get('/backup', (req, res, next) => {
  try {
    const tmp = path.join(os.tmpdir(), `openbbs-backup-${Date.now()}.db`);
    db.exec('PRAGMA wal_checkpoint(FULL);');
    fs.copyFileSync(config.databasePath, tmp);
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.download(tmp, `openbbs-backup-${date}.db`, (error) => {
      fs.promises.unlink(tmp).catch(() => {});
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
