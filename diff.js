/*
 * 差分ロジック（DOM 非依存）。
 * Myers の O(ND) アルゴリズムを線形空間（middle snake による分割統治）で実装する。
 * ブラウザでは window.Diff、Node では module.exports として公開する。
 */
(function (root) {
  'use strict';

  var CHAR_DIFF_MAX_LEN = 2000; // これを超える行は文字単位の強調をしない
  var CHAR_DIFF_MIN_SIMILARITY = 0.3; // 似ていない行どうしは文字単位で強調しない

  // ---- 汎用シーケンス diff ----------------------------------------------

  // a, b は === で比較できる値の配列。
  // 戻り値は連続区間の配列: {op: 'eq'|'del'|'ins', aStart, aEnd, bStart, bEnd}
  function diffSeq(a, b) {
    var ops = []; // 1 要素ごとの操作: 0=eq, 1=del, 2=ins
    compare(a, 0, a.length, b, 0, b.length, ops);

    var runs = [];
    var ai = 0, bi = 0;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var last = runs[runs.length - 1];
      if (!last || last.code !== op) {
        last = { code: op, aStart: ai, aEnd: ai, bStart: bi, bEnd: bi };
        runs.push(last);
      }
      if (op !== 2) last.aEnd = ++ai;
      if (op !== 1) last.bEnd = ++bi;
    }
    return runs.map(function (r) {
      return {
        op: r.code === 0 ? 'eq' : r.code === 1 ? 'del' : 'ins',
        aStart: r.aStart, aEnd: r.aEnd, bStart: r.bStart, bEnd: r.bEnd
      };
    });
  }

  function push(ops, code, n) {
    for (var i = 0; i < n; i++) ops.push(code);
  }

  function compare(a, aLo, aHi, b, bLo, bHi, ops) {
    // 共通の先頭
    var pre = 0;
    while (aLo + pre < aHi && bLo + pre < bHi && a[aLo + pre] === b[bLo + pre]) pre++;
    push(ops, 0, pre);
    aLo += pre; bLo += pre;

    // 共通の末尾（後で出力する）
    var suf = 0;
    while (aHi - suf > aLo && bHi - suf > bLo && a[aHi - suf - 1] === b[bHi - suf - 1]) suf++;
    aHi -= suf; bHi -= suf;

    if (aLo === aHi) {
      push(ops, 2, bHi - bLo);
    } else if (bLo === bHi) {
      push(ops, 1, aHi - aLo);
    } else {
      var split = bisect(a, aLo, aHi, b, bLo, bHi);
      if (split) {
        compare(a, aLo, aLo + split[0], b, bLo, bLo + split[1], ops);
        compare(a, aLo + split[0], aHi, b, bLo + split[1], bHi, ops);
      } else {
        push(ops, 1, aHi - aLo);
        push(ops, 2, bHi - bLo);
      }
    }
    push(ops, 0, suf);
  }

  // middle snake を探し、分割点 [x, y]（区間先頭からの相対位置）を返す。
  // 見つからない／自明な分割にしかならない場合は null。
  function bisect(a, aLo, aHi, b, bLo, bHi) {
    var n = aHi - aLo, m = bHi - bLo;
    var maxD = Math.ceil((n + m) / 2);
    var off = maxD + 1;
    var len = 2 * maxD + 3;
    var v1 = new Int32Array(len).fill(-1);
    var v2 = new Int32Array(len).fill(-1);
    v1[off + 1] = 0;
    v2[off + 1] = 0;
    var delta = n - m;
    var front = (delta & 1) !== 0;
    var k1start = 0, k1end = 0, k2start = 0, k2end = 0;

    for (var d = 0; d < maxD; d++) {
      // 前方向
      for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
        var i1 = off + k1;
        var x1 = (k1 === -d || (k1 !== d && v1[i1 - 1] < v1[i1 + 1])) ? v1[i1 + 1] : v1[i1 - 1] + 1;
        var y1 = x1 - k1;
        while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) { x1++; y1++; }
        v1[i1] = x1;
        if (x1 > n) {
          k1end += 2;
        } else if (y1 > m) {
          k1start += 2;
        } else if (front) {
          var j2 = off + delta - k1;
          if (j2 >= 0 && j2 < len && v2[j2] !== -1 && x1 >= n - v2[j2]) {
            return validSplit(x1, y1, n, m);
          }
        }
      }
      // 後ろ方向
      for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
        var i2 = off + k2;
        var x2 = (k2 === -d || (k2 !== d && v2[i2 - 1] < v2[i2 + 1])) ? v2[i2 + 1] : v2[i2 - 1] + 1;
        var y2 = x2 - k2;
        while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) { x2++; y2++; }
        v2[i2] = x2;
        if (x2 > n) {
          k2end += 2;
        } else if (y2 > m) {
          k2start += 2;
        } else if (!front) {
          var j1 = off + delta - k2;
          if (j1 >= 0 && j1 < len && v1[j1] !== -1) {
            var fx = v1[j1];
            var fy = fx - (delta - k2);
            if (fx >= n - x2) return validSplit(fx, fy, n, m);
          }
        }
      }
    }
    return null;
  }

  function validSplit(x, y, n, m) {
    if (x < 0 || y < 0 || x > n || y > m) return null;
    if ((x === 0 && y === 0) || (x === n && y === m)) return null;
    return [x, y];
  }

  // 文字列配列を整数 ID 配列に変換する（比較を高速にするため）
  function toIds(seqA, seqB) {
    var map = new Map();
    function conv(s) {
      var out = new Array(s.length);
      for (var i = 0; i < s.length; i++) {
        var id = map.get(s[i]);
        if (id === undefined) { id = map.size; map.set(s[i], id); }
        out[i] = id;
      }
      return out;
    }
    return [conv(seqA), conv(seqB)];
  }

  // ---- 文字単位 diff ----------------------------------------------------

  // 戻り値: {a: [{text, changed}], b: [{text, changed}]}
  // 似ていない／長すぎる行は null（行全体の強調だけにする）
  function diffChars(lineA, lineB) {
    var ca = Array.from(lineA), cb = Array.from(lineB);
    if (ca.length > CHAR_DIFF_MAX_LEN || cb.length > CHAR_DIFF_MAX_LEN) return null;
    var runs = diffSeq(ca, cb);

    var same = 0;
    runs.forEach(function (r) { if (r.op === 'eq') same += r.aEnd - r.aStart; });
    var total = ca.length + cb.length;
    if (total > 0 && (2 * same) / total < CHAR_DIFF_MIN_SIMILARITY) return null;

    var pa = [], pb = [];
    runs.forEach(function (r) {
      if (r.op !== 'ins') addPart(pa, ca.slice(r.aStart, r.aEnd).join(''), r.op !== 'eq');
      if (r.op !== 'del') addPart(pb, cb.slice(r.bStart, r.bEnd).join(''), r.op !== 'eq');
    });
    return { a: pa, b: pb };
  }

  function addPart(parts, text, changed) {
    if (!text) return;
    var last = parts[parts.length - 1];
    if (last && last.changed === changed) last.text += text;
    else parts.push({ text: text, changed: changed });
  }

  // ---- 行単位 diff ------------------------------------------------------

  function splitLines(text) {
    if (text === '') return [];
    return text.replace(/\r\n?/g, '\n').split('\n');
  }

  function normalizeWs(line) {
    return line.replace(/\s+/g, ' ').trim();
  }

  // 戻り値:
  // {
  //   blocks: [
  //     {type: 'eq', lines: [{aNo, bNo, aText, bText}]},
  //     {type: 'change', dels: [{no, text, parts}], ins: [{no, text, parts}]}
  //   ],
  //   added, removed, identical
  // }
  // parts は [{text, changed}] か null（行内の強調なし）
  function diffLines(textA, textB, opts) {
    opts = opts || {};
    var la = splitLines(textA), lb = splitLines(textB);
    var ka = la, kb = lb;
    if (opts.ignoreWhitespace) {
      ka = la.map(normalizeWs);
      kb = lb.map(normalizeWs);
    }
    var ids = toIds(ka, kb);
    var runs = diffSeq(ids[0], ids[1]);

    var blocks = [];
    var added = 0, removed = 0;
    runs.forEach(function (r) {
      if (r.op === 'eq') {
        var lines = [];
        for (var i = 0; i < r.aEnd - r.aStart; i++) {
          lines.push({
            aNo: r.aStart + i + 1, bNo: r.bStart + i + 1,
            aText: la[r.aStart + i], bText: lb[r.bStart + i]
          });
        }
        blocks.push({ type: 'eq', lines: lines });
        return;
      }
      var last = blocks[blocks.length - 1];
      if (!last || last.type !== 'change') {
        last = { type: 'change', dels: [], ins: [] };
        blocks.push(last);
      }
      if (r.op === 'del') {
        for (var j = r.aStart; j < r.aEnd; j++) last.dels.push({ no: j + 1, text: la[j], parts: null });
        removed += r.aEnd - r.aStart;
      } else {
        for (var k = r.bStart; k < r.bEnd; k++) last.ins.push({ no: k + 1, text: lb[k], parts: null });
        added += r.bEnd - r.bStart;
      }
    });

    blocks.forEach(function (bl) { if (bl.type === 'change') pairChanges(bl); });

    return { blocks: blocks, added: added, removed: removed, identical: added === 0 && removed === 0 };
  }

  // 変更ブロック内の削除行と追加行を先頭から順に組にし、行内の変更箇所を求める
  function pairChanges(block) {
    var n = Math.min(block.dels.length, block.ins.length);
    for (var i = 0; i < n; i++) {
      var cd = diffChars(block.dels[i].text, block.ins[i].text);
      if (cd) {
        block.dels[i].parts = cd.a;
        block.ins[i].parts = cd.b;
      }
    }
    return block;
  }

  var Diff = {
    diffSeq: diffSeq,
    diffChars: diffChars,
    diffLines: diffLines,
    pairChanges: pairChanges,
    splitLines: splitLines
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Diff;
  else root.Diff = Diff;
})(this);
