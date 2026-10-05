const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/text.js');

test('toChineseNumber spells small numbers and spells out digits for large ones', () => {
  assert.equal(T.toChineseNumber('3'), '三');
  assert.equal(T.toChineseNumber('10'), '十');
  assert.equal(T.toChineseNumber('12'), '十二');
  assert.equal(T.toChineseNumber('20'), '二十');
  assert.equal(T.toChineseNumber('91'), '九十一');
  assert.equal(T.toChineseNumber('100'), '一〇〇');
  assert.equal(T.toChineseNumber('05'), '〇五');
});

test('addressToChinese handles 之, 樓 and full-width digits', () => {
  assert.equal(T.addressToChinese('重慶南路一段122號'), '重慶南路一段一二二號');
  assert.equal(T.addressToChinese('5-1號3F'), '五之一號三樓');
  assert.equal(T.addressToChinese('１２巷'), '十二巷');
});

test('phone numbers become digit-by-digit numerals', () => {
  assert.equal(T.phoneToChinese('02-2311'), '〇二-二三一一');
});

test('verticalCells uses vertical punctuation and rotates dashes', () => {
  const cells = T.verticalCells('（甲）、-', {}, T.approxMetrics);
  assert.deepEqual(
    cells.map((c) => c.ch),
    ['︵', '甲', '︶', '︑', '-']
  );
  assert.equal(cells[4].rot, true);
});

test('tcy writes numbers half-width in one cell, 4 per cell at most', () => {
  const cells = T.verticalCells('段112號3F之1234567', { numerals: 'tcy' }, T.approxMetrics);
  assert.deepEqual(
    cells.map((c) => (c.kind === 'tcy' ? '[' + c.text + ']' : c.ch)).join(''),
    '段[112]號[3F]之[1234][567]'
  );
  const word = T.verticalCells('Taipei', { numerals: 'tcy' }, T.approxMetrics);
  assert.ok(word.every((c) => c.kind === 'char'));
});

test('tcy digits sit side by side, centred in the column', () => {
  const cells = T.verticalCells('112', { numerals: 'tcy' }, T.approxMetrics);
  const items = T.placeVertical(cells, 50, 0, 10, 0, T.approxMetrics);
  assert.equal(items.length, 3);
  assert.ok(items.every((it) => it.y === items[0].y), 'same baseline');
  assert.ok(items[0].x < items[1].x && items[1].x < items[2].x);
  const right = items[2].x + T.approxMetrics.advance('2') * items[2].size * items[2].sx;
  assert.ok(Math.abs((items[0].x + right) / 2 - 50) < 1e-6, 'centred');
  assert.ok(right - items[0].x <= 11 + 1e-6, 'fits the column');
});

test('splitColumns respects the column height', () => {
  const cells = T.verticalCells('一二三四五六七', {}, T.approxMetrics);
  const cols = T.splitColumns(cells, 3, 0);
  assert.deepEqual(
    cols.map((c) => c.length),
    [3, 3, 1]
  );
});

test('wrapH keeps ASCII words together', () => {
  const lines = T.wrapH('Room 1203 臺北', 5, T.approxMetrics);
  assert.ok(lines.every((l) => !/^\d{1,3}$/.test(l)));
  assert.ok(lines.join('').replace(/\s/g, '').includes('1203'));
});

test('phone numbers lie sideways as one run in vertical text', () => {
  const cells = T.verticalCells('電話：0912-345-678', { numerals: 'tcy', kind: 'phone' }, T.approxMetrics);
  const run = cells.find((c) => c.kind === 'rotrun');
  assert.equal(run.text, '0912-345-678');
  assert.equal(cells.filter((c) => c.kind === 'rotrun').length, 1);
  const items = T.placeVertical([run], 50, 0, 10, 0, T.approxMetrics);
  assert.equal(items.length, 12);
  assert.ok(items.every((it) => it.rot === 90 && it.cx === 50));
  assert.ok(items.every((it, i) => i === 0 || it.cy > items[i - 1].cy), 'reads top to bottom');
  // 國字 mode still converts digit by digit.
  const cn = T.verticalCells('0912', { numerals: 'chinese', kind: 'phone' }, T.approxMetrics);
  assert.deepEqual(cn.map((c) => c.ch).join(''), '〇九一二');
});
