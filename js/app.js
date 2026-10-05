/* 介面：表單 ↔ 狀態、即時預覽、下載 PDF / SVG、列印。 */
(function () {
  'use strict';
  const EG = window.EnvGen;
  const G = EG.geometry;
  const C = EG.compose;
  const T = EG.text;

  const STORAGE_KEY = 'envelope-generator-state-v1';

  const DEFAULT_STATE = {
    paperId: 'A4',
    customPaper: { w: 210, h: 297 },
    margin: 5,
    orientation: 'vertical',
    mode: 'standard',
    sizeMode: 'auto',
    presetId: 'cho3',
    customSize: { w: 110, l: 220 },
    contentsId: 'none',
    maxRatio: '',
    style: 'auto',
    mailType: 'normal',
    customMailMark: '',
    note: '',
    recipient: {
      zip: '100006',
      address: '臺北市中正區重慶南路一段122號',
      org: '',
      name: '王大明',
      title: '先生',
      salutation: '台啟',
    },
    sender: {
      zip: '403001',
      address: '臺中市西區民權路91號',
      name: '李小華',
      closing: '緘',
      phone: '',
    },
    options: { numerals: 'chinese', showFrame: true, showZipBoxes: true, showStamp: true },
  };

  const SALUTATION_HINTS = {
    收: '一般、晚輩或公務往來',
    啟: '一般通用',
    台啟: '平輩、朋友',
    大啟: '平輩、朋友',
    鈞啟: '長輩、長官、機關首長',
    道啟: '師長',
    安啟: '祖父母、父母',
    親啟: '限收件人本人拆閱',
    禮啟: '居喪者',
    勛啟: '軍政界人士',
    惠啟: '一般敬稱',
  };

  const $ = (sel) => document.querySelector(sel);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let state = loadState();
  let fontInfo = null; // { font, name, source }
  let metrics = T.approxMetrics;
  let sheet = null;
  let pending = false;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return deepMerge(clone(DEFAULT_STATE), JSON.parse(raw));
    } catch (e) {
      /* storage unavailable */
    }
    return clone(DEFAULT_STATE);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable */
    }
  }

  function deepMerge(base, extra) {
    for (const [k, v] of Object.entries(extra || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
      else if (k in base) base[k] = v;
    }
    return base;
  }

  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[last] = value;
  }

  // ---- form setup ------------------------------------------------------------------
  function fillSelect(sel, items, valueKey, labelKey) {
    for (const it of items) {
      const o = document.createElement('option');
      o.value = it[valueKey];
      o.textContent = it[labelKey];
      sel.appendChild(o);
    }
  }

  function setupForm() {
    fillSelect($('#paperId'), G.PAPERS.concat([{ id: 'custom', label: '自訂尺寸…' }]), 'id', 'label');
    fillSelect($('#presetId'), G.ENVELOPE_PRESETS, 'id', 'label');
    fillSelect($('#contentsId'), G.CONTENTS, 'id', 'label');
    fillSelect($('#style'), Object.values(G.STYLES), 'id', 'label');
    fillSelect($('#mailType'), C.MAIL_TYPES, 'id', 'label');
    writeForm();
    $('#form').addEventListener('input', onInput);
    $('#form').addEventListener('change', onInput);
  }

  function writeForm() {
    for (const el of document.querySelectorAll('[data-key]')) {
      const v = getPath(state, el.dataset.key);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === v;
      else el.value = v == null ? '' : v;
    }
    updateVisibility();
  }

  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.key) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio') {
      if (!el.checked) return;
      v = el.value;
    } else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
    else v = el.value;
    setPath(state, el.dataset.key, v);
    updateVisibility();
    saveState();
    scheduleRender();
  }

  function updateVisibility() {
    $('#customPaperRow').hidden = state.paperId !== 'custom';
    $('#presetRow').hidden = state.sizeMode !== 'preset';
    $('#customSizeRow').hidden = state.sizeMode !== 'custom';
    $('#autoRow').hidden = state.sizeMode !== 'auto';
    $('#customMarkLabel').hidden = state.mailType !== 'custom';
    const hint = SALUTATION_HINTS[String(state.recipient.salutation || '').trim()];
    $('#salutationHint').textContent = hint ? `「${state.recipient.salutation.trim()}」適用：${hint}` : '';
  }

  // ---- rendering ---------------------------------------------------------------------
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      render();
    });
  }

  function render() {
    sheet = C.buildSheet(state, metrics);
    const font = fontInfo && fontInfo.font;
    const ready = !sheet.error && !!font;
    $('#btnPdf').disabled = !ready;
    $('#btnPrint').disabled = !ready;
    $('#btnSvg').disabled = !ready;

    renderSummary();
    renderStyleTable();
    const warn = $('#warnings');
    warn.innerHTML = '';
    const msgs = sheet.error ? [sheet.error] : sheet.warnings;
    for (const w of msgs) {
      const li = document.createElement('li');
      li.textContent = w;
      if (sheet.error) li.className = 'error';
      warn.appendChild(li);
    }
    const pv = $('#preview');
    if (sheet.error) {
      pv.innerHTML = '';
      return;
    }
    pv.innerHTML = EG.render.renderSVG(sheet, font, { showMargin: true });
  }

  function renderSummary() {
    const box = $('#summary');
    if (sheet.error || !sheet.info) {
      box.innerHTML = '';
      return;
    }
    const i = sheet.info;
    const paper = sheet.paper;
    const parts = [];
    parts.push(`<div class="big">${i.W} × ${i.L} <span>mm</span></div>`);
    const tags = [];
    tags.push(`<span class="tag">${state.orientation === 'horizontal' ? '橫式' : '直式'}</span>`);
    tags.push(`<span class="tag">${G.STYLES[i.style].label}</span>`);
    tags.push(
      i.standard
        ? '<span class="tag ok">✓ 符合標準信函</span>'
        : `<span class="tag warn" title="${i.standardIssues.join('；')}">非標準信函</span>`
    );
    if (i.mailMark) tags.push(`<span class="tag red">${escapeHtml(i.mailMark)}</span>`);
    parts.push(`<div class="tags">${tags.join('')}</div>`);
    const fits = i.contentsFit.map((c) => c.label.replace(/\s*\(.*\)/, '')).join('、');
    parts.push(
      `<div class="meta">${escapeHtml(paper.label)}・展開圖 ${i.dieline.w.toFixed(0)}×${i.dieline.h.toFixed(0)} mm` +
        `${i.rotated ? '（紙張橫放排版）' : ''}${fits ? `<br>可裝入：${fits}` : ''}` +
        `${i.standard ? '' : `<br>${escapeHtml(i.standardIssues.join('；'))}`}</div>`
    );
    box.innerHTML = parts.join('');
  }

  function renderStyleTable() {
    const t = $('#styleTable');
    // sheet.info.perStyle only covers the forced style, so solve for every style here.
    const all = G.solveLargest({
      paper: sheet.paper,
      margin: +state.margin || 0,
      orientation: state.orientation,
      mode: state.mode,
      style: 'auto',
      contents: G.CONTENTS.find((c) => c.id === state.contentsId && c.w) || null,
      maxRatio: +state.maxRatio || 0,
    }).perStyle;
    let html = '<tr><th>結構</th><th>最大尺寸</th><th></th></tr>';
    for (const id of G.STYLE_IDS) {
      const c = all[id];
      const cur = sheet.info && sheet.info.style === id;
      html += `<tr class="${cur ? 'current' : ''}"><td>${G.STYLES[id].label}</td><td>${
        c ? `${c.W} × ${c.L} mm` : '放不下'
      }</td><td>${c && !cur ? `<button type="button" class="link" data-style="${id}">使用</button>` : cur ? '使用中' : ''}</td></tr>`;
    }
    t.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // ---- outputs -----------------------------------------------------------------------
  function fileBase() {
    // ASCII only: some browsers replace non-ASCII download names with "download".
    const i = sheet.info;
    return `envelope_${i.W}x${i.L}_${state.orientation}_${sheet.paper.id}`;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function onPdf() {
    if (!sheet || sheet.error || !fontInfo) return;
    setStatus('產生 PDF 中…');
    try {
      const title = `信封 ${sheet.info.W}×${sheet.info.L} mm`;
      const bytes = await EG.pdf.buildPDF(sheet, fontInfo.font, { title });
      download(new Blob([bytes], { type: 'application/pdf' }), fileBase() + '.pdf');
      setStatus('PDF 已下載。請以 100% 實際大小列印。');
    } catch (e) {
      console.error(e);
      setStatus('PDF 產生失敗：' + e.message, true);
    }
  }

  function onSvg() {
    if (!sheet || sheet.error || !fontInfo) return;
    const svg = EG.render.renderSVG(sheet, fontInfo.font, {});
    download(new Blob([svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
  }

  function onPrint() {
    if (!sheet || sheet.error || !fontInfo) return;
    const { w, h } = sheet.paper;
    $('#printPageStyle').textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
    $('#printArea').innerHTML = EG.render.renderSVG(sheet, fontInfo.font, {});
    window.print();
  }

  function setStatus(msg, isError) {
    const s = $('#status');
    s.textContent = msg || '';
    s.classList.toggle('error', !!isError);
  }

  // ---- fonts -------------------------------------------------------------------------
  function useFont(info) {
    fontInfo = info;
    metrics = T.fontMetrics(info.font);
    $('#fontName').textContent = info.name;
    $('#fontReset').hidden = info.name === EG.fonts.DEFAULT_FONT_NAME;
    scheduleRender();
  }

  async function loadDefaultFont() {
    $('#fontName').textContent = '載入中…';
    setStatus('正在載入字型（約 13 MB，第一次需要一點時間）…');
    try {
      useFont(await EG.fonts.loadDefault());
      setStatus('');
    } catch (e) {
      console.error(e);
      $('#fontName').textContent = '未載入';
      setStatus('預設字型載入失敗，請按「上傳字型」選擇電腦中的中文字型（.ttf / .otf）。', true);
    }
  }

  async function onFontFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setStatus('讀取字型中…');
    try {
      useFont(await EG.fonts.loadFile(file));
      setStatus('已改用上傳的字型。');
    } catch (err) {
      setStatus('字型讀取失敗：' + err.message, true);
    }
    e.target.value = '';
  }

  // ---- init --------------------------------------------------------------------------
  function init() {
    setupForm();
    $('#btnPdf').addEventListener('click', onPdf);
    $('#btnSvg').addEventListener('click', onSvg);
    $('#btnPrint').addEventListener('click', onPrint);
    $('#fontFile').addEventListener('change', onFontFile);
    $('#fontReset').addEventListener('click', loadDefaultFont);
    $('#resetAll').addEventListener('click', () => {
      state = clone(DEFAULT_STATE);
      saveState();
      writeForm();
      scheduleRender();
    });
    $('#styleTable').addEventListener('click', (e) => {
      const id = e.target.dataset && e.target.dataset.style;
      if (!id) return;
      state.style = id;
      writeForm();
      saveState();
      scheduleRender();
    });
    window.addEventListener('afterprint', () => {
      $('#printArea').innerHTML = '';
    });
    render();
    loadDefaultFont();
  }

  init();
})();
