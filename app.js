(function () {
  'use strict';

  var CONTEXT = 3; // 変更の前後に残す行数
  var MAX_PANES = 26; // A〜Z
  var DEBOUNCE_MS = 150;

  var inputsEl = document.getElementById('inputs');
  var resultsEl = document.getElementById('results');
  var modeGroup = document.getElementById('mode-group');
  var ignoreWs = document.getElementById('ignore-ws');
  var addBtn = document.getElementById('add-btn');
  var narrow = window.matchMedia('(max-width: 640px)');

  // ---- 入力欄 ----------------------------------------------------------

  function labelOf(i) {
    return String.fromCharCode(65 + i);
  }

  function panes() {
    return Array.prototype.slice.call(inputsEl.querySelectorAll('.pane'));
  }

  function addPane() {
    var pane = el('div', 'pane');
    var head = el('div', 'pane-head');
    var label = el('span', 'pane-label');
    var remove = el('button', 'remove');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.addEventListener('click', function () {
      pane.remove();
      refreshPanes();
      render();
    });
    head.append(label, remove);

    var ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.addEventListener('input', scheduleRender);

    pane.append(head, ta);
    inputsEl.appendChild(pane);
    refreshPanes();
    return ta;
  }

  function refreshPanes() {
    var ps = panes();
    ps.forEach(function (p, i) {
      var name = labelOf(i);
      p.querySelector('.pane-label').textContent = name;
      p.querySelector('textarea').placeholder = 'テキスト ' + name + ' を貼り付け';
      p.querySelector('textarea').setAttribute('aria-label', 'テキスト ' + name);
      var rm = p.querySelector('.remove');
      rm.hidden = ps.length <= 2;
      rm.title = name + ' を削除';
    });
    modeGroup.hidden = ps.length < 3;
    addBtn.disabled = ps.length >= MAX_PANES;
  }

  // ---- 描画 ------------------------------------------------------------

  var timer = null;
  function scheduleRender() {
    clearTimeout(timer);
    timer = setTimeout(render, DEBOUNCE_MS);
  }

  function checked(name) {
    return document.querySelector('input[name="' + name + '"]:checked').value;
  }

  function render() {
    clearTimeout(timer);
    var texts = panes().map(function (p) { return p.querySelector('textarea').value; });
    resultsEl.replaceChildren();

    if (texts.every(function (t) { return t === ''; })) {
      var hint = el('p', 'empty-hint');
      hint.textContent = '各欄にテキストを貼り付けると、ここに差分が表示されます。';
      resultsEl.appendChild(hint);
      return;
    }

    var pairs = [];
    var chain = texts.length >= 3 && checked('mode') === 'chain';
    for (var i = 1; i < texts.length; i++) pairs.push([chain ? i - 1 : 0, i]);

    var split = checked('view') === 'split' && !narrow.matches;
    var opts = { ignoreWhitespace: ignoreWs.checked };

    pairs.forEach(function (pr) {
      var res = Diff.diffLines(texts[pr[0]], texts[pr[1]], opts);
      resultsEl.appendChild(renderPair(labelOf(pr[0]), labelOf(pr[1]), res, split));
    });
  }

  function renderPair(nameA, nameB, res, split) {
    var sec = el('section', 'pair');
    var head = el('div', 'pair-head');
    var h = el('h2');
    h.textContent = nameA + ' → ' + nameB;
    head.appendChild(h);
    if (!res.identical) {
      head.append(text('span', 'stat-add', '+' + res.added), text('span', 'stat-del', '−' + res.removed));
    }
    sec.appendChild(head);

    if (res.identical) {
      sec.appendChild(text('div', 'same', '差分なし'));
      return sec;
    }

    var table = el('table', 'diff ' + (split ? 'split' : 'inline'));
    var tbody = el('tbody');
    table.appendChild(tbody);
    var R = split ? splitRows : inlineRows;

    res.blocks.forEach(function (b, bi) {
      if (b.type === 'change') {
        R.change(b).forEach(function (tr) { tbody.appendChild(tr); });
        return;
      }
      var lines = b.lines;
      var first = bi === 0, last = bi === res.blocks.length - 1;
      var keepHead = first ? 0 : CONTEXT;
      var keepTail = last ? 0 : CONTEXT;
      var hidden = lines.length - keepHead - keepTail;
      if (hidden < 2) {
        lines.forEach(function (l) { tbody.appendChild(R.eq(l)); });
        return;
      }
      lines.slice(0, keepHead).forEach(function (l) { tbody.appendChild(R.eq(l)); });
      tbody.appendChild(foldRow(lines.slice(keepHead, keepHead + hidden), R.eq, 4));
      lines.slice(keepHead + hidden).forEach(function (l) { tbody.appendChild(R.eq(l)); });
    });

    var wrap = el('div', 'diff-wrap');
    wrap.appendChild(table);
    sec.appendChild(wrap);
    return sec;
  }

  function foldRow(lines, makeRow, colspan) {
    var tr = el('tr', 'fold');
    var td = el('td');
    td.colSpan = colspan;
    var btn = el('button');
    btn.type = 'button';
    btn.textContent = '… ' + lines.length + ' 行省略（クリックで展開）…';
    btn.addEventListener('click', function () {
      var frag = document.createDocumentFragment();
      lines.forEach(function (l) { frag.appendChild(makeRow(l)); });
      tr.replaceWith(frag);
    });
    td.appendChild(btn);
    tr.appendChild(td);
    return tr;
  }

  var inlineRows = {
    eq: function (l) {
      return row('', [cell('ln', l.aNo), cell('ln', l.bNo), cell('sign', ''), codeCell('code', l.aText, null)]);
    },
    change: function (b) {
      var out = [];
      b.dels.forEach(function (d) {
        out.push(row('del', [cell('ln', d.no), cell('ln', ''), cell('sign', '-'), codeCell('code', d.text, d.parts)]));
      });
      b.ins.forEach(function (d) {
        out.push(row('ins', [cell('ln', ''), cell('ln', d.no), cell('sign', '+'), codeCell('code', d.text, d.parts)]));
      });
      return out;
    }
  };

  var splitRows = {
    eq: function (l) {
      return row('', [cell('ln', l.aNo), codeCell('code', l.aText, null), cell('ln', l.bNo), codeCell('code', l.bText, null)]);
    },
    change: function (b) {
      var out = [];
      var n = Math.max(b.dels.length, b.ins.length);
      for (var i = 0; i < n; i++) {
        var d = b.dels[i], s = b.ins[i];
        out.push(row('', [
          cell('ln' + (d ? ' del' : ' blank'), d ? d.no : ''),
          d ? codeCell('code del', d.text, d.parts) : cell('code blank', ''),
          cell('ln' + (s ? ' ins' : ' blank'), s ? s.no : ''),
          s ? codeCell('code ins', s.text, s.parts) : cell('code blank', '')
        ]));
      }
      return out;
    }
  };

  // ---- DOM ヘルパー ------------------------------------------------------

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function text(tag, cls, s) {
    var e = el(tag, cls);
    e.textContent = s;
    return e;
  }

  function row(cls, cells) {
    var tr = el('tr', cls);
    tr.append.apply(tr, cells);
    return tr;
  }

  function cell(cls, s) {
    return text('td', cls, String(s));
  }

  function codeCell(cls, s, parts) {
    var td = el('td', cls);
    if (!parts) {
      td.textContent = s;
    } else {
      parts.forEach(function (p) {
        if (p.changed) td.appendChild(text('span', 'hl', p.text));
        else td.appendChild(document.createTextNode(p.text));
      });
    }
    // 空行でも高さを保つ
    if (!s) td.appendChild(document.createTextNode('​'));
    return td;
  }

  // ---- テーマ ----------------------------------------------------------

  var themeBtn = document.getElementById('theme-btn');
  var root = document.documentElement;

  function updateThemeBtn() {
    var dark = root.dataset.theme === 'dark';
    themeBtn.textContent = dark ? '☀' : '☾';
    themeBtn.title = dark ? 'ライトモードにする' : 'ダークモードにする';
    themeBtn.setAttribute('aria-label', themeBtn.title);
  }

  themeBtn.addEventListener('click', function () {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
    updateThemeBtn();
  });

  // ボタンで選んでいない間は OS の設定変更に追従する
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (err) {}
    if (saved) return;
    root.dataset.theme = e.matches ? 'dark' : 'light';
    updateThemeBtn();
  });

  updateThemeBtn();

  // ---- 初期化 ----------------------------------------------------------

  addBtn.addEventListener('click', function () {
    addPane().focus();
    render();
  });
  document.querySelectorAll('input[name="mode"], input[name="view"]').forEach(function (r) {
    r.addEventListener('change', render);
  });
  ignoreWs.addEventListener('change', render);
  narrow.addEventListener('change', render);

  addPane();
  addPane();
  render();
})();
