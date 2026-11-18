'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbbs-test-'));
const adminPassword = 'AdminPass123!';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDir, 'openbbs.db');
process.env.SITE_URL = 'http://127.0.0.1:3000';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = adminPassword;
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.COOKIE_SECURE = 'never';
process.env.TRUST_PROXY = '0';

const { db, ensureSeed } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let baseUrl;

class Client {
  constructor() {
    this.jar = new Map();
  }

  cookieHeader() {
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  storeCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const raw of setCookies) {
      const pair = raw.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || /(?:^|;)\s*max-age=0\s*(?:;|$)/i.test(raw)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (options.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(options.form).toString();
    } else if (options.json) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || 'GET',
      headers,
      body,
      redirect: 'manual',
    });
    this.storeCookies(response);
    return response;
  }

  async page(pathname) {
    const response = await this.request(pathname);
    const html = await response.text();
    return { response, html, token: extractCsrf(html) };
  }

  async csrfToken(pathname = '/') {
    const { response, token } = await this.page(pathname);
    assert.equal(response.status, 200, `expected 200 from ${pathname}`);
    assert.ok(token, `expected a CSRF token on ${pathname}`);
    return token;
  }
}

function extractCsrf(html) {
  const meta = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (meta) return meta[1];
  const input = html.match(/name="_csrf" value="([^"]+)"/);
  return input ? input[1] : null;
}

