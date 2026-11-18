'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Minimal .env loader. Does not override variables that already exist in the
 * environment, which lets Docker / systemd / CI take precedence.
 */
function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

const env = process.env.NODE_ENV || 'production';
const siteUrl = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const config = {
  root: ROOT,
  env,
  isProduction: env === 'production',
  host: process.env.HOST || '0.0.0.0',
  port: int(process.env.PORT, 3000),
  siteUrl,
  siteName: process.env.SITE_NAME || 'OpenBBS',
  siteDescription: process.env.SITE_DESCRIPTION || '一个属于你的开源社区',
  databasePath: resolveFromRoot(process.env.DATABASE_PATH || 'data/openbbs.db'),
  trustProxy: (() => {
    const v = process.env.TRUST_PROXY;
    if (!v || v === '0' || v.toLowerCase() === 'false') return false;
    if (v === '1' || v.toLowerCase() === 'true') return true;
    if (/^\d+$/.test(v)) return Number.parseInt(v, 10);
    return v; // e.g. "loopback, 10.0.0.0/8"
  })(),
  cookieSecure: (process.env.COOKIE_SECURE || 'auto').toLowerCase(),
  sessionCookie: 'ob_session',
  csrfCookie: 'ob_csrf',
  flashCookie: 'ob_flash',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  version: require('../package.json').version,
};

module.exports = { config, loadDotEnv, bool, int, resolveFromRoot };
