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

test('tcy groups short digit runs into one cell', () => {
  const cells = T.verticalCells('12樓1234', { numerals: 'tcy' }, T.approxMetrics);
  assert.equal(cells[0].kind, 'tcy');
  assert.equal(cells[0].text, '12');
  assert.equal(cells.length, 1 + 1 + 4);
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
