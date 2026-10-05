/*
 * 信封正面版面配置（依中華郵政書寫方式）
 *
 * 直式：郵票貼於左上角；收件人郵遞區號書於右上角紅框格內、地址書於右側、
 *       姓名書於中央；寄件人地址、姓名書於左下側，郵遞區號書於左下角紅框格內。
 * 橫式：寄件人郵遞區號、地址、姓名書於左上角；郵票貼於右上角；
 *       收件人郵遞區號、地址、姓名依序分行書寫於信封中部偏右。
 *
 * Produces drawing ops in face coordinates (origin at the top-left of the
 * address face, y-down, mm).
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});
  const T = EG.text || (typeof require === 'function' ? require('./text.js') : null);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ZIP_UNITS = 6 + 4 * 0.18 + 0.6; // six boxes, 3+3 with a wider gap in the middle

  // ---- primitive op helpers ----------------------------------------------------
  function rectPath(x, y, w, h) {
    return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  }
  function rectOp(x, y, w, h, style) {
    return Object.assign({ t: 'path', d: rectPath(x, y, w, h) }, style);
  }
  function lineOp(x1, y1, x2, y2, style) {
    return Object.assign({ t: 'path', d: [['M', x1, y1], ['L', x2, y2]] }, style);
  }
  function glyphOp(items, fill) {
    return { t: 'glyphs', items, fill };
  }

  function splitLines(s) {
    return String(s || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /** 郵遞區號格 (3+3). Digits are written in Arabic numerals, centred in each box. */
  function zipBoxes(x, y, bw, digits, opt, M, showBoxes) {
    const ops = [];
    const bh = bw * 1.25;
    const gap = bw * 0.18;
    const mid = bw * 0.6;
    const ds = T.normalizeAlnum(digits).replace(/\D/g, '').slice(0, 6);
    const size = bh * 0.78;
    const items = [];
    let bx = x;
    for (let i = 0; i < 6; i++) {
      if (showBoxes) ops.push(rectOp(bx, y, bw, bh, { stroke: opt.red, lw: 0.3 }));
      const d = ds[i];
      if (d) {
        const adv = M.advance(d) * size;
        items.push({ ch: d, x: bx + (bw - adv) / 2, y: y + bh / 2 + size * 0.36, size });
      }
      bx += bw + (i === 2 ? mid : gap);
      if (i === 2 && showBoxes) {
        const dx = bx - mid / 2;
        ops.push(lineOp(dx - mid * 0.25, y + bh / 2, dx + mid * 0.25, y + bh / 2, { stroke: opt.red, lw: 0.3 }));
      }
    }
    if (items.length) ops.push(glyphOp(items, opt.ink));
    return { ops, w: bw * ZIP_UNITS, h: bh };
  }

  function stampBox(x, y, w, h, opt, M) {
    const ops = [rectOp(x, y, w, h, { stroke: opt.guide, lw: 0.2, dash: [1.2, 0.8] })];
    const size = Math.min(w, h) * 0.16;
    const label = '郵票';
    const lw = T.measureH(label, M) * size;
    ops.push(glyphOp(T.placeHorizontal(label, x + (w - lw) / 2, y + h / 2 + size * 0.35, size, M), opt.guide));
    return ops;
  }

  /**
   * Fit vertical lines (each may wrap into several columns) into a zone.
   * lines: [{text, kind}] ; zone: {x0, x1, y0, y1}
   */
  function fitVertical(lines, zone, cfg, M) {
    const pitch = cfg.pitch || 1.35;
    const spacing = cfg.spacing || 0;
    const zw = zone.x1 - zone.x0;
    const zh = zone.y1 - zone.y0;
    let last = null;
    for (let size = cfg.maxSize; size >= cfg.minSize - 1e-9; size -= 0.25) {
      const cols = [];
      for (const ln of lines) {
        const cells = T.verticalCells(ln.text, { numerals: cfg.numerals, kind: ln.kind }, M);
        for (const c of T.splitColumns(cells, zh / size, spacing)) cols.push({ cells: c, kind: ln.kind });
      }
      const width = cols.length ? size + (cols.length - 1) * pitch * size : 0;
      const tallest = Math.max(0, ...cols.map((c) => T.cellsHeight(c.cells, spacing) * size));
      last = { size, cols, pitch, spacing, width, overflow: width > zw + 1e-6 || tallest > zh + 1e-6 };
      if (!last.overflow) return last;
    }
    return last;
  }

  /** Render fitted vertical columns right-to-left from zone.x1. align: 'top' | 'bottom'. */
  function drawColumns(fit, zone, align, color, M) {
    const items = [];
    fit.cols.forEach((col, i) => {
      const cx = zone.x1 - fit.size / 2 - i * fit.pitch * fit.size;
      const h = T.cellsHeight(col.cells, fit.spacing) * fit.size;
      const top = align === 'bottom' ? zone.y1 - h : zone.y0;
      items.push(...T.placeVertical(col.cells, cx, top, fit.size, fit.spacing, M));
    });
    return items.length ? [glyphOp(items, color)] : [];
  }

  /** Fit horizontal lines (wrapping) into a width; returns size & wrapped lines. */
  function fitHorizontal(lines, maxW, maxH, cfg, M) {
    const lh = cfg.lineHeight || 1.45;
    let last = null;
    for (let size = cfg.maxSize; size >= cfg.minSize - 1e-9; size -= 0.25) {
      const out = [];
      for (const ln of lines) for (const w of T.wrapH(ln, maxW / size, M)) out.push(w);
      const h = out.length ? size + (out.length - 1) * size * lh : 0;
      last = { size, lines: out, lh, height: h, overflow: h > maxH + 1e-6 };
      if (!last.overflow) return last;
    }
    return last;
  }

  // ---- 直式 -------------------------------------------------------------------------
  function layoutVertical(fw, fh, data, opt, M) {
    const ops = [];
    const warnings = [];
    const r = data.recipient || {};
    const s = data.sender || {};
    const m = clamp(fw * 0.065, 5, 10);
    const swBase = clamp(fw * 0.25, 20, 26);

    // 收件人郵遞區號：右上角
    const bw = Math.min(clamp(fw * 0.075, 5, 7.5), (fw - 2 * m - swBase - 3) / ZIP_UNITS);
    const zipY = m + 1;
    const rz = zipBoxes(fw - m - bw * ZIP_UNITS, zipY, bw, r.zip, opt, M, opt.showZipBoxes);
    ops.push(...rz.ops);

    // 寄件人郵遞區號：左下角
    const bw2 = Math.min(bw * 0.85, (fw * 0.6 - m) / ZIP_UNITS);
    const bh2 = bw2 * 1.25;
    const sZipY = fh - m - bh2;
    const sz = zipBoxes(m, sZipY, bw2, s.zip, opt, M, opt.showZipBoxes);
    ops.push(...sz.ops);

    // 中央紅框（收件人姓名）
    const frW = clamp(fw * 0.3, 22, 42);
    const frX = (fw - frW) / 2;
    const frY0 = zipY + rz.h + 5;
    const frY1 = sZipY - 4;
    if (opt.showFrame) {
      ops.push(rectOp(frX, frY0, frW, frY1 - frY0, { stroke: opt.red, lw: 0.6 }));
      ops.push(rectOp(frX + 1.2, frY0 + 1.2, frW - 2.4, frY1 - frY0 - 2.4, { stroke: opt.red, lw: 0.2 }));
    }
    ops.push(...nameColumn(r, { x0: frX + 2.5, x1: frX + frW - 2.5, y0: frY0 + 3, y1: frY1 - 3 }, opt, M, warnings));

    // 收件人地址：右側（直書，由右至左）
    const addrLines = splitLines(r.address).map((text) => ({ text, kind: 'address' }));
    splitLines(r.org).forEach((text) => addrLines.push({ text, kind: 'address' }));
    if (addrLines.length) {
      const zone = { x0: frX + frW + 2.5, x1: fw - m, y0: frY0 + 2, y1: fh - m };
      const fit = fitVertical(addrLines, zone, { maxSize: 8, minSize: 3.5, numerals: opt.numerals }, M);
      if (fit.overflow) warnings.push('收件人地址太長，已縮至最小字級仍放不下，請精簡或換大一點的信封。');
      ops.push(...drawColumns(fit, zone, 'top', opt.ink, M));
    }

    // 郵票：左上角
    const leftW = frX - 2.5 - m;
    const sw = Math.min(swBase, leftW);
    const sh = sw * 1.2;
    if (opt.showStamp) ops.push(...stampBox(m, m, sw, sh, opt, M));
    let leftY = m + sh;

    // 郵件種類（限時、掛號…）：郵票下方，紅框直書
    if (data.mailType) {
      const ms = clamp(sw * 0.26, 4, 6.5);
      const cells = T.verticalCells(data.mailType, { numerals: 'upright' }, M);
      const bh = T.cellsHeight(cells, 0.08) * ms + ms * 0.7;
      const bwm = ms * 1.6;
      const bx = m + (sw - bwm) / 2;
      const by = leftY + 4;
      ops.push(rectOp(bx, by, bwm, bh, { stroke: opt.red, lw: 0.5 }));
      ops.push(glyphOp(T.placeVertical(cells, bx + bwm / 2, by + ms * 0.35, ms, 0.08, M), opt.red));
      leftY = by + bh;
    }
    if (data.note) {
      const ns = clamp(sw * 0.2, 3.2, 5);
      // Centred under the stamp; wraps leftwards into extra columns if needed.
      const zone = { x0: m, x1: m + sw / 2 + ns / 2, y0: leftY + 3, y1: leftY + 3 + fh * 0.25 };
      const fit = fitVertical([{ text: data.note, kind: 'plain' }], zone, { maxSize: ns, minSize: 2.8, numerals: 'upright' }, M);
      const used = Math.max(...fit.cols.map((c) => T.cellsHeight(c.cells, 0) * fit.size));
      ops.push(...drawColumns(fit, zone, 'top', opt.red, M));
      leftY = zone.y0 + used;
    }

    // 寄件人：左下側（地址、電話、姓名＋緘封詞，底端對齊）
    const senderLines = splitLines(s.address).map((text) => ({ text, kind: 'address' }));
    if (s.phone) senderLines.push({ text: '電話：' + s.phone, kind: 'phone' });
    const sName = [s.name, s.closing].filter(Boolean).join('　');
    if (sName) senderLines.push({ text: sName, kind: 'plain' });
    if (senderLines.length) {
      const zone = { x0: m, x1: frX - 2.5, y0: leftY + 5, y1: sZipY - 3 };
      const fit = fitVertical(senderLines, zone, { maxSize: 5.5, minSize: 2.8, pitch: 1.3, numerals: opt.numerals }, M);
      if (fit.overflow) warnings.push('寄件人資料放不下，請精簡內容或換大一點的信封。');
      ops.push(...drawColumns(fit, zone, 'bottom', opt.ink, M));
    }
    return { ops, warnings };
  }

  /** Recipient name + 稱謂 + 啟封詞 in one vertical column centred in the frame. */
  function nameColumn(r, zone, opt, M, warnings) {
    const name = String(r.name || '').trim();
    if (!name) return [];
    const nameCells = T.verticalCells(name, { numerals: 'upright' }, M);
    const titleCells = T.verticalCells(String(r.title || '').trim(), { numerals: 'upright' }, M);
    const salCells = T.verticalCells(String(r.salutation || '').trim(), { numerals: 'upright' }, M);
    const nsp = nameCells.length <= 3 ? 0.35 : nameCells.length <= 5 ? 0.15 : 0.05;
    const k = 0.7; // 稱謂、啟封詞相對字級
    const gap1 = titleCells.length ? 0.7 : 0;
    const gap2 = salCells.length ? (titleCells.length ? 0.4 : 0.7) : 0;
    const units =
      T.cellsHeight(nameCells, nsp) + gap1 + k * T.cellsHeight(titleCells, 0.05) + gap2 + k * T.cellsHeight(salCells, 0.05);
    const zw = zone.x1 - zone.x0;
    const zh = zone.y1 - zone.y0;
    const size = Math.min(18, zw * 0.82, (zh * 0.94) / units);
    if (size < 5) warnings.push('收件人姓名過長，字級已縮小，建議精簡。');
    const cx = (zone.x0 + zone.x1) / 2;
    let y = zone.y0 + (zh - units * size) / 2;
    const items = [];
    items.push(...T.placeVertical(nameCells, cx, y, size, nsp, M));
    y += (T.cellsHeight(nameCells, nsp) + gap1) * size;
    items.push(...T.placeVertical(titleCells, cx, y, size * k, 0.05, M));
    y += (k * T.cellsHeight(titleCells, 0.05) + gap2) * size;
    items.push(...T.placeVertical(salCells, cx, y, size * k, 0.05, M));
    return [glyphOp(items, opt.ink)];
  }

  // ---- 橫式 -------------------------------------------------------------------------
  function layoutHorizontal(fw, fh, data, opt, M) {
    const ops = [];
    const warnings = [];
    const r = data.recipient || {};
    const s = data.sender || {};
    const m = clamp(fh * 0.08, 6, 12);

    // 郵票：右上角
    const sw = clamp(fh * 0.24, 20, 26);
    const sh = sw * 1.2;
    const stampX = fw - m - sw;
    if (opt.showStamp) ops.push(...stampBox(stampX, m, sw, sh, opt, M));
    let rightLimit = stampX - 4;
    let markBottom = m;

    // 郵件種類：郵票左側
    if (data.mailType) {
      const ms = clamp(fh * 0.055, 4, 6);
      const tw = T.measureH(data.mailType, M, 0.08) * ms;
      const bwm = tw + ms * 0.9;
      const bhm = ms * 1.6;
      const bx = rightLimit - bwm;
      ops.push(rectOp(bx, m, bwm, bhm, { stroke: opt.red, lw: 0.5 }));
      ops.push(glyphOp(T.placeHorizontal(data.mailType, bx + ms * 0.45, m + bhm / 2 + ms * 0.36, ms, M, 0.08), opt.red));
      rightLimit = bx - 4;
      markBottom = m + bhm;
      if (data.note) {
        const ns = clamp(fh * 0.045, 3, 4.5);
        const nw = T.measureH(data.note, M) * ns;
        ops.push(glyphOp(T.placeHorizontal(data.note, bx + bwm - nw, markBottom + 2 + ns * 0.88, ns, M), opt.red));
        markBottom += 2 + ns * 1.1;
      }
    } else if (data.note) {
      const ns = clamp(fh * 0.045, 3, 4.5);
      const nw = T.measureH(data.note, M) * ns;
      ops.push(glyphOp(T.placeHorizontal(data.note, rightLimit - nw, m + ns * 0.88, ns, M), opt.red));
      rightLimit -= nw + 4;
      markBottom = m + ns * 1.1;
    }

    // 寄件人：左上角
    let senderBottom = m;
    const sLines = splitLines(s.address);
    const sName = [s.name, s.closing].filter(Boolean).join('　');
    if (sName) sLines.push(sName);
    if (s.phone) sLines.push('電話：' + T.normalizeAlnum(s.phone));
    const hasSZip = !!T.normalizeAlnum(s.zip).replace(/\D/g, '');
    if (sLines.length || hasSZip) {
      const bw2 = clamp(fh * 0.045, 3.5, 5);
      let y = m;
      if (hasSZip || opt.showZipBoxes) {
        const z = zipBoxes(m, y, bw2, s.zip, opt, M, opt.showZipBoxes);
        ops.push(...z.ops);
        y += z.h + 2;
      }
      const maxW = Math.min(fw * 0.5, rightLimit - 6) - m;
      const fit = fitHorizontal(sLines, maxW, fh * 0.42 - y, { maxSize: 4.5, minSize: 2.8 }, M);
      if (fit.overflow) warnings.push('寄件人資料放不下，請精簡內容。');
      const items = [];
      fit.lines.forEach((ln, i) => {
        items.push(...T.placeHorizontal(ln, m, y + fit.size * 0.88 + i * fit.size * fit.lh, fit.size, M));
      });
      if (items.length) ops.push(glyphOp(items, opt.ink));
      senderBottom = y + fit.height;
    }

    // 收件人：中部偏右，底部保留條碼／機器辨識空白區
    const clearBottom = Math.min(15, fh * 0.14);
    const top = Math.max(senderBottom, markBottom, opt.showStamp ? m + sh : m) + 4;
    const x0 = Math.min(fw * 0.36, fw - m - 60);
    const zone = { x0, x1: fw - m, y0: top, y1: fh - clearBottom };
    ops.push(...recipientBlockH(r, zone, opt, M, warnings));
    return { ops, warnings };
  }

  function recipientBlockH(r, zone, opt, M, warnings) {
    const ops = [];
    const zw = zone.x1 - zone.x0;
    const zh = zone.y1 - zone.y0;
    const addr = splitLines(r.address).concat(splitLines(r.org));
    const name = String(r.name || '').trim();
    const title = String(r.title || '').trim();
    const sal = String(r.salutation || '').trim();
    const k = 0.7;
    const hasZip = !!T.normalizeAlnum(r.zip).replace(/\D/g, '');
    const zipOn = hasZip || opt.showZipBoxes;
    let chosen = null;
    for (let a = 6.5; a >= 3.25; a -= 0.25) {
      const bw = clamp(a, 4.5, 6.5);
      const zipH = zipOn ? bw * 1.25 + a * 0.6 : 0;
      let n = Math.min(11, a * 1.65);
      const nameW = () =>
        (T.measureH(name, M, 0.1) + (title ? 0.5 + k * T.measureH(title, M) : 0) + (sal ? 0.5 + k * T.measureH(sal, M) : 0)) * n;
      while (name && nameW() > zw && n > a) n -= 0.25;
      const lines = [];
      for (const l of addr) for (const w of T.wrapH(l, zw / a, M)) lines.push(w);
      const lh = 1.45;
      const addrH = lines.length ? a + (lines.length - 1) * a * lh : 0;
      const nameH = name ? n * 1.25 + (lines.length ? a * 0.7 : 0) : 0;
      const total = zipH + addrH + nameH;
      chosen = { a, bw, n, lines, lh, zipH, addrH, total, overflow: total > zh + 1e-6 || (name && nameW() > zw + 1e-6) };
      if (!chosen.overflow) break;
    }
    if (chosen.overflow) warnings.push('收件人資料放不下，請精簡內容或換大一點的信封。');
    let y = zone.y0 + Math.max(0, (zh - chosen.total) / 2);
    const x = zone.x0;
    if (zipOn) {
      const z = zipBoxes(x, y, chosen.bw, r.zip, opt, M, opt.showZipBoxes);
      ops.push(...z.ops);
      y += chosen.zipH;
    }
    const items = [];
    chosen.lines.forEach((ln, i) => {
      items.push(...T.placeHorizontal(ln, x, y + chosen.a * 0.88 + i * chosen.a * chosen.lh, chosen.a, M));
    });
    y += chosen.addrH;
    if (name) {
      const n = chosen.n;
      y += chosen.lines.length ? chosen.a * 0.7 : 0;
      const base = y + n * 0.95;
      let cx = x;
      items.push(...T.placeHorizontal(name, cx, base, n, M, 0.1));
      cx += T.measureH(name, M, 0.1) * n;
      if (title) {
        cx += 0.5 * n;
        items.push(...T.placeHorizontal(title, cx, base, n * k, M));
        cx += T.measureH(title, M) * n * k;
      }
      if (sal) {
        cx += 0.5 * n;
        items.push(...T.placeHorizontal(sal, cx, base, n * k, M));
      }
    }
    if (items.length) ops.push(glyphOp(items, opt.ink));
    return ops;
  }

  /** Lay out the address face. orientation: 'vertical' (直式) | 'horizontal' (橫式). */
  function layoutFace(orientation, fw, fh, data, opt, metrics) {
    const M = metrics || T.approxMetrics;
    const o = Object.assign(
      { red: '#c8161d', ink: '#1a1a1a', guide: '#9a9a9a', numerals: 'tcy', showStamp: true, showZipBoxes: true, showFrame: true },
      opt
    );
    return orientation === 'horizontal' ? layoutHorizontal(fw, fh, data, o, M) : layoutVertical(fw, fh, data, o, M);
  }

  const api = { layoutFace, zipBoxes, fitVertical, fitHorizontal, rectPath };
  EG.layout = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
