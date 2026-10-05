/*
 * 字型載入（瀏覽器）。預設使用隨附的「霞鶩文楷 TC」，也可上傳自己的字型（例如標楷體 kaiu.ttf）。
 * Font loading in the browser. Tries the bundled font first, then a CDN copy
 * (useful when index.html is opened from file://), and supports user uploads.
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});

  const DEFAULT_FONT_NAME = '霞鶩文楷 TC（LXGW WenKai TC）';
  const DEFAULT_SOURCES = [
    'fonts/LXGWWenKaiTC-Regular.ttf',
    'https://cdn.jsdelivr.net/npm/@expo-google-fonts/lxgw-wenkai-tc@0.4.2/400Regular/LXGWWenKaiTC_400Regular.ttf',
  ];

  function parse(buffer) {
    const font = root.opentype.parse(buffer, { lowMemory: true });
    if (!font || !font.unitsPerEm) throw new Error('無法解析字型');
    if (font.charToGlyph('信').index === 0) throw new Error('此字型不含中文字');
    return font;
  }

  function fontName(font, fallback) {
    const n = font.names || {};
    const pick = (rec) => rec && (rec.zh || rec['zh-TW'] || rec.en || Object.values(rec)[0]);
    return pick(n.fullName) || pick(n.fontFamily) || pick((n.windows || {}).fullName) || fallback;
  }

  async function loadDefault() {
    let lastError;
    for (const url of DEFAULT_SOURCES) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const font = parse(await res.arrayBuffer());
        return { font, name: DEFAULT_FONT_NAME, source: url };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('字型載入失敗');
  }

  async function loadFile(file) {
    if (/\.(ttc|otc)$/i.test(file.name)) throw new Error('不支援 TTC 字型集合檔，請改用 .ttf / .otf / .woff');
    if (/\.woff2$/i.test(file.name)) throw new Error('不支援 WOFF2，請改用 .ttf / .otf / .woff');
    const font = parse(await file.arrayBuffer());
    return { font, name: fontName(font, file.name), source: file.name };
  }

  const api = { loadDefault, loadFile, DEFAULT_FONT_NAME };
  EG.fonts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
