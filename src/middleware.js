'use strict';

const { config } = require('./config');
const { db, getSettings } = require('./db');
const { getSession, clearSessionCookie, destroySession } = require('./auth');
const { randomToken, safeEqual } = require('./passwords');

class HTTPError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.status = status;
    this.expose = options.expose !== false;
  }
}

function parseCookies(header) {
  const cookies = Object.create(null);
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw value */
    }
    cookies[key] = value;
  }
  return cookies;
}

function cookieOptions(req, maxAge) {
  const options = { httpOnly: true, sameSite: 'lax', path: '/', secure: false };
  options.secure = config.cookieSecure === 'always'
    || (config.cookieSecure !== 'never' && Boolean(req.secure));
  if (maxAge) options.maxAge = maxAge;
  return options;
}

function cookies(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  res.setFlash = (type, message) => {
    const payload = JSON.stringify({ type: String(type || 'info'), message: String(message || '').slice(0, 600) });
    res.cookie(config.flashCookie, payload, cookieOptions(req, 120 * 1000));
  };
  next();
}

function flash(req, res, next) {
  const raw = req.cookies[config.flashCookie];
  res.locals.flash = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.message === 'string') {
        res.locals.flash = {
          type: ['success', 'error', 'info', 'warning'].includes(parsed.type) ? parsed.type : 'info',
          message: parsed.message.slice(0, 600),
        };
      }
    } catch {
      /* ignore malformed flash cookie */
    }
    res.clearCookie(config.flashCookie, cookieOptions(req));
  }
  next();
}

function ensureCsrf(req, res, next) {
  let token = req.cookies[config.csrfCookie];
  if (!token || !/^[A-Za-z0-9_-]{24,128}$/.test(token)) {
    token = randomToken(24);
  }
  req.cookies[config.csrfCookie] = token;
  res.locals.csrfToken = token;
  if (req.method === 'GET') {
    res.cookie(config.csrfCookie, token, cookieOptions(req, 2 * 60 * 60 * 1000));
  }
  next();
}

function allowedOrigin(req, origin) {
  try {
    const parsed = new URL(origin);
    const host = String(req.get('host') || '').toLowerCase();
    if (parsed.host.toLowerCase() === host) return true;
    const site = new URL(config.siteUrl);
    return parsed.origin === site.origin;
  } catch {
    return false;
  }
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  if (origin && !allowedOrigin(req, origin)) {
    return next(new HTTPError(403, '请求来源校验失败，请刷新页面后重试。'));
  }
  if (!origin && req.get('sec-fetch-site') === 'cross-site') {
    return next(new HTTPError(403, '不允许跨站提交表单。'));
  }

  const sent = req.get('x-csrf-token') || (req.body && (req.body._csrf || req.body.csrf));
  const expected = req.cookies[config.csrfCookie];
  if (!sent || !expected || !safeEqual(sent, expected)) {
    return next(new HTTPError(403, '页面已过期或安全校验失败，请刷新页面后重试。'));
  }
  return next();
}

function loadUser(req, res, next) {
  req.user = null;
  req.sessionId = null;
  const token = req.cookies[config.sessionCookie];
  if (!token) return next();

  const row = getSession(token);
  if (!row) {
    clearSessionCookie(req, res);
    return next();
  }

  if (row.is_banned) {
    destroySession(row.session_id);
    clearSessionCookie(req, res);
    res.locals.flash = res.locals.flash || { type: 'error', message: '该账户已被禁用，请联系管理员。' };
    return next();
  }

  const now = Date.now();
  if (now - Number(row.last_seen_at || 0) > 5 * 60 * 1000) {
    db.prepare('UPDATE users SET last_seen_at = ?, last_ip = ? WHERE id = ?')
      .run(now, String(req.ip || '').slice(0, 64), row.id);
    row.last_seen_at = now;
  }

  delete row.expires_at;
  delete row.password_hash;
  req.user = row;
  req.sessionId = row.session_id;
  return next();
}

