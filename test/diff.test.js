'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Diff = require('../diff.js');

// runs を適用して a から b を復元できるか確認する
function apply(a, b, runs) {
  const outA = [], outB = [];
  let ai = 0, bi = 0;
  for (const r of runs) {
    assert.equal(r.aStart, ai);
    assert.equal(r.bStart, bi);
    if (r.op === 'eq') {
      assert.equal(r.aEnd - r.aStart, r.bEnd - r.bStart);
      for (let i = 0; i < r.aEnd - r.aStart; i++) assert.equal(a[r.aStart + i], b[r.bStart + i]);
    }
    if (r.op !== 'ins') outA.push(...a.slice(r.aStart, r.aEnd));
    if (r.op !== 'del') outB.push(...b.slice(r.bStart, r.bEnd));
    ai = r.aEnd; bi = r.bEnd;
  }
  assert.deepEqual(outA, a);
  assert.deepEqual(outB, b);
}

function editCount(runs) {
  return runs.reduce((s, r) => s + (r.op === 'del' ? r.aEnd - r.aStart : r.op === 'ins' ? r.bEnd - r.bStart : 0), 0);
}

// 挿入・削除のみの最小編集数（= n + m - 2 * LCS）
function minEdits(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return a.length + b.length - 2 * dp[a.length][b.length];
}

function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

test('diffSeq: ランダム入力で正しく、かつ最小の編集になる', () => {
  const rand = rng(42);
  for (let t = 0; t < 2000; t++) {
    const alpha = 1 + Math.floor(rand() * 4);
    const gen = () => Array.from({ length: Math.floor(rand() * 15) }, () => Math.floor(rand() * alpha));
    const a = gen(), b = gen();
    const runs = Diff.diffSeq(a, b);
    apply(a, b, runs);
    assert.equal(editCount(runs), minEdits(a, b), `a=${a} b=${b}`);
  }
});

test('diffLines: 空同士は同一', () => {
  const r = Diff.diffLines('', '');
  assert.equal(r.identical, true);
  assert.equal(r.blocks.length, 0);
});

test('diffLines: 片方だけ空', () => {
  const r = Diff.diffLines('', 'a\nb');
  assert.equal(r.added, 2);
  assert.equal(r.removed, 0);
  const r2 = Diff.diffLines('a\nb', '');
  assert.equal(r2.added, 0);
  assert.equal(r2.removed, 2);
});

test('diffLines: 同一テキスト', () => {
  const r = Diff.diffLines('a\nb\nc', 'a\nb\nc');
  assert.equal(r.identical, true);
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].type, 'eq');
});

test('diffLines: 末尾改行の有無は差分になる', () => {
  const r = Diff.diffLines('a', 'a\n');
  assert.equal(r.identical, false);
  assert.equal(r.added, 1);
});

test('diffLines: CRLF と LF は同一扱い', () => {
  assert.equal(Diff.diffLines('a\r\nb\r\n', 'a\nb\n').identical, true);
  assert.equal(Diff.diffLines('a\rb', 'a\nb').identical, true);
});

test('diffLines: 変更行の行番号と行内の強調', () => {
  const r = Diff.diffLines('one\ntwo\nthree', 'one\ntwo!\nthree');
  assert.equal(r.added, 1);
  assert.equal(r.removed, 1);
  const ch = r.blocks.find(b => b.type === 'change');
  assert.equal(ch.dels[0].no, 2);
  assert.equal(ch.ins[0].no, 2);
  assert.deepEqual(ch.ins[0].parts, [{ text: 'two', changed: false }, { text: '!', changed: true }]);
  assert.deepEqual(ch.dels[0].parts, [{ text: 'two', changed: false }]);
});

test('diffChars: 日本語と絵文字をコードポイント単位で扱う', () => {
  const r = Diff.diffChars('今日は晴れ😀です', '今日は雨😀です');
  assert.deepEqual(r.a, [
    { text: '今日は', changed: false },
    { text: '晴れ', changed: true },
    { text: '😀です', changed: false }
  ]);
  assert.deepEqual(r.b, [
    { text: '今日は', changed: false },
    { text: '雨', changed: true },
    { text: '😀です', changed: false }
  ]);
  // 絵文字が途中で割れていない
  const r2 = Diff.diffChars('😀', '😁');
  for (const p of [...r2 ? r2.a.concat(r2.b) : []]) assert.equal(p.text.isWellFormed(), true);
});

test('diffChars: 似ていない行は強調しない', () => {
  assert.equal(Diff.diffChars('abcdefgh', 'zyxwvuts'), null);
});

test('diffLines: 空白の違いを無視', () => {
  assert.equal(Diff.diffLines('a  b\n  c', 'a b\nc  ', { ignoreWhitespace: true }).identical, true);
  assert.equal(Diff.diffLines('a  b', 'a b').identical, false);
  // 無視したとき、表示には各側の元の行を使う
  const r = Diff.diffLines('x  y', 'x y', { ignoreWhitespace: true });
  assert.equal(r.blocks[0].lines[0].aText, 'x  y');
  assert.equal(r.blocks[0].lines[0].bText, 'x y');
});

test('diffLines: 大きな入力でも実用的な時間で終わる', () => {
  const rand = rng(7);
  const a = Array.from({ length: 5000 }, (_, i) => `line ${i} ${Math.floor(rand() * 1000)}`);
  const b = a.map(l => (rand() < 0.1 ? l + ' changed' : l)).filter(() => rand() > 0.05);
  let t0 = Date.now();
  Diff.diffLines(a.join('\n'), b.join('\n'));
  assert.ok(Date.now() - t0 < 2000, 'よく似た 5000 行');

  // まったく異なる 5000 行どうし（最悪ケース寄り）
  const c = Array.from({ length: 5000 }, (_, i) => `other ${i}`);
  t0 = Date.now();
  const r = Diff.diffLines(a.join('\n'), c.join('\n'));
  assert.equal(r.removed, 5000);
  assert.equal(r.added, 5000);
  assert.ok(Date.now() - t0 < 3000, 'まったく異なる 5000 行');
});
