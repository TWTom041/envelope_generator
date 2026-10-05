/*
 * 信封展開圖幾何與尺寸求解
 * Envelope dieline geometry and "largest envelope that fits the paper" solver.
 *
 * All lengths are in millimetres. Coordinates are y-down (SVG convention).
 *
 * Terminology used throughout:
 *   W  – short side of the finished envelope (寬)
 *   L  – long side of the finished envelope (長)
 *   A  – length of the opening edge (the edge the closing flap is attached to)
 *   B  – depth of the envelope, perpendicular to the opening edge
 *
 * 直式 (vertical, Chinese style) envelopes open on the short edge: A = W, B = L.
 * 橫式 (horizontal, Western style) envelopes open on the long edge: A = L, B = W.
 * In both cases the address face is A wide and B tall, so the face is drawn
 * upright inside the dieline's front panel.
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});

  // 紙張尺寸 (portrait, mm)
  const PAPERS = [
    { id: 'A4', label: 'A4 (210×297)', w: 210, h: 297 },
    { id: 'A3', label: 'A3 (297×420)', w: 297, h: 420 },
    { id: 'A5', label: 'A5 (148×210)', w: 148, h: 210 },
    { id: 'B4', label: 'B4 (257×364)', w: 257, h: 364 },
    { id: 'B5', label: 'B5 (182×257)', w: 182, h: 257 },
    { id: 'Letter', label: 'Letter (8.5×11 in)', w: 215.9, h: 279.4 },
    { id: 'Legal', label: 'Legal (8.5×14 in)', w: 215.9, h: 355.6 },
    { id: 'Tabloid', label: 'Tabloid / Ledger (11×17 in)', w: 279.4, h: 431.8 },
    { id: '8K', label: '八開 8K (270×390)', w: 270, h: 390 },
    { id: '16K', label: '十六開 16K (195×270)', w: 195, h: 270 },
  ];

  /*
   * 中華郵政「標準信函」規格：
   *   長度 140–235 mm、寬度 90–165 mm、長邊須為短邊之 1.3 倍以上、
   *   厚度 6 mm 以下、重量 50 g 以下。
   */
  const POSTAL_STANDARD = { minL: 140, maxL: 235, minW: 90, maxW: 165, minRatio: 1.3 };

  // 「不限」mode: only keep a sensible envelope shape.
  const FREE_LIMITS = { minL: 70, maxL: Infinity, minW: 50, maxW: Infinity, minRatio: 1.3 };

  const ENVELOPE_PRESETS = [
    { id: 'std-max', label: '標準信函最大 165×235', w: 165, l: 235 },
    { id: 'cho3', label: '中式長形 120×235（長3）', w: 120, l: 235 },
    { id: 'dl', label: 'DL 110×220（A4 三摺）', w: 110, l: 220 },
    { id: 'cho4', label: '中式長形 90×205（長4）', w: 90, l: 205 },
    { id: 'c5', label: 'C5 162×229（A4 對摺）', w: 162, l: 229 },
    { id: 'c6', label: 'C6 114×162（A4 四摺）', w: 114, l: 162 },
    { id: 'std-min', label: '標準信函最小 90×140', w: 90, l: 140 },
    { id: 'c4', label: 'C4 229×324（A4 不摺，非標準）', w: 229, l: 324 },
  ];

  // 內容物 (short × long). An envelope needs CONTENT_CLEARANCE extra on both sides.
  const CONTENTS = [
    { id: 'none', label: '不指定', w: 0, l: 0 },
    { id: 'a4-tri', label: 'A4 三摺 (99×210)', w: 99, l: 210 },
    { id: 'a4-half', label: 'A4 對摺 (148.5×210)', w: 148.5, l: 210 },
    { id: 'a4-quarter', label: 'A4 四摺 (105×148.5)', w: 105, l: 148.5 },
    { id: 'a5', label: 'A5 不摺 (148×210)', w: 148, l: 210 },
    { id: 'a4', label: 'A4 不摺 (210×297)', w: 210, l: 297 },
    { id: 'postcard', label: '明信片 (100×148)', w: 100, l: 148 },
    { id: 'card', label: '卡片 3×5 吋 (76×127)', w: 76.2, l: 127 },
  ];
  const CONTENT_CLEARANCE = 5;

  const STYLES = {
    side: { id: 'side', label: '側邊黏合（兩片式）' },
    pocket: { id: 'pocket', label: '底部摺疊（口袋式）' },
    fourflap: { id: 'fourflap', label: '四翼式（西式）' },
  };
  const STYLE_IDS = Object.keys(STYLES);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Map the finished size to opening-edge / depth dimensions. */
  function openingDims(orientation, W, L) {
    return orientation === 'horizontal' ? { A: L, B: W } : { A: W, B: L };
  }

  /** Flap sizes for a construction style. Kept proportional with sane limits. */
  function flapSpec(style, A, B) {
    const short = Math.min(A, B);
    const closing = clamp(0.15 * short, 12, 19); // 封口翼
    if (style === 'side') {
      const g = Math.min(15, A * 0.2);
      return { ft: closing, fb: clamp(0.067 * B, 10, 17), g, gi: Math.min(g, 8) };
    }
    if (style === 'pocket') {
      const g = Math.min(15, A * 0.2);
      return { ft: closing, g, gi: Math.min(g, 8) };
    }
    if (style === 'fourflap') {
      const s = clamp(0.25 * short, 15, 40);
      const ov = clamp(0.1 * B, 10, 20); // overlap of top and bottom flap on the back
      const ft = clamp(0.2 * B, 14, 22); // short closing flap; the bottom flap covers the rest
      return { s, si: Math.min(s, 0.2 * B), fb: B - ft + ov, ft };
    }
    throw new Error('unknown style ' + style);
  }

  /** Bounding box of the flat dieline (cheap; used by the solver). */
  function dielineSize(style, A, B) {
    const f = flapSpec(style, A, B);
    if (style === 'side') return { w: 2 * A + f.g, h: f.ft + B + f.fb };
    if (style === 'pocket') return { w: A + 2 * f.g, h: f.ft + 2 * B };
    return { w: A + 2 * f.s, h: f.ft + B + f.fb };
  }

  /*
   * Polygon outline with optional rounded corners.
   * pts: [[x, y, r?], ...]; returns path commands [['M',x,y],['L',x,y],['Q',cx,cy,x,y],...,['Z']].
   */
  function roundedPolygon(pts) {
    const n = pts.length;
    const cmds = [];
    for (let i = 0; i < n; i++) {
      const [x, y, r = 0] = pts[i];
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      if (!r) {
        cmds.push([i === 0 ? 'M' : 'L', x, y]);
        continue;
      }
      const d1 = Math.hypot(prev[0] - x, prev[1] - y);
      const d2 = Math.hypot(next[0] - x, next[1] - y);
      const d = Math.min(r, d1 / 2, d2 / 2);
      const ax = x + ((prev[0] - x) * d) / d1;
      const ay = y + ((prev[1] - y) * d) / d1;
      const bx = x + ((next[0] - x) * d) / d2;
      const by = y + ((next[1] - y) * d) / d2;
      cmds.push([i === 0 ? 'M' : 'L', ax, ay]);
      cmds.push(['Q', x, y, bx, by]);
    }
    cmds.push(['Z']);
    return cmds;
  }

  const rect = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];

  /**
   * Full dieline geometry in its own coordinate system (origin = top-left of bbox).
   * Returns { w, h, front:{x,y,w,h}, back?, cut:[cmds], folds:[[x1,y1,x2,y2]], glue:[cmds], labels:[...] }.
   * Labels marked screenOnly end up on the outside of the finished envelope, so
   * they are shown in the on-screen preview but never printed.
   */
  function buildDieline(style, A, B) {
    const f = flapSpec(style, A, B);
    const R = 4; // flap corner radius
    const folds = [];
    const glue = [];
    const labels = [];
    let cut;
    let front;
    let back = null;
    let w;
    let h;

    if (style === 'fourflap') {
      const { s, si, fb, ft } = f;
      const x0 = s;
      const y0 = ft;
      const x1 = x0 + A;
      const y1 = y0 + B;
      const ti = Math.min(clamp(A * 0.12, 6, 25), ft); // closing flap taper
      const bi = s * 0.5; // bottom flap taper (< s so it rests on the side flaps)
      w = A + 2 * s;
      h = ft + B + fb;
      front = { x: x0, y: y0, w: A, h: B };
      cut = roundedPolygon([
        [x0, y0],
        [x0 + ti, y0 - ft, Math.min(R * 2, ft * 0.4)],
        [x1 - ti, y0 - ft, Math.min(R * 2, ft * 0.4)],
        [x1, y0],
        [x1 + s, y0 + si, R],
        [x1 + s, y1 - si, R],
        [x1, y1],
        [x1 - bi, y1 + fb, R],
        [x0 + bi, y1 + fb, R],
        [x0, y1],
        [x0 - s, y1 - si, R],
        [x0 - s, y0 + si, R],
      ]);
      folds.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]);
      // Glue on the side flaps where the bottom flap lands.
      const gy0 = Math.max(y0 + si, y1 - fb + 3);
      const gy1 = y1 - si - 1;
      const gw = s - bi - 3;
      if (gy1 - gy0 > 4 && gw > 2) {
        glue.push(rect(x0 - s + 2, gy0, gw, gy1 - gy0));
        glue.push(rect(x1 + bi + 1, gy0, gw, gy1 - gy0));
        labels.push({ x: x0 - s + 2 + gw / 2, y: (gy0 + gy1) / 2, text: '塗膠', vertical: true });
        labels.push({ x: x1 + bi + 1 + gw / 2, y: (gy0 + gy1) / 2, text: '塗膠', vertical: true });
      }
      labels.push({ x: x0 + A / 2, y: y0 - ft / 2, text: '封口', vertical: false, screenOnly: true });
      labels.push({ x: x0 + A / 2, y: y1 + fb / 2, text: '底翼（摺至背面黏於側翼）', vertical: false, screenOnly: true });
    } else if (style === 'side') {
      const { ft, fb, g, gi } = f;
      const x0 = 0;
      const y0 = ft;
      const x1 = A;
      const x2 = 2 * A;
      const x3 = 2 * A + g;
      const y1 = y0 + B;
      const ti = Math.min(clamp(A * 0.12, 6, 25), ft);
      const bi = Math.min(8, fb * 0.6);
      w = x3;
      h = ft + B + fb;
      front = { x: x0, y: y0, w: A, h: B };
      back = { x: x1, y: y0, w: A, h: B };
      cut = roundedPolygon([
        [x0, y0],
        [x0 + ti, y0 - ft, Math.min(R * 2, ft * 0.4)],
        [x1 - ti, y0 - ft, Math.min(R * 2, ft * 0.4)],
        [x1, y0],
        [x2, y0],
        [x3, y0 + gi, 2],
        [x3, y1 - gi, 2],
        [x2, y1],
        [x1, y1],
        [x1 - bi, y1 + fb, R],
        [x0 + bi, y1 + fb, R],
        [x0, y1],
      ]);
      folds.push([x0, y0, x1, y0], [x0, y1, x1, y1], [x1, y0, x1, y1], [x2, y0, x2, y1]);
      // Glue strip (folds inside, sticks to the inner face of the front panel).
      glue.push(rect(x2 + 1.5, y0 + gi + 1, g - 3, B - 2 * gi - 2));
      labels.push({ x: x2 + g / 2, y: y0 + B / 2, text: '塗膠', vertical: true });
      // The bottom flap folds onto the back panel; glue goes where it lands.
      const gh = fb - 4;
      glue.push(rect(x1 + bi + 2, y1 - fb + 2, A - 2 * bi - 4, gh));
      labels.push({ x: x1 + A / 2, y: y1 - fb / 2, text: '塗膠（底翼黏貼處）', vertical: false });
      labels.push({ x: x0 + A / 2, y: y0 - ft / 2, text: '封口', vertical: false, screenOnly: true });
      labels.push({ x: x1 + A / 2, y: y0 + B / 2, text: '背面', vertical: !(A > B), screenOnly: true });
    } else if (style === 'pocket') {
      const { ft, g, gi } = f;
      const x0 = g;
      const x1 = g + A;
      const y0 = ft;
      const y1 = ft + B;
      const y2 = ft + 2 * B;
      const ti = Math.min(clamp(A * 0.12, 6, 25), ft);
      w = A + 2 * g;
      h = ft + 2 * B;
      front = { x: x0, y: y0, w: A, h: B };
      back = { x: x0, y: y1, w: A, h: B, flipped: true };
      cut = roundedPolygon([
        [x0, y0],
        [x0 + ti, y0 - ft, Math.min(R * 2, ft * 0.4)],
        [x1 - ti, y0 - ft, Math.min(R * 2, ft * 0.4)],
        [x1, y0],
        [x1, y1],
        [x1 + g, y1 + gi, 2],
        [x1 + g, y2 - gi, 2],
        [x1, y2],
        [x0, y2],
        [x0 - g, y2 - gi, 2],
        [x0 - g, y1 + gi, 2],
        [x0, y1],
      ]);
      folds.push([x0, y0, x1, y0], [x0, y1, x1, y1], [x0, y1, x0, y2], [x1, y1, x1, y2]);
      glue.push(rect(x0 - g + 1.5, y1 + gi + 1, g - 3, B - 2 * gi - 2));
      glue.push(rect(x1 + 1.5, y1 + gi + 1, g - 3, B - 2 * gi - 2));
      labels.push({ x: x0 - g / 2, y: y1 + B / 2, text: '塗膠', vertical: true });
      labels.push({ x: x1 + g / 2, y: y1 + B / 2, text: '塗膠', vertical: true });
      labels.push({ x: x0 + A / 2, y: y0 - ft / 2, text: '封口', vertical: false, screenOnly: true });
      labels.push({ x: x0 + A / 2, y: y1 + B / 2, text: '背面', vertical: !(A > B), screenOnly: true });
    } else {
      throw new Error('unknown style ' + style);
    }
    return { style, A, B, w, h, front, back, cut, folds, glue, labels, flaps: f };
  }

  /** Reasons why a finished size is not a 標準信函 (empty array = compliant). */
  function standardIssues(W, L) {
    const s = POSTAL_STANDARD;
    const issues = [];
    if (L < s.minL) issues.push(`長度 ${fmt(L)} mm 小於 ${s.minL} mm`);
    if (L > s.maxL) issues.push(`長度 ${fmt(L)} mm 超過 ${s.maxL} mm`);
    if (W < s.minW) issues.push(`寬度 ${fmt(W)} mm 小於 ${s.minW} mm`);
    if (W > s.maxW) issues.push(`寬度 ${fmt(W)} mm 超過 ${s.maxW} mm`);
    if (L < s.minRatio * W - 1e-9) issues.push(`長邊未達短邊的 ${s.minRatio} 倍`);
    return issues;
  }

  /** Which common contents fit inside an envelope of W×L. */
  function contentsThatFit(W, L) {
    return CONTENTS.filter(
      (c) => c.w > 0 && c.w + CONTENT_CLEARANCE <= W + 1e-9 && c.l + CONTENT_CLEARANCE <= L + 1e-9
    );
  }

  function fmt(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function usableArea(paper, margin) {
    return { w: paper.w - 2 * margin, h: paper.h - 2 * margin };
  }

  function fitsOn(size, avail, rotated) {
    const aw = rotated ? avail.h : avail.w;
    const ah = rotated ? avail.w : avail.h;
    return size.w <= aw + 1e-9 && size.h <= ah + 1e-9;
  }

  /**
   * Find the largest envelope (by area) whose dieline fits on the paper.
   *
   * opts = {
   *   paper: {w, h}, margin, orientation: 'vertical'|'horizontal',
   *   mode: 'standard'|'free', style: 'auto'|'side'|'pocket'|'fourflap',
   *   contents: {w, l} (optional minimum content size), maxRatio (optional)
   * }
   * Returns { best, perStyle: {styleId: candidate|null} } where
   * candidate = { W, L, style, rotated, size:{w,h}, area }.
   */
  function solveLargest(opts) {
    const limits = opts.mode === 'free' ? FREE_LIMITS : POSTAL_STANDARD;
    const avail = usableArea(opts.paper, opts.margin);
    const longest = Math.max(avail.w, avail.h);
    const content = opts.contents || { w: 0, l: 0 };
    const minW = Math.max(limits.minW, content.w ? content.w + CONTENT_CLEARANCE : 0);
    const minL = Math.max(limits.minL, content.l ? content.l + CONTENT_CLEARANCE : 0);
    const maxW = Math.floor(Math.min(limits.maxW, longest));
    const maxL = Math.floor(Math.min(limits.maxL, longest));
    const maxRatio = opts.maxRatio > 0 ? opts.maxRatio : Infinity;
    const styles = !opts.style || opts.style === 'auto' ? STYLE_IDS : [opts.style];

    const perStyle = {};
    let best = null;
    for (const style of styles) {
      let styleBest = null;
      for (const rotated of [false, true]) {
        for (let W = maxW; W >= Math.ceil(minW); W--) {
          const lo = Math.max(Math.ceil(minL), Math.ceil(limits.minRatio * W - 1e-9));
          const hi = Math.min(maxL, Math.floor(maxRatio * W + 1e-9));
          if (lo > hi) continue;
          // Dieline size grows monotonically with L, so scan down from the top.
          for (let L = hi; L >= lo; L--) {
            if (styleBest && W * L <= styleBest.area) break;
            const { A, B } = openingDims(opts.orientation, W, L);
            const size = dielineSize(style, A, B);
            if (fitsOn(size, avail, rotated)) {
              const cand = { W, L, style, rotated, size, area: W * L };
              if (better(cand, styleBest)) styleBest = cand;
              break;
            }
          }
        }
      }
      perStyle[style] = styleBest;
      if (better(styleBest, best)) best = styleBest;
    }
    return { best, perStyle };
  }

  function better(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.area !== b.area) return a.area > b.area;
    if (a.L !== b.L) return a.L > b.L;
    return !a.rotated && b.rotated;
  }

  /**
   * For a fixed finished size, pick a construction style and paper rotation that fits.
   * Prefers the requested style, then the one that wastes the least paper.
   */
  function fitFixed(opts, W, L) {
    const avail = usableArea(opts.paper, opts.margin);
    const styles = !opts.style || opts.style === 'auto' ? STYLE_IDS : [opts.style];
    const { A, B } = openingDims(opts.orientation, W, L);
    let best = null;
    for (const style of styles) {
      const size = dielineSize(style, A, B);
      for (const rotated of [false, true]) {
        if (!fitsOn(size, avail, rotated)) continue;
        const cand = { W, L, style, rotated, size, area: W * L, sheetUse: size.w * size.h };
        if (!best || cand.sheetUse < best.sheetUse) best = cand;
      }
    }
    return best;
  }

  /**
   * Affine matrix [a, b, c, d, e, f] placing the dieline centred on the paper,
   * rotated 90° clockwise when `rotated` (x' = a·x + c·y + e, y' = b·x + d·y + f).
   */
  function placementMatrix(paper, size, rotated) {
    if (!rotated) return [1, 0, 0, 1, (paper.w - size.w) / 2, (paper.h - size.h) / 2];
    const ox = (paper.w - size.h) / 2;
    const oy = (paper.h - size.w) / 2;
    return [0, 1, -1, 0, size.h + ox, oy];
  }

  const api = {
    PAPERS,
    POSTAL_STANDARD,
    FREE_LIMITS,
    ENVELOPE_PRESETS,
    CONTENTS,
    CONTENT_CLEARANCE,
    STYLES,
    STYLE_IDS,
    openingDims,
    flapSpec,
    dielineSize,
    buildDieline,
    roundedPolygon,
    standardIssues,
    contentsThatFit,
    solveLargest,
    fitFixed,
    placementMatrix,
    usableArea,
  };
  EG.geometry = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
