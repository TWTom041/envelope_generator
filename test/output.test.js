// End-to-end: build sheets with the bundled font, render SVG and PDF.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const opentype = require('../vendor/opentype.min.js');
const T = require('../js/text.js');
const C = require('../js/compose.js');
const R = require('../js/render.js');
const P = require('../js/pdf.js');

const buf = fs.readFileSync(path.join(__dirname, '..', 'fonts', 'LXGWWenKaiTC-Regular.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), { lowMemory: true });
const M = T.fontMetrics(font);

const base = {
  paperId: 'A4',
  margin: 5,
  orientation: 'vertical',
  mode: 'standard',
  sizeMode: 'auto',
  style: 'auto',
  contentsId: 'none',
  mailType: 'prompt-registered',
  note: '請勿折疊',
  recipient: { zip: '100006', address: '臺北市中正區重慶南路一段122號', org: '', name: '王大明', title: '先生', salutation: '鈞啟' },
  sender: { zip: '403001', address: '臺中市西區民權路91號', name: '李小華', closing: '緘', phone: '0912-345-678' },
  options: { numerals: 'chinese', showStamp: true, showZipBoxes: true, showFrame: true },
};

function collectGlyphs(ops, out = []) {
  for (const op of ops) {
    if (op.t === 'group') collectGlyphs(op.children, out);
    else if (op.t === 'glyphs') out.push(...op.items);
  }
  return out;
}

test('face text stays inside the front panel without warnings', () => {
  for (const orientation of ['vertical', 'horizontal']) {
    for (const paperId of ['A4', 'A3', 'Letter']) {
      const sheet = C.buildSheet(Object.assign({}, base, { orientation, paperId }), M);
      assert.equal(sheet.error, null);
      assert.deepEqual(sheet.warnings, [], `${orientation} ${paperId}`);
      const group = sheet.ops[0];
      const face = group.children.find((c) => c.t === 'group');
      const fw = orientation === 'vertical' ? sheet.info.W : sheet.info.L;
      const fh = orientation === 'vertical' ? sheet.info.L : sheet.info.W;
      for (const g of collectGlyphs(face.children)) {
        assert.ok(g.x >= 0 && g.x + g.size * (g.sx || 1) <= fw + 0.5, `${orientation} ${paperId} ${g.ch} x`);
        assert.ok(g.y - g.size >= -0.5 && g.y <= fh + 0.5, `${orientation} ${paperId} ${g.ch} y`);
      }
    }
  }
});

test('mail type mark and 掛號 sender warning', () => {
  const sheet = C.buildSheet(Object.assign({}, base, { sender: { name: '', address: '' } }), M);
  assert.equal(sheet.info.mailMark, '限時掛號');
  assert.ok(sheet.warnings.some((w) => w.includes('寄件人')));
});

test('SVG output uses outlines once a font is loaded', () => {
  const sheet = C.buildSheet(base, M);
  const svg = R.renderSVG(sheet, font, {});
  assert.match(svg, /^<svg[^>]+width="210mm" height="297mm"/);
  assert.doesNotMatch(svg, /<text/);
  const fallback = R.renderSVG(C.buildSheet(base, T.approxMetrics), null, {});
  assert.match(fallback, /<text/);
});

test('PDF is well formed with a valid xref table', async () => {
  const sheet = C.buildSheet(base, M);
  const bytes = await P.buildPDF(sheet, font, { title: '信封' });
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/MediaBox \[0 0 595\.276 841\.89\]/);
  const startxref = +s.match(/startxref\n(\d+)/)[1];
  assert.ok(s.slice(startxref).startsWith('xref'));
  const entries = s.slice(startxref).split('\n').slice(3, 8);
  entries.forEach((e, i) => {
    const off = +e.slice(0, 10);
    assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`);
  });
});

test('preview-only labels (封口, 背面) are left out of print and PDF output', async () => {
  const sheet = C.buildSheet(base, M);
  const hidden = [];
  (function walk(ops) {
    for (const op of ops) {
      if (op.t === 'group') walk(op.children);
      else if (op.screenOnly) hidden.push(op.items.map((i) => i.ch).join(''));
    }
  })(sheet.ops);
  assert.ok(hidden.join('').includes('封口'));
  assert.ok(hidden.join('').includes('背面'));
  const count = (svg) => (svg.match(/<path /g) || []).length;
  assert.equal(count(R.renderSVG(sheet, font, { screen: true })), count(R.renderSVG(sheet, font, {})) + 1);
  const withLabels = Object.assign({}, sheet, { ops: JSON.parse(JSON.stringify(sheet.ops).replace(/"screenOnly":true/g, '"x":1')) });
  const a = await P.buildPDF(sheet, font, {});
  const b = await P.buildPDF(withLabels, font, {});
  assert.ok(a.length < b.length);
});

test('fold lines are faint and thin', () => {
  assert.equal(C.COLORS.fold, '#d4d4d4');
  const sheet = C.buildSheet(base, M);
  const folds = sheet.ops[0].children.filter((o) => o.t === 'path' && o.dash);
  assert.ok(folds.length >= 3);
  assert.ok(folds.every((o) => o.stroke === C.COLORS.fold && o.lw <= 0.15));
});
