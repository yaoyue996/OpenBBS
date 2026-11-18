'use strict';

const express = require('express');
const { renderMarkdown } = require('../markdown');
const { rateLimit } = require('../middleware');

const router = express.Router();

const previewLimiter = rateLimit({
  scope: 'preview',
  windowMs: 60 * 1000,
  max: 90,
  message: '预览请求过于频繁，请稍后再试。',
});

router.post('/preview', previewLimiter, (req, res) => {
  const content = String(req.body.content || '');
  if (content.length > 50000) {
    return res.status(413).json({ ok: false, error: '内容过长。' });
  }
  return res.json({ ok: true, html: renderMarkdown(content) });
});

module.exports = router;