before(async () => {
  await ensureSeed();
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('OpenBBS end-to-end flow', async (t) => {
  const admin = new Client();
  const user = new Client();
  let topicId;
  let firstPostId;

  await t.test('health check reports a working database', async () => {
    const response = await admin.request('/healthz');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'ok');
  });

  await t.test('POST without CSRF token is rejected', async () => {
    const response = await admin.request('/login', {
      method: 'POST',
      form: { username: 'admin', password: adminPassword },
    });
    assert.equal(response.status, 403);
  });

  await t.test('cross-origin POST is rejected even with a valid token', async () => {
    const token = await admin.csrfToken('/login');
    const response = await admin.request('/login', {
      method: 'POST',
      form: { _csrf: token, username: 'admin', password: adminPassword },
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(response.status, 403);
    const html = await response.text();
    assert.match(html, /请求来源校验失败/);
  });

  await t.test('admin can log in', async () => {
    const token = await admin.csrfToken('/login');
    const response = await admin.request('/login', {
      method: 'POST',
      form: { _csrf: token, username: 'admin', password: adminPassword, next: '/' },
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');
    const home = await admin.page('/');
    assert.equal(home.response.status, 200);
    assert.match(home.html, /个人设置/);
    assert.match(home.html, /管理后台/);
  });

  await t.test('topic creation renders Markdown and neutralizes XSS', async () => {
    const token = await admin.csrfToken('/new');
    const category = db.prepare('SELECT id FROM categories ORDER BY position ASC, id ASC LIMIT 1').get();
    assert.ok(category);

    const title = '集成测试主题：Markdown 与安全';
    const content = [
      '# 测试标题',
      '',
      '**粗体内容**',
      '',
      '<script>window.__xss = 1</script>',
      '',
      '[危险链接](javascript:alert(1))',
    ].join('\n');

    const response = await admin.request('/topics', {
      method: 'POST',
      form: { _csrf: token, title, content, category_id: category.id },
    });
    assert.equal(response.status, 302);
    const location = response.headers.get('location');
    assert.match(location, /^\/t\/\d+$/);
    topicId = Number(location.split('/').pop());

    const topic = await admin.page(location);
    assert.equal(topic.response.status, 200);
    assert.match(topic.html, /<h1>测试标题<\/h1>/);
    assert.match(topic.html, /<strong>粗体内容<\/strong>/);
    assert.match(topic.html, /集成测试主题：Markdown 与安全/);
    assert.doesNotMatch(topic.html, /<script>window\.__xss/);
    assert.doesNotMatch(topic.html, /href="javascript:/i);
    assert.match(topic.html, /&lt;script&gt;/);

    const firstPost = db.prepare(
      'SELECT id FROM posts WHERE topic_id = ? AND is_first = 1 ORDER BY id ASC LIMIT 1',
    ).get(topicId);
    assert.ok(firstPost);
    firstPostId = firstPost.id;
  });

  await t.test('user can register and reply', async () => {
    const token = await user.csrfToken('/register');
    const response = await user.request('/register', {
      method: 'POST',
      form: {
        _csrf: token,
        username: 'tester',
        email: 'tester@example.com',
        password: 'UserPass123!',
        confirm_password: 'UserPass123!',
        website: '',
      },
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');

    const topic = await user.page(`/t/${topicId}`);
    assert.equal(topic.response.status, 200);
    const reply = await user.request(`/t/${topicId}/reply`, {
      method: 'POST',
      form: { _csrf: topic.token, content: '感谢分享，这是**用户**的回复。' },
    });
    assert.equal(reply.status, 302);
    assert.match(reply.headers.get('location'), new RegExp(`^/t/${topicId}\\?page=\\d+#post-\\d+$`));

    const updated = await user.page(`/t/${topicId}`);
    assert.match(updated.html, /感谢分享，这是<strong>用户<\/strong>的回复。/);
  });

  await t.test('topic owner receives a notification', async () => {
    const notifications = await admin.page('/notifications');
    assert.equal(notifications.response.status, 200);
    assert.match(notifications.html, /集成测试主题：Markdown 与安全/);
    assert.match(notifications.html, /回复了你的主题/);
  });

  await t.test('likes and bookmarks work over JSON', async () => {
    const topic = await user.page(`/t/${topicId}`);
    const like = await user.request(`/posts/${firstPostId}/like`, {
      method: 'POST',
      json: {},
      headers: { 'x-csrf-token': topic.token, accept: 'application/json' },
    });
    assert.equal(like.status, 200);
    assert.deepEqual(await like.json(), { ok: true, liked: true, count: 1 });

    const bookmark = await user.request(`/t/${topicId}/bookmark`, {
      method: 'POST',
      json: {},
      headers: { 'x-csrf-token': topic.token, accept: 'application/json' },
    });
    assert.equal(bookmark.status, 200);
    assert.deepEqual(await bookmark.json(), { ok: true, bookmarked: true });

    const bookmarks = await user.page('/bookmarks');
    assert.equal(bookmarks.response.status, 200);
    assert.match(bookmarks.html, /集成测试主题：Markdown 与安全/);

    const unbookmark = await user.request(`/t/${topicId}/bookmark`, {
      method: 'POST',
      json: {},
      headers: { 'x-csrf-token': topic.token, accept: 'application/json' },
    });
    assert.deepEqual(await unbookmark.json(), { ok: true, bookmarked: false });
  });

  await t.test('search finds the new topic', async () => {
    const results = await user.page(`/search?q=${encodeURIComponent('集成测试主题')}`);
    assert.equal(results.response.status, 200);
    assert.match(results.html, /集成测试主题：Markdown 与安全/);
  });

  await t.test('admin dashboard and backup are available', async () => {
    const dashboard = await admin.page('/admin');
    assert.equal(dashboard.response.status, 200);
    assert.match(dashboard.html, /站点设置/);

    const backup = await admin.request('/admin/backup');
    assert.equal(backup.status, 200);
    assert.match(backup.headers.get('content-disposition') || '', /openbbs-backup-.*\.db/);
    const bytes = Buffer.from(await backup.arrayBuffer());
    assert.ok(bytes.length > 0);
  });

  await t.test('static assets and error pages are served', async () => {
    const css = await admin.request('/css/style.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /text\/css/);

    const missing = await admin.page('/this-page-does-not-exist');
    assert.equal(missing.response.status, 404);
    assert.match(missing.html, /页面不存在/);
  });

  await t.test('logout invalidates the session', async () => {
    const token = await admin.csrfToken('/');
    const logout = await admin.request('/logout', {
      method: 'POST',
      form: { _csrf: token },
    });
    assert.equal(logout.status, 302);
    assert.equal(logout.headers.get('location'), '/');

    const settings = await admin.request('/settings');
    assert.equal(settings.status, 302);
    assert.match(settings.headers.get('location') || '', /^\/login/);
  });
});
