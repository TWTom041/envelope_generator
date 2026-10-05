/*
 * 組版：依設定求出信封尺寸、產生展開圖並放上紙張。
 * Builds the complete sheet (paper + dieline + address face) as a list of
 * drawing ops in paper coordinates (mm, y-down).
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});
  const req = (name, file) => EG[name] || (typeof require === 'function' ? require(file) : null);
  const G = req('geometry', './geometry.js');
  const T = req('text', './text.js');
  const Lay = req('layout', './layout.js');

  const COLORS = { cut: '#222222', fold: '#d4d4d4', glue: '#ededed', label: '#8c8c8c' };

  // 郵件種類
  const MAIL_TYPES = [
    { id: 'normal', label: '平信', mark: '' },
    { id: 'prompt', label: '限時', mark: '限時專送' },
    { id: 'registered', label: '掛號', mark: '掛號' },
    { id: 'prompt-registered', label: '限時掛號', mark: '限時掛號' },
    { id: 'ar', label: '掛號附回執（雙掛號）', mark: '掛號附回執' },
    { id: 'prompt-ar', label: '限時掛號附回執', mark: '限時掛號附回執' },
    { id: 'express', label: '快捷', mark: '快捷郵件' },
    { id: 'printed', label: '印刷物', mark: '印刷物' },
    { id: 'air', label: '航空', mark: '航空' },
    { id: 'custom', label: '自訂…', mark: null },
  ];

  function resolvePaper(state) {
    if (state.paperId === 'custom') {
      const w = +state.customPaper?.w || 0;
      const h = +state.customPaper?.h || 0;
      return { id: 'custom', label: `自訂 ${w}×${h}`, w, h };
    }
    return G.PAPERS.find((p) => p.id === state.paperId) || G.PAPERS[0];
  }

  function resolveMailMark(state) {
    const t = MAIL_TYPES.find((m) => m.id === state.mailType) || MAIL_TYPES[0];
    return t.mark === null ? String(state.customMailMark || '').trim() : t.mark;
  }

  /** Pick the envelope size and construction according to the size mode. */
  function chooseSize(state, paper) {
    const contents = G.CONTENTS.find((c) => c.id === state.contentsId);
    const base = {
      paper,
      margin: +state.margin || 0,
      orientation: state.orientation,
      mode: state.mode,
      style: state.style,
      contents: contents && contents.w ? contents : null,
      maxRatio: +state.maxRatio || 0,
    };
    const solved = G.solveLargest(base);
    if (state.sizeMode === 'auto') {
      if (!solved.best) {
        return {
          error:
            state.mode === 'standard'
              ? '這張紙放不下符合中華郵政標準的信封展開圖。請改用較大的紙張、減少邊界，或將「規格」改為「不限」。'
              : '這張紙放不下任何信封展開圖，請改用較大的紙張或減少邊界。',
          solved,
        };
      }
      return { pick: solved.best, solved };
    }
    let W;
    let L;
    if (state.sizeMode === 'preset') {
      const p = G.ENVELOPE_PRESETS.find((x) => x.id === state.presetId) || G.ENVELOPE_PRESETS[0];
      W = p.w;
      L = p.l;
    } else {
      W = +state.customSize?.w || 0;
      L = +state.customSize?.l || 0;
      if (W > L) [W, L] = [L, W];
    }
    if (!(W > 0 && L > 0)) return { error: '請輸入信封尺寸。', solved };
    const pick = G.fitFixed(base, W, L);
    if (!pick) {
      return {
        error: `${W}×${L} mm 的信封展開圖放不下這張紙（扣除邊界 ${base.margin} mm）。可改用「自動（最大）」或較大的紙張。`,
        solved,
      };
    }
    return { pick, solved };
  }

  /** Label glyphs; screen-only labels go in a separate op that print/PDF skip. */
  function labelOps(labels, M) {
    const size = 2.6;
    const printed = [];
    const screen = [];
    for (const lb of labels) {
      const items = lb.screenOnly ? screen : printed;
      if (lb.vertical) {
        const cells = T.verticalCells(lb.text, {}, M);
        const h = T.cellsHeight(cells, 0) * size;
        items.push(...T.placeVertical(cells, lb.x, lb.y - h / 2, size, 0, M));
      } else {
        const w = T.measureH(lb.text, M) * size;
        items.push(...T.placeHorizontal(lb.text, lb.x - w / 2, lb.y + size * 0.35, size, M));
      }
    }
    const ops = [];
    if (printed.length) ops.push({ t: 'glyphs', items: printed, fill: COLORS.label });
    if (screen.length) ops.push({ t: 'glyphs', items: screen, fill: COLORS.label, screenOnly: true });
    return ops;
  }

  function applyMatrix(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  /**
   * state: see DEFAULT_STATE in app.js. metrics: from text.fontMetrics(font) or approx.
   * Returns { paper, ops, info, warnings, error }.
   */
  function buildSheet(state, metrics) {
    const M = metrics || T.approxMetrics;
    const paper = resolvePaper(state);
    const warnings = [];
    if (!(paper.w > 0 && paper.h > 0)) return { paper, ops: [], warnings, error: '請輸入紙張尺寸。' };

    const chosen = chooseSize(state, paper);
    if (chosen.error) return { paper, ops: [], warnings, error: chosen.error, info: { perStyle: chosen.solved.perStyle } };
    const pick = chosen.pick;
    const { A, B } = G.openingDims(state.orientation, pick.W, pick.L);
    const dl = G.buildDieline(pick.style, A, B);

    const data = {
      recipient: state.recipient || {},
      sender: state.sender || {},
      mailType: resolveMailMark(state),
      note: String(state.note || '').trim(),
    };
    const face = Lay.layoutFace(state.orientation, A, B, data, state.options || {}, M);
    warnings.push(...face.warnings);

    const matrix = G.placementMatrix(paper, { w: dl.w, h: dl.h }, pick.rotated);
    const glueOps = dl.glue.map((d) => ({ t: 'path', d, fill: COLORS.glue }));
    const foldOps = dl.folds.map(([x1, y1, x2, y2]) => ({
      t: 'path',
      d: [['M', x1, y1], ['L', x2, y2]],
      stroke: COLORS.fold,
      lw: 0.15,
      dash: [1.5, 1.5],
    }));
    const children = [
      ...glueOps,
      ...labelOps(dl.labels, M),
      { t: 'group', m: [1, 0, 0, 1, dl.front.x, dl.front.y], children: face.ops },
      ...foldOps,
      { t: 'path', d: dl.cut, stroke: COLORS.cut, lw: 0.3 },
    ];
    const ops = [{ t: 'group', m: matrix, children }];

    // Caption in the free strip below (or above) the dieline.
    const corners = [
      [0, 0],
      [dl.w, 0],
      [0, dl.h],
      [dl.w, dl.h],
    ].map(([x, y]) => applyMatrix(matrix, x, y));
    const top = Math.min(...corners.map((c) => c[1]));
    const bottom = Math.max(...corners.map((c) => c[1]));
    const margin = +state.margin || 0;
    const capSize = 2.4;
    const caption = `信封 ${pick.W}×${pick.L} mm・${G.STYLES[pick.style].label}　實線：裁切　虛線：摺線　灰底：塗膠`;
    let capY = null;
    if (paper.h - margin - bottom >= capSize + 2) capY = paper.h - margin - capSize * 0.3;
    else if (top - margin >= capSize + 2) capY = margin + capSize;
    if (capY !== null) {
      ops.push({ t: 'glyphs', items: T.placeHorizontal(caption, margin + 1, capY, capSize, M), fill: COLORS.label });
    }

    // Sanity warnings.
    const allText = [
      ...Object.values(data.recipient),
      ...Object.values(data.sender),
      data.mailType,
      data.note,
    ].map((v) => String(v || ''));
    const missing = T.missingChars(allText, metrics);
    if (missing.length) warnings.push(`目前字型缺少以下字元，將無法顯示：${missing.join(' ')}（可上傳其他字型）`);
    if (/掛號|快捷/.test(data.mailType) && !(String(data.sender.name || '').trim() && String(data.sender.address || '').trim())) {
      warnings.push('掛號、快捷郵件須詳細填寫寄件人姓名及地址。');
    }
    for (const [who, z] of [
      ['收件人', data.recipient.zip],
      ['寄件人', data.sender.zip],
    ]) {
      const d = T.normalizeAlnum(z || '').replace(/\D/g, '');
      if (d && ![3, 5, 6].includes(d.length)) warnings.push(`${who}郵遞區號應為 3、5 或 6 碼（目前 ${d.length} 碼）。`);
    }

    const issues = G.standardIssues(pick.W, pick.L);
    const info = {
      W: pick.W,
      L: pick.L,
      style: pick.style,
      rotated: pick.rotated,
      dieline: { w: dl.w, h: dl.h },
      standard: issues.length === 0,
      standardIssues: issues,
      contentsFit: G.contentsThatFit(pick.W, pick.L),
      perStyle: chosen.solved.perStyle,
      mailMark: data.mailType,
    };
    return { paper, margin, ops, info, warnings, error: null };
  }

  const api = { buildSheet, resolvePaper, MAIL_TYPES, COLORS };
  EG.compose = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
