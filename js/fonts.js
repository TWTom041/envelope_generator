/*
 * 字型載入（瀏覽器）。
 * - 霞鶩文楷 TC：隨附的完整字型檔。
 * - 全字庫正楷體／正宋體（TW-Kai／TW-Sung，含 Ext-B）：切成小分塊（fonts/tw/），
 *   先載入常用字分塊，其餘字元用到時才下載對應分塊。
 * - 也可上傳自己的字型（例如標楷體 kaiu.ttf）。
 *
 * Font loading in the browser. Bundled files are tried first, then a CDN copy
 * (useful when index.html is opened from file://). WOFF2 is decoded with the
 * vendored woff2 decoder, loaded only when first needed.
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});

  const WENKAI_NAME = '霞鶩文楷 TC（LXGW WenKai TC）';
  const WENKAI_SOURCES = [
    'fonts/LXGWWenKaiTC-Regular.ttf',
    'https://cdn.jsdelivr.net/npm/@expo-google-fonts/lxgw-wenkai-tc@0.4.2/400Regular/LXGWWenKaiTC_400Regular.ttf',
  ];
  const TW_BASES = ['fonts/tw/', 'https://cdn.jsdelivr.net/gh/TWTom041/envelope_generator@main/fonts/tw/'];

  // ---- WOFF2 ------------------------------------------------------------------------
  let woff2Ready = null;
  function woff2Decoder() {
    if (!woff2Ready) {
      woff2Ready = new Promise((resolve, reject) => {
        root.Module = { onRuntimeInitialized: () => resolve(root.Module) };
        const s = document.createElement('script');
        s.src = 'vendor/woff2-decompress.js';
        s.onerror = () => {
          woff2Ready = null;
          reject(new Error('無法載入 WOFF2 解碼器'));
        };
        document.head.appendChild(s);
      });
    }
    return woff2Ready;
  }

  function isWoff2(buffer) {
    const b = new Uint8Array(buffer, 0, 4);
    return b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32; // 'wOF2'
  }

  async function toSfnt(buffer) {
    if (!isWoff2(buffer)) return buffer;
    const dec = await woff2Decoder();
    const out = dec.decompress(new Uint8Array(buffer));
    if (!out) throw new Error('WOFF2 解碼失敗（解開後超過 30 MB 的字型無法處理，請改用 .ttf）');
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  }

  function parse(buffer, requireChinese) {
    const font = root.opentype.parse(buffer, { lowMemory: true });
    if (!font || !font.unitsPerEm) throw new Error('無法解析字型');
    if (requireChinese && font.charToGlyph('信').index === 0) {
      throw new Error('此字型不含常用中文字（例如只含 Ext-B 罕用字），請改用完整字型');
    }
    return font;
  }

  function fontName(font, fallback) {
    const n = font.names || {};
    const pick = (rec) => rec && (rec.zh || rec['zh-TW'] || rec.en || Object.values(rec)[0]);
    return pick(n.fullName) || pick(n.fontFamily) || pick((n.windows || {}).fullName) || fallback;
  }

  async function fetchFirst(urls) {
    let lastError;
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { buffer: await res.arrayBuffer(), url };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('下載失敗');
  }

  // ---- 霞鶩文楷／上傳字型 ---------------------------------------------------------------
  let wenkai = null;
  function loadWenKai() {
    if (!wenkai) {
      wenkai = fetchFirst(WENKAI_SOURCES)
        .then(({ buffer }) => parse(buffer, true))
        .catch((e) => {
          wenkai = null;
          throw e;
        });
    }
    return wenkai;
  }

  async function loadFile(file) {
    if (/\.(ttc|otc)$/i.test(file.name)) throw new Error('不支援 TTC 字型集合檔，請改用 .ttf / .otf / .woff / .woff2');
    const font = parse(await toSfnt(await file.arrayBuffer()), true);
    return { font, name: fontName(font, file.name) };
  }

  // ---- 全字庫分塊 -----------------------------------------------------------------------
  const chunkFonts = new Map(); // file → Font
  const chunkLoading = new Map(); // file → Promise<Font>
  const manifest = () => EG.twFonts || {};

  function twFamilies() {
    const m = manifest();
    return Object.keys(m).map((id) => ({ id, label: m[id].label }));
  }

  function loadChunk(file) {
    if (!chunkLoading.has(file)) {
      const p = fetchFirst(TW_BASES.map((b) => b + file))
        .then(({ buffer }) => toSfnt(buffer))
        .then((sfnt) => {
          const font = parse(sfnt, false);
          chunkFonts.set(file, font);
          return font;
        })
        .catch((e) => {
          chunkLoading.delete(file);
          throw e;
        });
      chunkLoading.set(file, p);
    }
    return chunkLoading.get(file);
  }

  /** Loaded fonts of a family: the common chunk first, then range chunks. */
  function familyFonts(family) {
    const fam = manifest()[family];
    if (!fam) return [];
    return [fam.common]
      .concat(fam.chunks.map((c) => c.file))
      .filter((f) => chunkFonts.has(f))
      .map((f) => chunkFonts.get(f));
  }

  function hasCommon(family) {
    const fam = manifest()[family];
    return !!fam && chunkFonts.has(fam.common);
  }

  /**
   * Chunk files of a family that may hold characters no loaded font can draw.
   * Range chunks have gaps where common characters sit, so the common chunk is
   * always included until it is loaded.
   */
  function filesFor(family, chars) {
    const fam = manifest()[family];
    const list = Array.from(chars);
    if (!fam || !list.length) return [];
    const files = new Set();
    if (!chunkFonts.has(fam.common)) files.add(fam.common);
    for (const ch of list) {
      const cp = ch.codePointAt(0);
      const c = fam.chunks.find((k) => cp >= k.from && cp <= k.to);
      if (c && !chunkFonts.has(c.file)) files.add(c.file);
    }
    return Array.from(files);
  }

  const api = {
    WENKAI_NAME,
    loadWenKai,
    loadFile,
    twFamilies,
    loadChunk,
    familyFonts,
    hasCommon,
    filesFor,
  };
  EG.fonts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
