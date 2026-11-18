'use strict';

const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  token.attrSet('rel', 'nofollow noopener ugc');
  if (!/^(\/|#|mailto:)/i.test(href)) {
    token.attrSet('target', '_blank');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  return self.renderToken(tokens, idx, options);
};

const sanitizeOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img', 'h1', 'h2', 'del', 'ins', 'sup', 'sub', 'details', 'summary', 'hr',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
    code: ['class'],
    th: ['align'],
    td: ['align'],
    input: ['type', 'checked', 'disabled'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener ugc' }),
    img: sanitizeHtml.simpleTransform('img', { loading: 'lazy', decoding: 'async' }),
  },
  disallowedTagsMode: 'discard',
};

function renderMarkdown(source) {
  const text = String(source ?? '');
  if (!text.trim()) return '';
  return sanitizeHtml(md.render(text), sanitizeOptions);
}

function renderMarkdownInline(source) {
  const text = String(source ?? '');
  if (!text.trim()) return '';
  return sanitizeHtml(md.renderInline(text), sanitizeOptions);
}

module.exports = { renderMarkdown, renderMarkdownInline };
