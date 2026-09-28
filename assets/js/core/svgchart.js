/* ============================================================
   Inline-SVG charts in the Industry style (hairline grid, CSS-variable
   colours, solid accent = system, dashed neutral = pump). Returns markup.
   Values passed in are already in display units.
   ============================================================ */
(function (RO) {
"use strict";

const esc = s => RO.util.escHtml(s);
const niceStep = span => {
  const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const ticks = (lo, hi) => { const s = niceStep(hi - lo), out = []; for (let v = Math.ceil(lo / s) * s; v <= hi + s * 1e-6; v += s) out.push(+v.toFixed(10)); return out; };
const fmtTick = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-GB") : String(+v.toFixed(Math.abs(v) < 10 ? 2 : 1));

const STYLE = {
  sys:    { stroke: "var(--color-accent)", width: 2 },
  sys2:   { stroke: "var(--color-accent-400)", width: 1.5, dash: "6 4" },
  pump:   { stroke: "var(--color-neutral-600)", width: 1.5, dash: "5 4" },
  pumpN:  { stroke: "var(--color-accent-900)", width: 2 },
  line2:  { stroke: "var(--color-accent-2-600)", width: 1.5, dash: "3 3" },
  ground: { stroke: "var(--color-neutral-500)", width: 1.2, dash: "2 3" },
  pipe:   { stroke: "var(--color-neutral-900)", width: 2.5 },
  egl:    { stroke: "var(--color-accent-300)", width: 1.2, dash: "8 3 2 3" },
  static: { stroke: "var(--color-neutral-600)", width: 1.2, dash: "6 4" }
};

/**
 * Line chart. opt: { w, h, xmax, xmin, ymin, ymax, xTitle, yTitle, series: [{ pts:[[x,y]], kind }],
 *                    points: [{ x, y, label }], hlines: [{ y, label, kind }], shade: [{ x0, x1 }],
 *                    marks: [{ x, y, label, shape: "up" | "down" | "dot" }] (small markers, e.g. air valves / drains / fittings) }
 */
function lines(opt) {
  const W = opt.w || 520, H = opt.h || 240, X0 = 48, X1 = W - 12, Y0 = H - 30, Y1 = 12;
  const xmin = opt.xmin || 0, xmax = opt.xmax, ymin = opt.ymin ?? 0, ymax = opt.ymax;
  const x = v => X0 + (v - xmin) / (xmax - xmin || 1) * (X1 - X0);
  const y = v => Y0 - (v - ymin) / (ymax - ymin || 1) * (Y0 - Y1);
  const yt = ticks(ymin, ymax), xt = ticks(xmin, xmax);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.label || "chart")}" class="svgchart">`;
  (opt.shade || []).forEach(sh => { s += `<rect x="${x(sh.x0).toFixed(1)}" y="${Y1}" width="${Math.max(0, x(sh.x1) - x(sh.x0)).toFixed(1)}" height="${Y0 - Y1}" fill="var(--color-accent-100)"></rect>`; });
  yt.forEach(v => { s += `<line x1="${X0}" x2="${X1}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--color-neutral-300)" stroke-width="1"></line><text x="${X0 - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--color-neutral-700)">${fmtTick(v)}</text>`; });
  xt.forEach(v => { s += `<text x="${x(v).toFixed(1)}" y="${Y0 + 16}" text-anchor="middle" font-size="11" fill="var(--color-neutral-700)">${fmtTick(v)}</text>`; });
  s += `<line x1="${X0}" x2="${X1}" y1="${Y0}" y2="${Y0}" stroke="var(--color-neutral-600)" stroke-width="1"></line>`;
  if (ymin < 0 && ymax > 0) s += `<line x1="${X0}" x2="${X1}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--color-neutral-600)" stroke-width="1"></line>`;
  (opt.hlines || []).forEach(hl => {
    const st = STYLE[hl.kind] || STYLE.line2;
    s += `<line x1="${X0}" x2="${X1}" y1="${y(hl.y).toFixed(1)}" y2="${y(hl.y).toFixed(1)}" stroke="${st.stroke}" stroke-width="1.2" stroke-dasharray="${st.dash || "4 3"}"></line>`;
    if (hl.label) s += `<text x="${X1 - 4}" y="${(y(hl.y) - 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--color-accent-800)">${esc(hl.label)}</text>`;
  });
  (opt.series || []).forEach(se => {
    const st = STYLE[se.kind] || STYLE.sys;
    let d = "";
    se.pts.forEach(([a, b], i) => { if (!isFinite(b)) return; d += (d ? "L" : "M") + x(a).toFixed(1) + " " + y(Math.max(ymin, Math.min(ymax, b))).toFixed(1); });
    if (d) s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}></path>`;
  });
  (opt.points || []).forEach(p => {
    const px = x(p.x), py = y(p.y);
    s += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${py.toFixed(1)}" y2="${Y0}" stroke="var(--color-accent-700)" stroke-width="1" stroke-dasharray="2 3"></line>`;
    s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="var(--color-bg)" stroke="var(--color-accent-800)" stroke-width="2"></circle>`;
    if (p.label) {
      const right = px < X1 - 170;
      s += `<text x="${(right ? px + 10 : px - 10).toFixed(1)}" y="${(py - 10).toFixed(1)}" text-anchor="${right ? "start" : "end"}" font-size="12" fill="var(--color-accent-800)">${esc(p.label)}</text>`;
    }
  });
  (opt.marks || []).forEach(m => {
    const px = x(m.x), py = y(Math.max(ymin, Math.min(ymax, m.y)));
    if (m.shape === "up") s += `<path d="M${px.toFixed(1)} ${(py - 11).toFixed(1)} l5 8 h-10 z" fill="var(--color-accent-800)"></path>`;
    else if (m.shape === "down") s += `<path d="M${px.toFixed(1)} ${(py + 11).toFixed(1)} l5 -8 h-10 z" fill="var(--color-neutral-700)"></path>`;
    else s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.6" fill="var(--color-bg)" stroke="var(--color-neutral-800)" stroke-width="1.2"></circle>`;
    if (m.label) s += `<text x="${px.toFixed(1)}" y="${(m.shape === "down" ? py + 22 : py - 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--color-accent-800)">${esc(m.label)}</text>`;
  });
  if (opt.xTitle) s += `<text x="${X1}" y="${H - 2}" text-anchor="end" font-size="11" fill="var(--color-neutral-700)">${esc(opt.xTitle)}</text>`;
  if (opt.yTitle) s += `<text x="${X0}" y="${Y1 - 2}" font-size="11" fill="var(--color-neutral-700)">${esc(opt.yTitle)}</text>`;
  return s + "</svg>";
}

