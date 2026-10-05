/*
 * 極簡 PDF 產生器：只輸出向量路徑（文字已轉為字型輪廓），不需內嵌字型，
 * 任何 PDF 閱讀器、印表機都能正確顯示。
 * Minimal vector-only PDF writer. Pages use mm in a y-down coordinate system via
 * an initial transformation matrix, so ops are written exactly as drawn in SVG.
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});
  const R = EG.render || (typeof require === 'function' ? require('./render.js') : null);

  const PT_PER_MM = 72 / 25.4;

  const num = (v) => {
    const s = (Math.round(v * 1000) / 1000).toString();
    return s === '-0' ? '0' : s;
  };

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.replace(/./g, '$&$&') : h;
    const v = parseInt(full, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map((c) => num(c)).join(' ');
  }

  /** Append path construction operators; quadratic curves become cubic. */
  function pathOps(cmds, out) {
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    for (const c of cmds) {
      switch (c[0]) {
        case 'M':
          cx = sx = c[1];
          cy = sy = c[2];
          out.push(`${num(cx)} ${num(cy)} m`);
          break;
        case 'L':
          cx = c[1];
          cy = c[2];
          out.push(`${num(cx)} ${num(cy)} l`);
          break;
        case 'Q': {
          const [, qx, qy, x, y] = c;
          const c1x = cx + (2 / 3) * (qx - cx);
          const c1y = cy + (2 / 3) * (qy - cy);
          const c2x = x + (2 / 3) * (qx - x);
          const c2y = y + (2 / 3) * (qy - y);
          out.push(`${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(x)} ${num(y)} c`);
          cx = x;
          cy = y;
          break;
        }
        case 'C':
          out.push(c.slice(1).map(num).join(' ') + ' c');
          cx = c[5];
          cy = c[6];
          break;
        case 'Z':
          out.push('h');
          cx = sx;
          cy = sy;
          break;
        default:
          break;
      }
    }
  }

  function contentOps(ops, font, out) {
    for (const op of ops) {
      if (op.screenOnly) continue; // preview-only guides are never printed
      if (op.t === 'group') {
        out.push('q', op.m.map(num).join(' ') + ' cm');
        contentOps(op.children, font, out);
        out.push('Q');
      } else if (op.t === 'path') {
        out.push('q');
        if (op.fill) out.push(hexToRgb(op.fill) + ' rg');
        if (op.stroke) {
          out.push(hexToRgb(op.stroke) + ' RG', num(op.lw || 0.25) + ' w', '1 j');
          out.push(op.dash ? `[${op.dash.map(num).join(' ')}] 0 d` : '[] 0 d');
        }
        pathOps(op.d, out);
        out.push(op.fill && op.stroke ? 'B' : op.fill ? 'f' : 'S');
        out.push('Q');
      } else if (op.t === 'glyphs' && font) {
        const parts = [];
        for (const it of op.items) pathOps(R.glyphCommands(font, it), parts);
        if (parts.length) out.push(hexToRgb(op.fill) + ' rg', ...parts, 'f');
      }
    }
  }

  function utf16Hex(s) {
    let hex = 'FEFF';
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return `<${hex}>`;
  }

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  /**
   * Build a one-page PDF for a sheet. Returns a Uint8Array.
   * meta: { title }
   */
  async function buildPDF(sheet, font, meta) {
    const wPt = sheet.paper.w * PT_PER_MM;
    const hPt = sheet.paper.h * PT_PER_MM;
    const out = [`${num(PT_PER_MM)} 0 0 ${num(-PT_PER_MM)} 0 ${num(hPt)} cm`, '1 J'];
    contentOps(sheet.ops, font, out);
    const enc = new TextEncoder();
    const raw = enc.encode(out.join('\n'));
    const packed = await deflate(raw);
    const stream = packed || raw;

    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    objects[3] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(wPt)} ${num(hPt)}] ` +
      '/Resources << /ProcSet [/PDF] >> /Contents 4 0 R >>';
    objects[4] = { dict: `<< /Length ${stream.length}${packed ? ' /Filter /FlateDecode' : ''} >>`, stream };
    const title = (meta && meta.title) || '信封展開圖';
    objects[5] = `<< /Title ${utf16Hex(title)} /Creator ${utf16Hex('台灣信封產生器 Envelope Generator')} >>`;

    const chunks = [];
    let offset = 0;
    const push = (data) => {
      const b = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(b);
      offset += b.length;
    };
    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment
    const xref = [];
    for (let i = 1; i < objects.length; i++) {
      xref[i] = offset;
      const o = objects[i];
      if (typeof o === 'string') {
        push(`${i} 0 obj\n${o}\nendobj\n`);
      } else {
        push(`${i} 0 obj\n${o.dict}\nstream\n`);
        push(o.stream);
        push('\nendstream\nendobj\n');
      }
    }
    const xrefAt = offset;
    let x = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) x += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
    push(x);
    push(`trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    const total = new Uint8Array(offset);
    let p = 0;
    for (const c of chunks) {
      total.set(c, p);
      p += c.length;
    }
    return total;
  }

  const api = { buildPDF, PT_PER_MM };
  EG.pdf = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
