/* OpenBBS — progressive enhancement for theme, editor, drafts and actions. */
(function () {
  'use strict';

  var doc = document;
  var THEME_KEY = 'openbbs-theme';
  var toastEl = null;
  var toastTimer = null;

  function csrfToken() {
    var meta = doc.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function toast(message, type) {
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = type === 'error' ? 'toast toast--error' : 'toast';
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
      toastEl = null;
    }, 2800);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      doc.body.appendChild(area);
      area.select();
      try {
        if (doc.execCommand('copy')) resolve();
        else reject(new Error('copy failed'));
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Theme                                                                  */
  /* ---------------------------------------------------------------------- */

  function applyTheme(theme) {
    doc.documentElement.setAttribute('data-theme', theme);
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#070b16' : '#4f46e5');
  }

  function initTheme() {
    var toggle = doc.querySelector('[data-theme-toggle]');
    if (!toggle) return;

    toggle.setAttribute('aria-pressed', doc.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false');

    toggle.addEventListener('click', function () {
      var next = doc.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (error) {
        /* storage may be unavailable */
      }
      toggle.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
    });

    window.addEventListener('storage', function (event) {
      if (event.key === THEME_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
        applyTheme(event.newValue);
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Menus, flash messages, confirmations, copy                             */
  /* ---------------------------------------------------------------------- */

  function initMenus() {
    doc.addEventListener('click', function (event) {
      doc.querySelectorAll('details.user-menu[open], details.manage-menu[open]').forEach(function (details) {
        if (!details.contains(event.target)) details.open = false;
      });
    });

    doc.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      doc.querySelectorAll('details.user-menu[open], details.manage-menu[open]').forEach(function (details) {
        details.open = false;
      });
    });
  }

  function initFlash() {
    doc.addEventListener('click', function (event) {
      var close = event.target.closest('[data-flash-close]');
      if (!close) return;
      var flash = close.closest('.flash');
      if (flash && flash.parentNode) flash.parentNode.removeChild(flash);
    });
  }

  function initConfirm() {
    doc.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || !form.getAttribute) return;
      var message = form.getAttribute('data-confirm');
      if (message && !window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function initCopy() {
    doc.addEventListener('click', function (event) {
      var button = event.target.closest('[data-copy]');
      if (!button) return;
      var text = button.getAttribute('data-copy');
      if (!text) return;
      copyText(text).then(function () {
        toast('链接已复制到剪贴板');
      }).catch(function () {
        toast('复制失败，请手动复制地址栏链接', 'error');
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Like / bookmark without leaving the page                               */
  /* ---------------------------------------------------------------------- */

  function postJson(form) {
    var token = csrfToken();
    var body = new URLSearchParams();
    body.set('_csrf', token);

    return fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'fetch',
        'X-CSRF-Token': token,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: body.toString()
    }).then(function (response) {
      if (response.redirected) {
        window.location.href = response.url;
        return null;
      }
      var type = response.headers.get('content-type') || '';
      if (type.indexOf('application/json') === -1) {
        window.location.reload();
        return null;
      }
      return response.json().then(function (data) {
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || '操作失败，请稍后再试。');
        }
        return data;
      });
    });
  }

  function initAsyncActions() {
    if (!window.fetch) return;

    doc.addEventListener('submit', function (event) {
      if (event.defaultPrevented) return;
      var form = event.target;
      if (!form || !form.hasAttribute) return;

      var isLike = form.hasAttribute('data-like-form');
      var isBookmark = form.hasAttribute('data-bookmark-form');
      if (!isLike && !isBookmark) return;

      event.preventDefault();
      var button = form.querySelector(isLike ? '[data-like-button]' : '[data-bookmark-button]');
      if (button) button.disabled = true;

      postJson(form).then(function (data) {
        if (!data) return;
        if (isLike) {
          var count = form.querySelector('[data-like-count]');
          if (button) {
            button.classList.toggle('is-active', Boolean(data.liked));
            button.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
          }
          if (count) count.textContent = String(data.count);
          toast(data.liked ? '已点赞' : '已取消点赞');
        } else {
          var label = form.querySelector('[data-bookmark-label]');
          if (button) button.classList.toggle('is-active', Boolean(data.bookmarked));
          if (label) label.textContent = data.bookmarked ? '已收藏' : '收藏';
          toast(data.bookmarked ? '已收藏该主题' : '已取消收藏');
        }
      }).catch(function (error) {
        toast(error.message || '网络错误，请稍后再试。', 'error');
      }).finally(function () {
        if (button) button.disabled = false;
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Markdown editor                                                        */
  /* ---------------------------------------------------------------------- */

  function replaceRange(textarea, text, selectionStart, selectionEnd) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    textarea.value = value.slice(0, start) + text + value.slice(end);
    textarea.focus();
    if (typeof selectionStart === 'number') {
      textarea.setSelectionRange(selectionStart, typeof selectionEnd === 'number' ? selectionEnd : selectionStart);
    } else {
      var caret = start + text.length;
      textarea.setSelectionRange(caret, caret);
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wrapInline(textarea, marker, placeholder) {
    var selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    var inner = selected || placeholder;
    var start = textarea.selectionStart;
    replaceRange(textarea, marker + inner + marker, start + marker.length, start + marker.length + inner.length);
  }

  function updateSelectedLines(textarea, prefix, matcher) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;

    var block = value.slice(lineStart, lineEnd);
    var lines = block.split('\n');
    var pattern = matcher || null;
    var remove = lines.every(function (line) {
      return pattern ? pattern.test(line) : line.indexOf(prefix) === 0;
    });

    var updated = lines.map(function (line) {
      if (remove) {
        if (pattern) return line.replace(pattern, '');
        return line.slice(prefix.length);
      }
      return prefix + line;
    }).join('\n');

    var scrollTop = textarea.scrollTop;
    textarea.value = value.slice(0, lineStart) + updated + value.slice(lineEnd);
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + updated.length);
    textarea.scrollTop = scrollTop;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function toggleHeading(textarea) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;
    var line = value.slice(lineStart, lineEnd);
    var match = /^#{1,6}\s+/.exec(line);
    var updated = match ? line.slice(match[0].length) : '## ' + line;

    textarea.value = value.slice(0, lineStart) + updated + value.slice(lineEnd);
    textarea.focus();
    var caret = lineStart + updated.length;
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertLink(textarea, image) {
    var selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    var label = selected || (image ? '图片描述' : '链接文字');
    var snippet = image ? '![' + label + '](https://)' : '[' + label + '](https://)';
    var start = textarea.selectionStart;
    var urlStart = start + snippet.indexOf('(https://)') + 1;
    replaceRange(textarea, snippet, urlStart, urlStart + 8);
  }

  function insertCode(textarea) {
    var selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (selected.indexOf('\n') !== -1) {
      var start = textarea.selectionStart;
      var block = '```\n' + selected + '\n```';
      replaceRange(textarea, block, start + 4, start + 4 + selected.length);
      return;
    }
    wrapInline(textarea, '`', '代码');
  }

  function applyMarkdown(textarea, action) {
    switch (action) {
      case 'bold':
        wrapInline(textarea, '**', '加粗文字');
        break;
      case 'italic':
        wrapInline(textarea, '*', '斜体文字');
        break;
      case 'heading':
        toggleHeading(textarea);
        break;
      case 'link':
        insertLink(textarea, false);
        break;
      case 'image':
        insertLink(textarea, true);
        break;
      case 'code':
        insertCode(textarea);
        break;
      case 'quote':
        updateSelectedLines(textarea, '> ');
        break;
      case 'list':
        updateSelectedLines(textarea, '- ', /^[-*]\s+/);
        break;
      default:
        break;
    }
  }

  function initEditor(editor) {
    var textarea = editor.querySelector('[data-editor-input]');
    if (!textarea) return;

    var preview = editor.querySelector('[data-editor-preview]');
    var previewButton = editor.querySelector('[data-preview-toggle]');
    var status = editor.querySelector('[data-draft-status]');
    var draftKey = 'openbbs:draft:' + (editor.getAttribute('data-draft-key') || 'content');
    var form = textarea.closest('form');
    var previewing = false;
    var saveTimer = null;
    var previewRequest = 0;

    function setStatus(text, withRestore, draftContent) {
      if (!status) return;
      status.textContent = '';
      if (!withRestore) {
        status.textContent = text;
        return;
      }
      status.appendChild(doc.createTextNode(text));
      var restore = doc.createElement('button');
      restore.type = 'button';
      restore.className = 'editor-status-action';
      restore.textContent = '恢复';
      restore.addEventListener('click', function () {
        textarea.value = draftContent;
        textarea.focus();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        if (status) status.textContent = '已恢复上次草稿';
      });
      status.appendChild(restore);
    }

    function clearDraft() {
      try {
        localStorage.removeItem(draftKey);
      } catch (error) {
        /* ignore */
      }
    }

    function saveDraft() {
      saveTimer = null;
      if (!textarea.value.trim()) {
        clearDraft();
        setStatus('');
        return;
      }
      try {
        localStorage.setItem(draftKey, JSON.stringify({ content: textarea.value, savedAt: Date.now() }));
        var time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        setStatus('草稿已自动保存 · ' + time);
      } catch (error) {
        setStatus('无法保存草稿（浏览器存储不可用）');
      }
    }

    function scheduleSave() {
      setStatus('正在保存草稿…');
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveDraft, 650);
    }

    /* Restore an unfinished draft. */
    try {
      var rawDraft = localStorage.getItem(draftKey);
      if (rawDraft) {
        var draft = JSON.parse(rawDraft);
        if (draft && typeof draft.content === 'string' && draft.content.trim() && draft.content !== textarea.value) {
          if (!textarea.value.trim()) {
            textarea.value = draft.content;
            setStatus('已恢复上次未发送的草稿');
          } else {
            setStatus('检测到未发送的草稿 · ', true, draft.content);
          }
        }
      }
    } catch (error) {
      /* malformed or unavailable storage */
    }

    textarea.addEventListener('input', scheduleSave);

    editor.querySelectorAll('[data-md]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyMarkdown(textarea, button.getAttribute('data-md'));
      });
    });

    if (previewButton && preview) {
      previewButton.addEventListener('click', function () {
        previewing = !previewing;

        if (!previewing) {
          preview.hidden = true;
          textarea.hidden = false;
          previewButton.classList.remove('is-active');
          var previewLabelOff = previewButton.querySelector('span');
          if (previewLabelOff) previewLabelOff.textContent = '预览';
          textarea.focus();
          return;
        }

        textarea.hidden = true;
        preview.hidden = false;
        previewButton.classList.add('is-active');
        var previewLabelOn = previewButton.querySelector('span');
        if (previewLabelOn) previewLabelOn.textContent = '编辑';

        var requestId = ++previewRequest;
        preview.innerHTML = '<p class="muted">正在渲染预览…</p>';
        var token = csrfToken();

        fetch('/api/preview', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'X-Requested-With': 'fetch',
            'X-CSRF-Token': token,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: new URLSearchParams({ content: textarea.value, _csrf: token }).toString()
        }).then(function (response) {
          if (!response.ok) throw new Error('预览暂时不可用。');
          return response.json();
        }).then(function (data) {
          if (requestId !== previewRequest) return;
          if (!data.ok) throw new Error(data.error || '预览暂时不可用。');
          preview.innerHTML = data.html || '<p class="muted">还没有内容。</p>';
        }).catch(function (error) {
          if (requestId !== previewRequest) return;
          preview.innerHTML = '';
          var message = doc.createElement('p');
          message.className = 'muted';
          message.textContent = error.message || '预览暂时不可用，请稍后再试。';
          preview.appendChild(message);
        });
      });
    }

    textarea.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      }
    });

    if (form) {
      form.addEventListener('submit', function () {
        if (saveTimer) {
          window.clearTimeout(saveTimer);
          saveTimer = null;
        }
        clearDraft();
      });
    }
  }

  function initEditors() {
    doc.querySelectorAll('[data-editor]').forEach(initEditor);
  }

  /* ---------------------------------------------------------------------- */

  function init() {
    initTheme();
    initMenus();
    initFlash();
    initConfirm();
    initCopy();
    initAsyncActions();
    initEditors();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
}());
