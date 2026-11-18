'use strict';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#f59e0b',
  '#84cc16', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
];

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'openbbs', 'moderator', 'mod',
  'guest', 'support', 'help', 'official', 'null', 'undefined',
]);

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateOnly(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function timeAgo(ts) {
  const then = Number(ts);
  if (!then) return '';
  const diff = Date.now() - then;
  if (diff < 0) return formatDate(then);
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 48 * 60 * 60 * 1000) return '昨天';
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatDateOnly(then);
}

function formatNumber(n) {
  const value = Number(n) || 0;
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')} 亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  return new Intl.NumberFormat('zh-CN').format(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Turn Markdown into a short single-line preview. */
function excerpt(markdown, maxLength = 140) {
  let text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function truncate(text, length) {
  const value = String(text ?? '');
  if (value.length <= length) return value;
  return `${value.slice(0, length).trimEnd()}…`;
}

function getInitials(name) {
  const chars = Array.from(String(name || '?').trim());
  if (!chars.length) return '?';
  // Use the first character for CJK names, two letters for ASCII names.
  if (/^[A-Za-z0-9]/.test(chars[0])) {
    return (chars[0] + (chars[1] && /^[A-Za-z0-9]/.test(chars[1]) ? chars[1] : '')).toUpperCase();
  }
  return chars[0];
}

function avatarColorFor(name) {
  const value = String(name || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '')) && String(email).length <= 254;
}

function validateUsername(username) {
  const value = String(username || '').trim();
  if (value.length < 2 || value.length > 24) return false;
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) return false;
  if (RESERVED_USERNAMES.has(value.toLowerCase())) return false;
  if (/^[-_]|[-_]$/.test(value)) return false;
  return true;
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function positiveInt(value, fallback = 1) {
  const n = toInt(value, fallback);
  return n > 0 ? n : fallback;
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

module.exports = {
  AVATAR_COLORS,
  RESERVED_USERNAMES,
  formatDate,
  formatDateOnly,
  timeAgo,
  formatNumber,
  escapeHtml,
  escapeXml,
  excerpt,
  truncate,
  getInitials,
  avatarColorFor,
  normalizeEmail,
  validateEmail,
  validateUsername,
  validatePassword,
  toInt,
  positiveInt,
  stripUndefined,
};
