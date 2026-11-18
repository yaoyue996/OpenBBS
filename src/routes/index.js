'use strict';

const express = require('express');
const { config } = require('../config');
const { db, getSettings, getStats } = require('../db');
const { renderMarkdown } = require('../markdown');
const {
  pagination,
  getCategories,
  getLatestTopicsInCategory,
  getTopics,
  countTopics,
  getActiveUsers,
  getHotTopics,
  getCategory,
  searchTopics,
  searchPosts,
  searchSnippet,
} = require('../services');
const { HTTPError } = require('../middleware');
const { escapeXml, excerpt, toInt } = require('../utils');

const router = express.Router();

function homeData() {
  const stats = getStats();
  const categories = getCategories().map((category) => ({
    ...category,
    latest: getLatestTopicsInCategory(category.id),
  }));
  return {
    stats,
    categories,
    activeUsers: getActiveUsers(10),
    hotTopics: getHotTopics(6),
  };
}

router.get('/', (req, res) => {
  const tab = ['latest', 'new', 'hot'].includes(String(req.query.tab)) ? String(req.query.tab) : 'latest';
  const perPage = 10;
  const total = countTopics();
  const pager = pagination(req, perPage, total);
  const topics = getTopics({ sort: tab, limit: perPage, offset: pager.offset });
  const data = homeData();
  const settings = getSettings();

  res.render('home', {
    page: 'home',
    pageTitle: '',
    metaDescription: settings.site_description,
    ...data,
    topics,
    tab,
    pager,
    announcementHtml: renderMarkdown(settings.site_announcement),
  });
});

router.get('/topics', (req, res) => {
  const sort = ['latest', 'new', 'hot'].includes(String(req.query.sort)) ? String(req.query.sort) : 'latest';
  const categoryId = toInt(req.query.category, 0) || null;
  const category = categoryId ? getCategory(categoryId) : null;
  if (categoryId && !category) throw new HTTPError(404, '分类不存在。');

  const perPage = Math.min(50, Math.max(5, toInt(getSettings().topics_per_page, 20)));
  const total = countTopics({ categoryId });
  const pager = pagination(req, perPage, total);
  const topics = getTopics({ categoryId, sort, limit: perPage, offset: pager.offset });
  const categories = getCategories();

  return res.render('topics', {
    page: 'topics',
    pageTitle: category ? category.name : '全部话题',
    metaDescription: category ? category.description : getSettings().site_description,
    topics,
    categories,
    category,
    categoryId,
    sort,
    pager,
    total,
  });
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const type = req.query.type === 'posts' ? 'posts' : 'topics';
  let topicResults = [];
  let postResults = [];
  if (q) {
    if (type === 'topics') {
      topicResults = searchTopics(q, 50);
    } else {
      postResults = searchPosts(q, 50).map((post) => ({
        ...post,
        snippet: searchSnippet(post.content, q),
      }));
    }
  }
  res.render('search', {
    page: 'search',
    pageTitle: q ? `搜索：${q}` : '搜索',
    metaDescription: '搜索社区中的话题和回复',
    q,
    type,
    topicResults,
    postResults,
  });
});

router.get('/about', (req, res) => {
  const settings = getSettings();
  const stats = getStats();
  const team = db.prepare(
    `SELECT id, username, role, bio, avatar_color, avatar_emoji, last_seen_at, created_at
     FROM users WHERE role IN ('admin', 'moderator') AND is_banned = 0
     ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id ASC`,
  ).all();
  res.render('about', {
    page: 'about',
    pageTitle: '关于本站',
    metaDescription: settings.site_description,
    stats,
    team,
    announcementHtml: renderMarkdown(settings.site_announcement),
  });
});

router.get('/feed.xml', (req, res) => {
  const settings = getSettings();
  const topics = db.prepare(
    `SELECT t.id, t.title, t.created_at, t.last_reply_at, u.username, c.name AS category_name,
       (SELECT p.content FROM posts p WHERE p.topic_id = t.id AND p.is_first = 1 AND p.is_deleted = 0 LIMIT 1) AS content
     FROM topics t JOIN users u ON u.id = t.user_id JOIN categories c ON c.id = t.category_id
     WHERE t.is_deleted = 0 ORDER BY t.last_reply_at DESC LIMIT 30`,
  ).all();
  const base = config.siteUrl;
  const items = topics.map((topic) => {
    const url = `${base}/t/${topic.id}`;
    return [
      '    <item>',
      `      <title>${escapeXml(topic.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${new Date(Number(topic.created_at)).toUTCString()}</pubDate>`,
      `      <category>${escapeXml(topic.category_name)}</category>`,
      `      <dc:creator>${escapeXml(topic.username)}</dc:creator>`,
      `      <description>${escapeXml(excerpt(topic.content || '', 300))}</description>`,
      '    </item>',
    ].join('\n');
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(settings.site_name)}</title>
    <link>${escapeXml(base)}</link>
    <description>${escapeXml(settings.site_description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>OpenBBS ${escapeXml(config.version)}</generator>
${items}
  </channel>
</rss>`;
  res.type('application/rss+xml; charset=utf-8').send(xml);
});

router.get('/sitemap.xml', (req, res) => {
  const base = config.siteUrl;
  const categories = getCategories();
  const topics = db.prepare(
    'SELECT id, updated_at FROM topics WHERE is_deleted = 0 ORDER BY last_reply_at DESC LIMIT 1000',
  ).all();
  const urls = [
    { loc: base, lastmod: new Date().toISOString() },
    { loc: `${base}/topics`, lastmod: new Date().toISOString() },
    { loc: `${base}/about`, lastmod: new Date().toISOString() },
    ...categories.map((c) => ({ loc: `${base}/c/${c.id}`, lastmod: new Date().toISOString() })),
    ...topics.map((t) => ({ loc: `${base}/t/${t.id}`, lastmod: new Date(Number(t.updated_at)).toISOString() })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeXml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>`;
  res.type('application/xml; charset=utf-8').send(xml);
});

router.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.set('Cache-Control', 'no-store').json({
      status: 'ok',
      version: config.version,
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({ status: 'error', error: 'database unavailable' });
  }
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /settings',
    'Disallow: /notifications',
    'Disallow: /bookmarks',
    'Disallow: /login',
    'Disallow: /register',
    '',
    `Sitemap: ${config.siteUrl}/sitemap.xml`,
    '',
  ].join('\n'));
});

router.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/favicon.svg');
});

module.exports = router;
