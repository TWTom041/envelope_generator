// 全字庫 chunks: manifest consistency, WOFF2 decoding and rare-character fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const opentype = require('../vendor/opentype.min.js');
const T = require('../js/text.js');
const C = require('../js/compose.js');
const R = require('../js/render.js');
const manifest = require('../fonts/tw/manifest.js');

const DIR = path.join(__dirname, '..', 'fonts', 'tw');

let decoder;
function woff2() {
  if (!decoder) {
    decoder = new Promise((resolve) => {
      const M = require('../vendor/woff2-decompress.js');
      if (M.calledRun) resolve(M);
      else M.onRuntimeInitialized = () => resolve(M);
    });
  }
  return decoder;
}

async function loadChunk(file) {
  const M = await woff2();
  const out = M.decompress(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  assert.ok(out, `decode ${file}`);
  return opentype.parse(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), { lowMemory: true });
}

function chunkFor(family, ch) {
  const cp = ch.codePointAt(0);
  return manifest[family].chunks.find((c) => cp >= c.from && cp <= c.to);
}

test('manifest lists existing, non-overlapping chunks', () => {
  for (const id of ['kai', 'sung']) {
    const fam = manifest[id];
    assert.ok(fs.existsSync(path.join(DIR, fam.common)));
    let prev = -1;
    for (const c of fam.chunks) {
      assert.ok(fs.existsSync(path.join(DIR, c.file)), c.file);
      assert.ok(c.from > prev && c.to >= c.from, c.file);
      prev = c.to;
    }
    assert.ok(fam.chunks.some((c) => c.from >= 0x20000), `${id} includes Ext-B`);
  }
});

test('common chunk covers everyday text and the envelope labels', async () => {
  for (const id of ['kai', 'sung']) {
    const font = await loadChunk(manifest[id].common);
    const text = '臺北市中正區重慶南路一段王大明先生鈞啟台啟緘寄限時掛號郵票塗膠封口背面，。、（）0123456789ABC-';
    const missing = Array.from(text).filter((ch) => font.charToGlyph(ch).index === 0);
    assert.deepEqual(missing, [], id);
  }
});

test('a rare Ext-B character renders through the font stack', async () => {
  const rare = '𡘙'; // U+21619
  const common = await loadChunk(manifest.kai.common);
  assert.equal(common.charToGlyph(rare).index, 0);
  const extra = await loadChunk(chunkFor('kai', rare).file);
  const stack = T.fontStack(common, [extra]);
  const M = T.fontMetrics(stack);
  assert.ok(M.has(rare));
  const it = { ch: rare, x: 0, y: 10, size: 10 };
  assert.ok(R.glyphCommands(stack, it).length > 10);

  const sheet = C.buildSheet(
    {
      paperId: 'A4',
      margin: 5,
      orientation: 'vertical',
      mode: 'standard',
      sizeMode: 'auto',
      style: 'auto',
      contentsId: 'none',
      mailType: 'normal',
      recipient: { zip: '100006', address: '臺北市中正區重慶南路一段122號', name: '王' + rare + '明', title: '先生', salutation: '台啟' },
      sender: { zip: '403001', address: '臺中市西區民權路91號', name: '李小華', closing: '緘' },
      options: { numerals: 'chinese', showStamp: true, showZipBoxes: true, showFrame: true },
    },
    M
  );
  assert.equal(sheet.error, null);
  assert.ok(!sheet.warnings.some((w) => w.includes('缺少')), sheet.warnings.join());
});

test('全字庫 glyphs share the em box with other fonts', async () => {
  const common = await loadChunk(manifest.kai.common);
  // 820/−204 of 1024: outlines are shifted up so the em box top sits at 0.88 em.
  const cmds = R.glyphCommands(common, { ch: '一', x: 0, y: 0.88, size: 1 });
  const ys = cmds.flatMap((c) => c.slice(1).filter((_, i) => i % 2 === 1));
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  assert.ok(Math.abs(mid - 0.5) < 0.12, `一 centred in its cell (mid ${mid.toFixed(3)})`);
});
