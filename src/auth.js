'use strict';

const { config } = require('./config');
const { db } = require('./db');
const { randomToken, sha256 } = require('./passwords');

const SESSION_DAYS = 30;

function cookieSecure(req) {
  if (config.cookieSecure === 'always') return true;
  if (config.cookieSecure === 'never') return false;
  return Boolean(req.secure);
}

function createSession(userId, req, remember = true) {
  const token = randomToken(32);
  const id = sha256(token);
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, now, expiresAt, String(req.ip || '').slice(0, 64), String(req.get('user-agent') || '').slice(0, 300));
  return { token, remember, expiresAt };
}

function setSessionCookie(req, res, token, remember) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(req),
    path: '/',
  };
  if (remember) options.maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(config.sessionCookie, token, options);
}

function clearSessionCookie(req, res) {
  res.clearCookie(config.sessionCookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(req),
    path: '/',
  });
}

function getSession(sessionCookie) {
  if (!sessionCookie) return null;
  const id = sha256(sessionCookie);
  const row = db.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  ).get(id, Date.now());
  return row || null;
}

function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function destroyAllSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

module.exports = {
  SESSION_DAYS,
  cookieSecure,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  destroySession,
  destroyAllSessions,
};
