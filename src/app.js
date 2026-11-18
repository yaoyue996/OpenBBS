'use strict';

const path = require('node:path');
const express = require('express');
const compression = require('compression');

const { config } = require('./config');
const { getSettings } = require('./db');
const { icon } = require('./icons');
const { renderMarkdown } = require('./markdown');
const {
  cookies,
  flash,
  ensureCsrf,
  verifyCsrf,
  loadUser,
  setLocals,
  securityHeaders,
  requestLogger,
} = require('./middleware');
const {
  formatDate,
  formatDateOnly,
  timeAgo,
  formatNumber,
  excerpt,
  truncate,
  getInitials,
  avatarColorFor,
} = require('./utils');

const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const topicRoutes = require('./routes/topics');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

const ROLE_LABELS = { admin: '管理员', moderator: '版主', member: '成员' };
const NOTIFICATION_LABELS = {
  reply: '回复了你的主题',
  quote: '引用了你的回复',
  mention: '在帖子中提到了你',
};

function pageNumbers(current, total) {
  if (total <= 1) return [1];
  const pages = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => pages.add(n));
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => pages.add(n));
  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const output = [];
  let previous = 0;
  for (const n of sorted) {
    if (previous && n - previous > 1) output.push('…');
    output.push(n);
    previous = n;
  }
  return output;
}

function createApp() {
  const app = express();
  const viewsDir = path.join(config.root, 'views');
  const publicDir = path.join(config.root, 'public');

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', viewsDir);
  app.set('view cache', config.isProduction);

  app.locals.icon = icon;
  app.locals.formatDate = formatDate;
  app.locals.formatDateOnly = formatDateOnly;
  app.locals.timeAgo = timeAgo;
  app.locals.formatNumber = formatNumber;
  app.locals.excerpt = excerpt;
  app.locals.truncate = truncate;
  app.locals.getInitials = getInitials;
  app.locals.avatarColorFor = avatarColorFor;
  app.locals.avatarColor = (user) => {
    if (!user) return '#6366f1';
    return user.avatar_color || avatarColorFor(user.username || '');
  };
  app.locals.roleLabel = (role) => ROLE_LABELS[role] || '成员';
  app.locals.notificationLabel = (type) => NOTIFICATION_LABELS[type] || '有新动态';
  app.locals.isOnline = (lastSeen) => Date.now() - Number(lastSeen || 0) < 15 * 60 * 1000;
  app.locals.asset = (file) => `/${String(file).replace(/^\/+/, '')}?v=${config.version}`;
  app.locals.pageNumbers = pageNumbers;
  app.locals.markdown = renderMarkdown;

  app.use(compression());
  app.use(securityHeaders);
  app.use(express.static(publicDir, {
    index: false,
    maxAge: config.isProduction ? '7d' : 0,
    etag: true,
  }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookies);
  app.use(flash);
  app.use(ensureCsrf);
  app.use(loadUser);
  app.use(setLocals);
  app.use(verifyCsrf);
  app.use(requestLogger);

  app.use('/', indexRoutes);
  app.use('/', authRoutes);
  app.use('/', categoryRoutes);
  app.use('/', topicRoutes);
  app.use('/', userRoutes);
  app.use('/admin', adminRoutes);
  app.use('/api', apiRoutes);

  app.use((req, res) => {
    if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    res.status(404);
    return res.render('error', {
      page: 'error',
      pageTitle: '页面不存在',
      metaDescription: '页面不存在',
      status: 404,
      message: '页面不存在，或者已经被移动到别处。',
      stack: null,
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = Number(error.status || error.statusCode) || 500;
    if (status >= 500) {
      console.error(`[openbbs] ${req.method} ${req.originalUrl}:`, error);
    }
    if (res.headersSent) return next(error);

    let message = error.expose ? error.message : null;
    if (status === 413) message = '提交的内容过大。';
    if (!message) message = status >= 500 ? '服务器开小差了，请稍后再试。' : '请求无法完成。';

    if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json')) {
      return res.status(status).json({ ok: false, error: message });
    }

    if (!res.locals.settings) res.locals.settings = getSettings();
    const fallbackSettings = res.locals.settings;
    res.locals.user = res.locals.user || null;
    res.locals.csrfToken = res.locals.csrfToken || '';
    res.locals.flash = res.locals.flash || null;
    res.locals.settings = fallbackSettings;
    res.locals.unreadNotifications = res.locals.unreadNotifications || 0;
    res.locals.registrationOpen = typeof res.locals.registrationOpen === 'boolean'
      ? res.locals.registrationOpen
      : fallbackSettings.registration_open === '1';
    res.locals.canModerate = typeof res.locals.canModerate === 'boolean'
      ? res.locals.canModerate
      : Boolean(res.locals.user && ['admin', 'moderator'].includes(res.locals.user.role));
    res.locals.isAdmin = typeof res.locals.isAdmin === 'boolean'
      ? res.locals.isAdmin
      : Boolean(res.locals.user && res.locals.user.role === 'admin');
    res.locals.siteUrl = res.locals.siteUrl || config.siteUrl;
    res.locals.year = res.locals.year || new Date().getFullYear();
    res.locals.appVersion = res.locals.appVersion || config.version;
    res.locals.bodyClass = res.locals.bodyClass || '';
    res.locals.query = res.locals.query || {};
    res.locals.queryUrl = res.locals.queryUrl || (() => req.path);
    res.locals.deployment = res.locals.deployment || {
      env: config.env,
      node: process.version,
      trustProxy: process.env.TRUST_PROXY || '0',
      cookieSecure: process.env.COOKIE_SECURE || 'auto',
    };
    res.locals.page = 'error';

    res.status(status);
    return res.render('error', {
      page: 'error',
      pageTitle: status === 404 ? '页面不存在' : '出错了',
      metaDescription: '请求无法完成',
      status,
      message,
      stack: config.isProduction ? null : error.stack,
    });
  });

  return app;
}

module.exports = { createApp, pageNumbers };
