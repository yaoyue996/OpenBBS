'use strict';

const express = require('express');
const { getSettings } = require('../db');
const { getCategory, getTopics, countTopics, pagination, getCategories } = require('../services');
const { HTTPError } = require('../middleware');
const { toInt } = require('../utils');

const router = express.Router();

router.get('/c/:id', (req, res) => {
  const category = getCategory(toInt(req.params.id, 0));
  if (!category) throw new HTTPError(404, '分类不存在。');

  const sort = ['latest', 'new', 'hot'].includes(String(req.query.sort)) ? String(req.query.sort) : 'latest';
  const perPage = Math.min(100, Math.max(5, toInt(getSettings().topics_per_page, 20)));
  const total = countTopics({ categoryId: category.id });
  const pager = pagination(req, perPage, total);
  const topics = getTopics({ categoryId: category.id, sort, limit: perPage, offset: pager.offset });

  return res.render('category', {
    page: 'category',
    pageTitle: category.name,
    metaDescription: category.description,
    category,
    categories: getCategories(),
    topics,
    sort,
    pager,
    total,
  });
});

module.exports = router;
