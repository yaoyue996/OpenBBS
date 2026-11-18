'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown, renderMarkdownInline } = require('../src/markdown');
const {
  validateUsername,
  validateEmail,
  validatePassword,
  normalizeEmail,
  excerpt,
  truncate,
  getInitials,
  avatarColorFor,
  toInt,
  positiveInt,
  escapeHtml,
} = require('../src/utils');
const { hashPassword, verifyPassword, generatePassword, sha256, safeEqual } = require('../src/passwords');

test('Markdown rendering keeps formatting and removes dangerous HTML', () => {
  const html = renderMarkdown([
    '# 标题',
    '',
    '**粗体** 和 *斜体* 以及 `代码`',
    '',
    '<script>alert(1)</script>',
    '',
    '[危险链接](javascript:alert(1))',
    '',
    '[正常链接](https://example.com)',
    '',
    '<img src=x onerror=alert(1)>',
  ].join('\n'));

  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /<img[^>]+onerror/i);
  assert.match(html, /<a href="https:\/\/example\.com" rel="nofollow noopener ugc" target="_blank">正常链接<\/a>/);
});

test('Inline markdown strips HTML', () => {
  const html = renderMarkdownInline('你好 **世界** <script>x</script>');
  assert.match(html, /<strong>世界<\/strong>/);
  assert.doesNotMatch(html, /<script/i);
});

test('Input validation', () => {
  assert.equal(validateUsername('alice_01'), true);
  assert.equal(validateUsername('张三'), true);
  assert.equal(validateUsername('a'), false);
  assert.equal(validateUsername('admin'), false);
  assert.equal(validateUsername('bad name'), false);
  assert.equal(validateUsername('x'.repeat(25)), false);

  assert.equal(validateEmail('User@Example.COM'), true);
  assert.equal(validateEmail('not-an-email'), false);
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');

  assert.equal(validatePassword('12345678'), true);
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('x'.repeat(129)), false);
});

test('Utility helpers', () => {
  assert.equal(excerpt('# 标题\n\n**加粗**内容 [链接](https://example.com)', 100), '标题 加粗内容 链接');
  assert.equal(truncate('abcdef', 4), 'abcd…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(getInitials('张三'), '张');
  assert.equal(getInitials('alice'), 'AL');
  assert.match(avatarColorFor('alice'), /^#[0-9a-f]{6}$/i);
  assert.equal(toInt('42', 0), 42);
  assert.equal(toInt('abc', 7), 7);
  assert.equal(positiveInt('-1', 5), 5);
  assert.equal(escapeHtml('<a>&"'), '&lt;a&gt;&amp;&quot;');
});

test('Password hashing round-trip', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
  assert.equal(await verifyPassword('anything', 'malformed'), false);

  const generated = generatePassword(16);
  assert.equal(generated.length, 16);
  assert.match(generated, /^[A-Za-z2-9]+$/);
  assert.notEqual(generatePassword(16), generated);
});

test('Hash helpers are deterministic and timing-safe', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(safeEqual('token', 'token'), true);
  assert.equal(safeEqual('token', 'other'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('short', 'longer'), false);
});
