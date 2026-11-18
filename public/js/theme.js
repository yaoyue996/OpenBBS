/* OpenBBS — apply the saved theme before first paint to avoid flashing. */
(function () {
  'use strict';

  var KEY = 'openbbs-theme';
  var root = document.documentElement;
  var theme = null;

  try {
    theme = window.localStorage.getItem(KEY);
  } catch (error) {
    theme = null;
  }

  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  root.setAttribute('data-theme', theme);

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#070b16' : '#4f46e5');
}());