/**
 * Stacked / grouped bars. opt: { w, h, ymax, ymin, bars: [{ label, segs: [{ v0, v1, kind, text }] }], hlines }
 * kinds: base (accent), loss (accent-400), loss2 (accent-2-500), ok (accent-200), short (accent-900)
 */
function bars(opt) {
  const W = opt.w || 520, H = opt.h || 240, X0 = 48, X1 = W - 12, Y0 = H - 30, Y1 = 12;
  const ymin = opt.ymin ?? 0, ymax = opt.ymax;
  const y = v => Y0 - (v - ymin) / (ymax - ymin || 1) * (Y0 - Y1);
  const FILL = { base: "var(--color-accent)", loss: "var(--color-accent-400)", loss2: "var(--color-accent-2-500)", ok: "var(--color-accent-200)", short: "var(--color-accent-900)", neutral: "var(--color-neutral-400)" };
  const TEXT = { base: "var(--color-bg)", loss: "var(--color-accent-900)", loss2: "var(--color-bg)", ok: "var(--color-accent-900)", short: "var(--color-bg)", neutral: "var(--color-text)" };
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.label || "chart")}" class="svgchart">`;
  ticks(ymin, ymax).forEach(v => { s += `<line x1="${X0}" x2="${X1}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--color-neutral-300)"></line><text x="${X0 - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--color-neutral-700)">${fmtTick(v)}</text>`; });
  s += `<line x1="${X0}" x2="${X1}" y1="${y(Math.max(ymin, 0)).toFixed(1)}" y2="${y(Math.max(ymin, 0)).toFixed(1)}" stroke="var(--color-neutral-600)"></line>`;
  const n = opt.bars.length, slot = (X1 - X0) / n, bw = Math.min(110, slot * 0.5);
  opt.bars.forEach((b, i) => {
    const cx = X0 + slot * (i + 0.5);
    b.segs.forEach(sg => {
      const top = y(Math.max(sg.v0, sg.v1)), bot = y(Math.min(sg.v0, sg.v1)), hgt = Math.max(0, bot - top);
      s += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${FILL[sg.kind] || FILL.base}"></rect>`;
      if (sg.text && hgt > 15) s += `<text x="${cx.toFixed(1)}" y="${((top + bot) / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${TEXT[sg.kind] || TEXT.base}">${esc(sg.text)}</text>`;
    });
    s += `<text x="${cx.toFixed(1)}" y="${Y0 + 16}" text-anchor="middle" font-size="11" fill="var(--color-text)">${esc(b.label)}</text>`;
  });
  (opt.hlines || []).forEach(hl => {
    s += `<line x1="${X0}" x2="${X1}" y1="${y(hl.y).toFixed(1)}" y2="${y(hl.y).toFixed(1)}" stroke="${hl.color || "var(--color-accent-900)"}" stroke-width="1.2" stroke-dasharray="${hl.dash || "5 3"}"></line>`;
    if (hl.label) s += `<text x="${X1 - 4}" y="${(y(hl.y) - 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--color-accent-800)">${esc(hl.label)}</text>`;
  });
  if (opt.yTitle) s += `<text x="${X0}" y="${Y1 - 2}" font-size="11" fill="var(--color-neutral-700)">${esc(opt.yTitle)}</text>`;
  return s + "</svg>";
}

RO.svgchart = { lines, bars, ticks };
})(window.RO = window.RO || {});
