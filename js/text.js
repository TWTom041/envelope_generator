/*
 * 文字排版：直書（縱排）與橫書的字元處理、量測與定位。
 * Text helpers: vertical (直書) and horizontal layout, numeral conversion and
 * glyph placement. Layout only produces positioned glyph items; renderers turn
 * them into outlines with the loaded font.
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});

  // Top of the ideographic em box sits 0.88 em above the baseline in CJK fonts.
  const EM_TOP = 0.88;

  const CN_DIGITS = '〇一二三四五六七八九';

  // Horizontal → vertical presentation forms (U+FE10–FE4F).
  const VERTICAL_FORMS = {
    '，': '︐', ',': '︐', '、': '︑', '。': '︒', '：': '︓', ':': '︓', '；': '︔', ';': '︔',
    '！': '︕', '!': '︕', '？': '︖', '?': '︖', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄',
    '（': '︵', '(': '︵', '）': '︶', ')': '︶', '｛': '︷', '｝': '︸', '〔': '︹', '〕': '︺',
    '【': '︻', '】': '︼', '《': '︽', '》': '︾', '〈': '︿', '〉': '﹀', '—': '︱', '…': '︙',
  };
  // Characters drawn rotated 90° in vertical text when no vertical form exists.
  const ROTATE_IN_VERTICAL = new Set(['-', '－', '~', '～', '_', '—', '–', '(', ')', '（', '）', '[', ']', '<', '>', '=']);

  /** Fallback metrics used before a font is loaded. */
  const approxMetrics = {
    advance(ch) {
      return isWide(ch) ? 1 : 0.55;
    },
    has() {
      return true;
    },
  };

  /** Metrics backed by an opentype.js Font. */
  function fontMetrics(font) {
    const cache = new Map();
    const glyph = (ch) => {
      let g = cache.get(ch);
      if (!g) {
        g = font.charToGlyph(ch);
        cache.set(ch, g);
      }
      return g;
    };
    return {
      font,
      advance(ch) {
        const g = glyph(ch);
        return (g.advanceWidth || font.unitsPerEm) / font.unitsPerEm;
      },
      has(ch) {
        return /\s/.test(ch) || glyph(ch).index !== 0;
      },
    };
  }

  function isWide(ch) {
    const c = ch.codePointAt(0);
    return (
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe10 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      c >= 0x20000
    );
  }

  /** Full-width ASCII digits/letters/hyphen → half-width, leaving CJK punctuation alone. */
  function normalizeAlnum(s) {
    return String(s || '').replace(/[０-９Ａ-Ｚａ-ｚ－]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    );
  }

  /** 數字轉國字：≤ 99 讀作「十二」「二十」，其餘逐字「一〇〇」。 */
  function toChineseNumber(digits, digitByDigit) {
    const s = String(digits);
    const n = parseInt(s, 10);
    if (digitByDigit || s.length > 2 || (s.length === 2 && s[0] === '0')) {
      return s.replace(/\d/g, (d) => CN_DIGITS[+d]);
    }
    if (n < 10) return CN_DIGITS[n];
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return (tens === 1 ? '' : CN_DIGITS[tens]) + '十' + (ones ? CN_DIGITS[ones] : '');
  }

  /**
   * Convert Arabic numerals in an address to Chinese numerals for vertical text.
   * "5-1號" → "五之一號", "3F" → "三樓", "100號" → "一〇〇號".
   */
  function addressToChinese(s) {
    let t = normalizeAlnum(s);
    t = t.replace(/(\d+)\s*[Ff](?![A-Za-z])/g, '$1樓');
    t = t.replace(/(\d)\s*[-－]\s*(?=\d)/g, '$1之');
    return t.replace(/\d+/g, (m) => toChineseNumber(m, false));
  }

  function phoneToChinese(s) {
    return normalizeAlnum(s).replace(/\d/g, (d) => CN_DIGITS[+d]);
  }

  /**
   * Split text into vertical cells.
   * opts.numerals: 'chinese' | 'upright' | 'tcy'   (tcy = 縱中橫, ≤3 alnum per cell)
   * opts.kind: 'address' | 'phone' | 'plain'
   */
  function verticalCells(text, opts, metrics) {
    const o = opts || {};
    const m = metrics || approxMetrics;
    let s = normalizeAlnum(text);
    if (o.numerals === 'chinese') {
      if (o.kind === 'phone') s = phoneToChinese(s);
      else if (o.kind === 'address') s = addressToChinese(s);
    }
    const cells = [];
    const chars = Array.from(s);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === ' ' || ch === '\t') {
        cells.push({ kind: 'space', adv: 0.5 });
        continue;
      }
      if (ch === '　') {
        cells.push({ kind: 'space', adv: 1 });
        continue;
      }
      if (o.numerals === 'tcy' && /[0-9A-Za-z]/.test(ch)) {
        let j = i;
        while (j < chars.length && /[0-9A-Za-z]/.test(chars[j])) j++;
        const run = chars.slice(i, j).join('');
        if (run.length <= 3) cells.push({ kind: 'tcy', text: run, adv: 1 });
        else for (const c of run) cells.push({ kind: 'char', ch: c, adv: 1 });
        i = j - 1;
        continue;
      }
      const vf = VERTICAL_FORMS[ch];
      if (vf && m.has(vf)) {
        cells.push({ kind: 'char', ch: vf, adv: 1 });
      } else if (ROTATE_IN_VERTICAL.has(ch)) {
        cells.push({ kind: 'char', ch, adv: Math.max(0.5, m.advance(ch)), rot: true });
      } else {
        cells.push({ kind: 'char', ch, adv: 1 });
      }
    }
    return cells;
  }

  /** Height of a list of vertical cells in em, including letter spacing. */
  function cellsHeight(cells, spacing) {
    if (!cells.length) return 0;
    const sp = spacing || 0;
    return cells.reduce((h, c) => h + c.adv, 0) + sp * (cells.length - 1);
  }

  /** Greedy column breaking. Leading spaces are dropped from new columns. */
  function splitColumns(cells, maxEm, spacing) {
    const cols = [];
    let cur = [];
    let h = 0;
    const sp = spacing || 0;
    for (const c of cells) {
      const add = c.adv + (cur.length ? sp : 0);
      if (cur.length && h + add > maxEm + 1e-6) {
        cols.push(cur);
        cur = [];
        h = 0;
        if (c.kind === 'space') continue;
      }
      cur.push(c);
      h += cur.length === 1 ? c.adv : add;
    }
    if (cur.length) cols.push(cur);
    return cols;
  }

  /** Positioned glyphs for a vertical column. (cx = column centre, top = y of first cell). */
  function placeVertical(cells, cx, top, size, spacing, metrics) {
    const m = metrics || approxMetrics;
    const items = [];
    let y = top;
    const sp = (spacing || 0) * size;
    for (const c of cells) {
      const cellH = c.adv * size;
      if (c.kind === 'char') {
        const adv = m.advance(c.ch) * size;
        if (c.rot) {
          // Rotate 90° clockwise around the centre of the cell.
          const ccx = cx;
          const ccy = y + cellH / 2;
          items.push({ ch: c.ch, x: ccx - adv / 2, y: ccy + size * (EM_TOP - 0.5), size, rot: 90, cx: ccx, cy: ccy });
        } else {
          items.push({ ch: c.ch, x: cx - adv / 2, y: y + size * EM_TOP, size });
        }
      } else if (c.kind === 'tcy') {
        const chars = Array.from(c.text);
        const w = chars.reduce((a, ch) => a + m.advance(ch), 0) * size;
        const sx = Math.min(1, (0.96 * size) / w);
        let x = cx - (w * sx) / 2;
        for (const ch of chars) {
          items.push({ ch, x, y: y + size * EM_TOP, size, sx });
          x += m.advance(ch) * size * sx;
        }
      }
      y += cellH + sp;
    }
    return items;
  }

  /** Width of horizontal text in em. */
  function measureH(text, metrics, spacing) {
    const m = metrics || approxMetrics;
    const chars = Array.from(normalizeAlnum(text));
    if (!chars.length) return 0;
    return chars.reduce((w, ch) => w + m.advance(ch), 0) + (spacing || 0) * (chars.length - 1);
  }

  /** Wrap horizontal text to maxEm. Keeps ASCII words together when possible. */
  function wrapH(text, maxEm, metrics) {
    const m = metrics || approxMetrics;
    const tokens = normalizeAlnum(text).match(/[A-Za-z0-9.,#&'\-]+|\s+|./gu) || [];
    const lines = [];
    let cur = '';
    let w = 0;
    for (const tok of tokens) {
      const tw = measureH(tok, m);
      if (w + tw > maxEm + 1e-6 && cur.trim()) {
        if (tw > maxEm) {
          // Very long word: break by character.
          for (const ch of Array.from(tok)) {
            const cw = m.advance(ch);
            if (w + cw > maxEm + 1e-6 && cur) {
              lines.push(cur.trimEnd());
              cur = '';
              w = 0;
            }
            cur += ch;
            w += cw;
          }
          continue;
        }
        lines.push(cur.trimEnd());
        cur = /^\s+$/.test(tok) ? '' : tok;
        w = cur ? tw : 0;
      } else {
        cur += tok;
        w += tw;
      }
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
  }

  /** Positioned glyphs for a horizontal run starting at x with the given baseline. */
  function placeHorizontal(text, x, baseline, size, metrics, spacing) {
    const m = metrics || approxMetrics;
    const items = [];
    let cx = x;
    const sp = (spacing || 0) * size;
    for (const ch of Array.from(normalizeAlnum(text))) {
      if (!/\s/.test(ch)) items.push({ ch, x: cx, y: baseline, size });
      cx += m.advance(ch) * size + sp;
    }
    return items;
  }

  /** Characters the font cannot render. */
  function missingChars(texts, metrics) {
    const missing = new Set();
    if (!metrics || !metrics.font) return [];
    for (const t of texts) {
      for (const ch of Array.from(String(t || ''))) {
        if (!/\s/.test(ch) && !metrics.has(ch)) missing.add(ch);
      }
    }
    return Array.from(missing);
  }

  const api = {
    EM_TOP,
    approxMetrics,
    fontMetrics,
    isWide,
    normalizeAlnum,
    toChineseNumber,
    addressToChinese,
    phoneToChinese,
    verticalCells,
    cellsHeight,
    splitColumns,
    placeVertical,
    measureH,
    wrapH,
    placeHorizontal,
    missingChars,
  };
  EG.text = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
