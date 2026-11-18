'use strict';

const express = require('express');
const { db, getSettings, transaction } = require('../db');
const { hashPassword, verifyPassword } = require('../passwords');
const { createSession, setSessionCookie, clearSessionCookie, destroySession } = require('../auth');
const { rateLimit, clearRateLimit, safeNext } = require('../middleware');
const {
  normalizeEmail,
  validateEmail,
  validateUsername,
  validatePassword,
} = require('../utils');

const router = express.Router();

const loginLimiter = rateLimit({
  scope: 'login',
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: '登录尝试过于频繁，请稍后再试。',
});

const registerLimiter = rateLimit({
  scope: 'register',
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: '注册请求过于频繁，请稍后再试。',
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  const next = safeNext(req.query.next, '/');
  return res.render('login', {
    page: 'login',
    pageTitle: '登录',
    metaDescription: '登录你的账户',
    next,
    error: null,
    values: {},
  });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const remember = req.body.remember === '1';
    const nextUrl = safeNext(req.body.next, '/');

    if (!identifier || !password) {
      return res.status(400).render('login', {
        page: 'login',
        pageTitle: '登录',
        metaDescription: '登录你的账户',
        next: nextUrl,
        error: '请输入用户名/邮箱和密码。',
        values: { username: identifier },
      });
    }

    const user = db.prepare(
      'SELECT * FROM users WHERE username = ? OR email = ?',
    ).get(identifier, normalizeEmail(identifier));

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).render('login', {
        page: 'login',
        pageTitle: '登录',
        metaDescription: '登录你的账户',
        next: nextUrl,
        error: '用户名、邮箱或密码不正确。',
        values: { username: identifier },
      });
    }

    if (user.is_banned) {
      return res.status(403).render('login', {
        page: 'login',
        pageTitle: '登录',
        metaDescription: '登录你的账户',
        next: nextUrl,
        error: user.ban_reason ? `该账户已被禁用：${user.ban_reason}` : '该账户已被禁用，请联系管理员。',
        values: { username: identifier },
      });
    }

    const session = createSession(user.id, req, remember);
    setSessionCookie(req, res, session.token, remember);
    db.prepare('UPDATE users SET last_seen_at = ?, last_ip = ? WHERE id = ?')
      .run(Date.now(), String(req.ip || '').slice(0, 64), user.id);
    clearRateLimit('login', req);
    res.setFlash('success', `欢迎回来，${user.username}。`);
    return res.redirect(nextUrl);
  } catch (error) {
    return next(error);
  }
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  const open = getSettings().registration_open === '1';
  return res.render('register', {
    page: 'register',
    pageTitle: '注册',
    metaDescription: '创建账户，加入社区',
    open,
    error: open ? null : '本站暂时关闭了注册。',
    values: {},
  });
});

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const open = getSettings().registration_open === '1';
    if (!open) {
      return res.status(403).render('register', {
        page: 'register',
        pageTitle: '注册',
        metaDescription: '创建账户，加入社区',
        open: false,
        error: '本站暂时关闭了注册。',
        values: {},
      });
    }

    const username = String(req.body.username || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm_password || '');
    const honey = String(req.body.website || '').trim();
    const values = { username, email };

    // Hidden honeypot — bots love filling this in.
    if (honey) {
      res.setFlash('success', '注册成功，欢迎加入！');
      return res.redirect('/login');
    }

    let error = null;
    if (!validateUsername(username)) {
      error = '用户名需为 2–24 个字符，只能包含文字、数字、下划线和连字符，且不能使用保留名称。';
    } else if (!validateEmail(email)) {
      error = '请输入有效的邮箱地址。';
    } else if (!validatePassword(password)) {
      error = '密码长度需为 8–128 个字符。';
    } else if (password !== confirm) {
      error = '两次输入的密码不一致。';
    } else if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      error = '该用户名已被使用。';
    } else if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      error = '该邮箱已被注册。';
    }

    if (error) {
      return res.status(400).render('register', {
        page: 'register',
        pageTitle: '注册',
        metaDescription: '创建账户，加入社区',
        open: true,
        error,
        values,
      });
    }

    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const id = transaction(() => {
      const info = db.prepare(
        `INSERT INTO users (username, email, password_hash, role, created_at, last_seen_at, last_ip)
         VALUES (?, ?, ?, 'member', ?, ?, ?)`,
      ).run(username, email, passwordHash, now, now, String(req.ip || '').slice(0, 64));
      return Number(info.lastInsertRowid);
    });

    const session = createSession(id, req, true);
    setSessionCookie(req, res, session.token, true);
    clearRateLimit('register', req);
    res.setFlash('success', '注册成功，欢迎加入社区！请先阅读站务公告。');
    return res.redirect('/');
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.sessionId);
  clearSessionCookie(req, res);
  res.setFlash('info', '你已退出登录。');
  res.redirect('/');
});

module.exports = router;