function setLocals(req, res, next) {
  const settings = getSettings();
  res.locals.settings = settings;
  res.locals.user = req.user || null;
  res.locals.csrfToken = res.locals.csrfToken || req.cookies[config.csrfCookie] || '';
  res.locals.currentPath = req.path;
  res.locals.query = req.query || {};
  res.locals.canModerate = Boolean(req.user && ['admin', 'moderator'].includes(req.user.role));
  res.locals.isAdmin = Boolean(req.user && req.user.role === 'admin');
  res.locals.registrationOpen = settings.registration_open === '1';
  res.locals.siteUrl = config.siteUrl;
  res.locals.pageTitle = '';
  res.locals.metaDescription = settings.site_description;
  res.locals.bodyClass = '';
  res.locals.unreadNotifications = 0;
  res.locals.year = new Date().getFullYear();
  res.locals.appVersion = config.version;
  res.locals.deployment = {
    env: config.env,
    node: process.version,
    trustProxy: process.env.TRUST_PROXY || '0',
    cookieSecure: process.env.COOKIE_SECURE || 'auto',
  };
  res.locals.page = '';
  res.locals.queryUrl = (overrides = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === null || value === '') params.delete(key);
      else params.set(key, String(value));
    }
    const search = params.toString();
    return `${req.path}${search ? `?${search}` : ''}`;
  };

  if (req.user) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id);
    res.locals.unreadNotifications = Number(row.n);
    res.set('Cache-Control', 'private, no-store');
  }

  next();
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: https: http:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
    ].join('; '),
  });
  if (req.secure) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const isNoise = req.path.startsWith('/assets/') || req.path === '/favicon.ico';
    if (isNoise) return;
    if (config.env === 'test') return;
    if (config.isProduction && res.statusCode < 400 && ms < 1500) return;
    const who = req.user ? `@${req.user.username}` : '-';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms ${who}`);
  });
  next();
}

const buckets = new Map();

function rateLimit({ scope, windowMs, max, message }) {
  return (req, res, next) => {
    const now = Date.now();
    const identity = req.user ? `u${req.user.id}` : `ip:${req.ip || 'unknown'}`;
    const key = `${scope}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return next(new HTTPError(429, message || '操作过于频繁，请稍后再试。'));
    }
    return next();
  };
}

function clearRateLimit(scope, req) {
  const identity = req.user ? `u${req.user.id}` : `ip:${req.ip || 'unknown'}`;
  buckets.delete(`${scope}:${identity}`);
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 10 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

function requireLogin(req, res, next) {
  if (req.user) return next();
  const wantsJson = req.get('accept')?.includes('application/json') || req.get('x-requested-with') === 'fetch';
  if (wantsJson) return res.status(401).json({ ok: false, error: '请先登录。' });
  const target = req.originalUrl && req.originalUrl.startsWith('/') && !req.originalUrl.startsWith('//')
    ? req.originalUrl
    : '/';
  res.setFlash('info', '请先登录后再继续。');
  return res.redirect(`/login?next=${encodeURIComponent(target)}`);
}

function requireModerator(req, res, next) {
  if (req.user && ['admin', 'moderator'].includes(req.user.role)) return next();
  return next(new HTTPError(403, '你没有权限执行此操作。'));
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return next(new HTTPError(403, '只有管理员可以访问此页面。'));
}

function safeNext(value, fallback = '/') {
  const next = String(value || '');
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\r\n]/.test(next)) return fallback;
  return next;
}

function backUrl(req, fallback = '/') {
  const referer = req.get('referer');
  if (!referer) return fallback;
  try {
    const parsed = new URL(referer);
    if (parsed.host !== req.get('host')) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  HTTPError,
  parseCookies,
  cookies,
  flash,
  ensureCsrf,
  verifyCsrf,
  loadUser,
  setLocals,
  securityHeaders,
  requestLogger,
  rateLimit,
  clearRateLimit,
  requireLogin,
  requireModerator,
  requireAdmin,
  safeNext,
  backUrl,
  cookieOptions,
};
