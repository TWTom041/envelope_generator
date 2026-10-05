const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry.js');

const paper = (id) => G.PAPERS.find((p) => p.id === id);
const solve = (id, orientation, extra) =>
  G.solveLargest(Object.assign({ paper: paper(id), margin: 5, orientation, mode: 'standard', style: 'auto' }, extra));

test('standardIssues follows 中華郵政標準信函 limits', () => {
  assert.deepEqual(G.standardIssues(90, 140), []);
  assert.deepEqual(G.standardIssues(165, 235), []);
  assert.equal(G.standardIssues(89, 140).length, 1);
  assert.equal(G.standardIssues(90, 236).length, 1);
  assert.equal(G.standardIssues(120, 150).length, 1); // ratio < 1.3
  assert.equal(G.standardIssues(229, 324).length, 2);
});

test('solver result is standard and its dieline fits the usable area', () => {
  for (const id of ['A4', 'A3', 'B4', 'Letter', 'Legal']) {
    for (const o of ['vertical', 'horizontal']) {
      const { best } = solve(id, o);
      assert.ok(best, `${id} ${o} should fit`);
      assert.deepEqual(G.standardIssues(best.W, best.L), [], `${id} ${o}`);
      const p = paper(id);
      const [aw, ah] = best.rotated ? [p.h - 10, p.w - 10] : [p.w - 10, p.h - 10];
      assert.ok(best.size.w <= aw + 1e-9 && best.size.h <= ah + 1e-9, `${id} ${o} dieline fits`);
    }
  }
});

test('solver finds the largest size: no 1 mm larger envelope fits', () => {
  const { best } = solve('A4', 'vertical');
  assert.deepEqual([best.W, best.L], [130, 169]);
  for (const style of G.STYLE_IDS) {
    for (const rotated of [false, true]) {
      for (const [W, L] of [
        [best.W + 1, best.L],
        [best.W, best.L + 1],
      ]) {
        if (G.standardIssues(W, L).length) continue;
        const { A, B } = G.openingDims('vertical', W, L);
        const s = G.dielineSize(style, A, B);
        const fits = rotated ? s.w <= 287 && s.h <= 200 : s.w <= 200 && s.h <= 287;
        if (fits) assert.ok(W * L <= best.area, `${style} ${W}x${L} would be larger`);
      }
    }
  }
});

test('A3 reaches the postal maximum', () => {
  assert.deepEqual([solve('A3', 'horizontal').best.W, solve('A3', 'horizontal').best.L], [165, 235]);
  assert.deepEqual([solve('A3', 'vertical').best.W, solve('A3', 'vertical').best.L], [165, 235]);
});

test('closing flap stays short', () => {
  for (const style of G.STYLE_IDS) {
    for (const [A, B] of [
      [92, 235],
      [235, 95],
      [165, 235],
    ]) {
      const f = G.flapSpec(style, A, B);
      assert.ok(f.ft <= 22, `${style} ${A}x${B}`);
      if (style === 'side') assert.ok(f.fb <= 17, `side bottom flap ${A}x${B}`);
    }
  }
});

test('A5 cannot hold a standard envelope, but free mode can', () => {
  assert.equal(solve('A5', 'vertical').best, null);
  assert.ok(solve('A5', 'vertical', { mode: 'free' }).best);
});

test('contents constraint raises the minimum size', () => {
  const tri = G.CONTENTS.find((c) => c.id === 'a4-tri');
  const { best } = solve('A3', 'vertical', { contents: tri });
  assert.ok(best.W >= tri.w + G.CONTENT_CLEARANCE && best.L >= tri.l + G.CONTENT_CLEARANCE);
  assert.ok(G.contentsThatFit(best.W, best.L).some((c) => c.id === 'a4-tri'));
});

test('fitFixed rejects sizes that do not fit and accepts ones that do', () => {
  const opts = { paper: paper('A4'), margin: 5, orientation: 'horizontal', style: 'auto' };
  assert.equal(G.fitFixed(opts, 110, 220), null);
  assert.ok(G.fitFixed(Object.assign({}, opts, { paper: paper('A3') }), 110, 220));
});

test('buildDieline outline stays inside its bounding box', () => {
  for (const style of G.STYLE_IDS) {
    for (const [A, B] of [
      [92, 231],
      [235, 95],
      [165, 235],
    ]) {
      const d = G.buildDieline(style, A, B);
      const s = G.dielineSize(style, A, B);
      assert.ok(Math.abs(d.w - s.w) < 1e-9 && Math.abs(d.h - s.h) < 1e-9);
      for (const c of d.cut) {
        for (let i = 1; i < c.length; i += 2) {
          assert.ok(c[i] >= -1e-9 && c[i] <= d.w + 1e-9, `${style} x in range`);
          assert.ok(c[i + 1] >= -1e-9 && c[i + 1] <= d.h + 1e-9, `${style} y in range`);
        }
      }
    }
  }
});

test('填滿紙張 fills the usable sheet in the chosen direction', () => {
  for (const id of ['A4', 'A3', 'Letter']) {
    for (const orientation of ['vertical', 'horizontal']) {
      for (const sheet of ['portrait', 'landscape']) {
        const p = paper(id);
        const { best } = G.solveFill({ paper: p, margin: 5, orientation, sheet, style: 'auto' });
        assert.ok(best, `${id} ${orientation} ${sheet}`);
        const [aw, ah] = sheet === 'landscape' ? [p.h - 10, p.w - 10] : [p.w - 10, p.h - 10];
        // Whole-millimetre envelope sizes leave at most a few mm unused.
        assert.ok(best.size.w <= aw + 1e-9 && aw - best.size.w < 3, `${id} ${orientation} ${sheet} width`);
        assert.ok(best.size.h <= ah + 1e-9 && ah - best.size.h < 3, `${id} ${orientation} ${sheet} height`);
        assert.equal(best.rotated, sheet === 'landscape');
        const { A, B } = G.openingDims(orientation, best.W, best.L);
        assert.ok(orientation === 'vertical' ? B >= A : A >= B, 'face keeps its orientation');
      }
    }
  }
});
