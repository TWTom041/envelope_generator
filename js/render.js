/*
 * 繪製：把 ops 轉成 SVG。文字以字型輪廓（path）輸出，預覽、列印與 PDF 完全一致。
 * Renders drawing ops to SVG. Text is converted to glyph outlines with the
 * loaded font; without a font it falls back to <text> elements.
 */
(function (root) {
  'use strict';
  const EG = root.EnvGen || (root.EnvGen = {});
  const T = EG.text || (typeof require === 'function' ? require('./text.js') : null);

  const FALLBACK_FONTS = "'LXGW WenKai TC','BiauKai','DFKai-SB','標楷體','Kaiti TC','Noto Serif TC','PMingLiU',serif";

  const outlineCache = new WeakMap();

  /** Glyph outline in em units, y-down, relative to the baseline origin. */
  function emOutline(fontLike, ch) {
    const { glyph, font } = T.resolveGlyph(fontLike, ch);
    let cache = outlineCache.get(font);
    if (!cache) {
      cache = new Map();
      outlineCache.set(font, cache);
    }
    let cmds = cache.get(ch);
    if (!cmds) {
      const dy = emTop(font) - T.EM_TOP;
      cmds =
        glyph.index === 0
          ? []
          : glyph.getPath(0, 0, 1).commands.map((c) => {
              const o = Object.assign({}, c);
              for (const k of ['y', 'y1', 'y2']) if (k in o) o[k] += dy;
              return o;
            });
      cache.set(ch, cmds);
    }
    return cmds;
  }

  /*
   * Top of the ideographic em box in em units. Layout assumes 0.88 (most CJK
   * fonts); fonts with another split (全字庫: 820/−204 of 1024) are shifted so
   * mixed fonts share the same em box.
   */
  function emTop(font) {
    const os2 = font.tables && font.tables.os2;
    if (!os2) return T.EM_TOP;
    const asc = os2.sTypoAscender;
    const desc = os2.sTypoDescender;
    const upm = font.unitsPerEm;
    if (!(asc > 0) || Math.abs(asc - desc - upm) > upm * 0.05) return T.EM_TOP;
    return asc / upm;
  }

  /** Absolute path commands for a positioned glyph item. */
  function glyphCommands(font, it) {
    const k = it.size;
    const sx = it.sx || 1;
    let tf = (px, py) => [it.x + px * k * sx, it.y + py * k];
    if (it.rot) {
      const base = tf;
      tf = (px, py) => {
        const [X, Y] = base(px, py);
        return [it.cx - (Y - it.cy), it.cy + (X - it.cx)];
      };
    }
    const out = [];
    for (const c of emOutline(font, it.ch)) {
      if (c.type === 'M' || c.type === 'L') out.push([c.type, ...tf(c.x, c.y)]);
      else if (c.type === 'Q') out.push(['Q', ...tf(c.x1, c.y1), ...tf(c.x, c.y)]);
      else if (c.type === 'C') out.push(['C', ...tf(c.x1, c.y1), ...tf(c.x2, c.y2), ...tf(c.x, c.y)]);
      else if (c.type === 'Z') out.push(['Z']);
    }
    return out;
  }

  const n = (v) => {
    const s = (Math.round(v * 1000) / 1000).toString();
    return s === '-0' ? '0' : s;
  };

  function pathData(cmds) {
    let d = '';
    for (const c of cmds) d += c[0] + c.slice(1).map(n).join(' ');
    return d;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function svgOps(ops, font, out, screen) {
    for (const op of ops) {
      if (op.screenOnly && !screen) continue;
      if (op.t === 'group') {
        out.push(`<g transform="matrix(${op.m.map(n).join(' ')})">`);
        svgOps(op.children, font, out, screen);
        out.push('</g>');
      } else if (op.t === 'path') {
        const a = [`d="${pathData(op.d)}"`, `fill="${op.fill || 'none'}"`];
        if (op.stroke) {
          a.push(`stroke="${op.stroke}"`, `stroke-width="${n(op.lw || 0.25)}"`, 'stroke-linejoin="round"');
          if (op.dash) a.push(`stroke-dasharray="${op.dash.map(n).join(' ')}"`);
        }
        out.push(`<path ${a.join(' ')}/>`);
      } else if (op.t === 'glyphs') {
        if (font) {
          let d = '';
          for (const it of op.items) d += pathData(glyphCommands(font, it));
          if (d) out.push(`<path d="${d}" fill="${op.fill}"/>`);
        } else {
          for (const it of op.items) {
            let tr = '';
            if (it.rot) tr += ` transform="rotate(${it.rot} ${n(it.cx)} ${n(it.cy)})"`;
            else if (it.sx && it.sx !== 1) tr += ` transform="translate(${n(it.x)} 0) scale(${n(it.sx)} 1) translate(${n(-it.x)} 0)"`;
            out.push(
              `<text x="${n(it.x)}" y="${n(it.y)}" font-size="${n(it.size)}" fill="${op.fill}"${tr}>${esc(it.ch)}</text>`
            );
          }
        }
      }
    }
  }

  /** Full-page SVG string (viewBox in mm). opts.screen adds preview-only guides. */
  function renderSVG(sheet, font, opts) {
    const o = opts || {};
    const { w, h } = sheet.paper;
    const out = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}mm" height="${n(h)}mm"` +
        ` font-family="${FALLBACK_FONTS}">`,
    ];
    if (!o.transparent) out.push(`<rect x="0" y="0" width="${n(w)}" height="${n(h)}" fill="#ffffff"/>`);
    if (o.showMargin && sheet.margin > 0) {
      const m = sheet.margin;
      out.push(
        `<rect x="${n(m)}" y="${n(m)}" width="${n(w - 2 * m)}" height="${n(h - 2 * m)}" fill="none" stroke="#4a90d9" stroke-width="0.2" stroke-dasharray="1 1" opacity="0.6"/>`
      );
    }
    svgOps(sheet.ops, font, out, !!o.screen);
    out.push('</svg>');
    return out.join('');
  }

  const api = { renderSVG, glyphCommands, pathData, FALLBACK_FONTS };
  EG.render = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
