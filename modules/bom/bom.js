/* ============================================================
   Module: Bill of materials (Design › Bill of materials) — PRD §4 Phase 2,
   equations.md §9B. Collects the Intake route, the Pipeline design line
   (opt-in), concrete blocks from Supports & buoyancy and the Intake pumps.
   ============================================================ */
(function (RO) {
"use strict";

const C = RO.bomCalc;
const U = RO.units;
const { escHtml: esc } = RO.util;
const PREF_KEY = "rocalc.bom.prefs";

let ROOT = null, META = null, TABS = null, ACTIONS = null;
let S = { src: { intake: true, pipeline: false, blocks: true, pumps: true }, stick_m: null, allowance_pct: null };
let B = null, info = {};
const pumpNames = {};

try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); if (p) S = Object.assign(S, p, { src: Object.assign(S.src, p.src || {}) }); } catch (e) { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(S)); } catch (e) { /* not persisted */ } };

const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const section = (num, title, body, extra = "") =>
  `<section class="blueprint in-sec">${corners()}<div class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2>${extra}</div>${body}</section>`;
const blank = v => v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));
const wu = (q, v, d) => U.withUnit(q, v, d);
const kpiHtml = list => `<div class="kpis">${list.map(k => `<div class="kpi"><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v">${esc(k.value)}</div><div class="kpi-u">${esc(k.unit)}</div></div>`).join("")}</div>`;
const srcCell = list => `<span class="dim">${esc(list.join(", "))}</span>`;

/* ---------- collect sources ---------- */
function collect() {
  info = {};
  const segs = [];
  let pumps = null;
  try {
    const I = C.fromIntake(RO.app.ensure("intake").getState().state);
    info.intake = `${I.segs.length} segment${I.segs.length !== 1 ? "s" : ""}`;
    if (S.src.intake) segs.push(...I.segs);
    if (I.pumps && I.pumps.duty > 0) {
      const id = I.pumps.pumpId;
      const name = id ? (pumpNames[id] || "selected pump") : `${I.pumps.type || "intake"} pump (not selected yet)`;
      info.pumps = `${I.pumps.duty} duty + ${I.pumps.standby} standby`;
      if (S.src.pumps) pumps = Object.assign({ label: `Intake pump — ${name}` }, I.pumps);
      if (id && !pumpNames[id]) RO.pumplib.get(id).then(p => { if (p) { pumpNames[id] = `${p.vendor} ${p.model}`; if (ROOT && RO.app.isActive("bom")) render(); } }).catch(() => { /* keep generic name */ });
    }
  } catch (e) { info.intake = "not available"; }
  try {
    const P = C.fromPipeline(RO.app.ensure("pipeline").getState().state);
    info.pipeline = P.error ? `not usable: ${P.error}` : `“${P.name || "line"}” · ${P.segs.length} segment${P.segs.length !== 1 ? "s" : ""}`;
    if (S.src.pipeline && !P.error) segs.push(...P.segs);
  } catch (e) { info.pipeline = "not available"; }
  let buoy = null;
  try {
    const def = RO.app.ensure("buoyancy");
    buoy = def.compute();
    info.blocks = `${buoy.rows.length} section${buoy.rows.length !== 1 ? "s" : ""} · ${buoy.pieces} pieces`;
    if (!S.src.blocks) buoy = null;
  } catch (e) { info.blocks = "not available"; }
  return { segs, pumps, buoyancy: buoy, stick_m: S.stick_m, allowance_pct: S.allowance_pct };
}

/* ---------- render ---------- */
function field(key, label, q, recKey, why) {
  const v = S[key], rec = RO.values.get(recKey), isBlank = blank(v);
  const unit = q === "none" ? "" : U.label(q);
  return `<div class="field in-field${isBlank ? " is-rec" : ""}"><label for="bm_${key}"><span>${esc(label)}</span><span class="unit">${esc(unit)}</span></label>
    <div class="in-wrap"><input class="input" id="bm_${key}" inputmode="decimal" data-key="${key}" data-q="${q}" value="${esc(isBlank ? "" : U.inputValue(q, v))}" placeholder="${isBlank ? esc(U.fmt(q, rec)) : ""}">
      ${isBlank ? '<span class="tag tag-accent rec-tag">REC</span>' : ""}</div>
    <div class="in-help">${esc(isBlank ? `Blank uses ${U.fmt(q, rec)}${unit ? " " + unit : ""}, ${why}.` : `Recommended ${U.fmt(q, rec)}${unit ? " " + unit : ""}. Clear to use it.`)}</div></div>`;
}
function srcBox(k, label, sub, link) {
  return `<label class="bm-src"><input type="checkbox" data-src="${k}"${S.src[k] ? " checked" : ""}><span><strong>${esc(label)}</strong><span class="dim">${esc(sub || "")}</span></span><a href="${link}" class="bm-open">Open</a></label>`;
}

function render() {
  if (!ROOT) return;
  const input = collect();
  B = C.build(input);
  const L = q => U.label(q);
  const pipeRows = B.pipes.map(p => `<tr><td>${esc(p.label)}</td><td class="r">OD ${p.OD}</td><td class="r">${p.sdr ? "SDR " + p.sdr : `e ${p.e.toFixed(1)} mm`}</td>
      <td class="r">${U.fmt("len", p.net)}</td><td class="r"><strong>${U.fmt("len", p.order)}</strong></td><td class="r">${p.sticks}</td><td>${srcCell(p.sources)}</td></tr>`).join("");
  const fitRows = B.fittings.map(f => `<tr><td>${esc(f.name)} <span class="dim">${esc(f.code)}</span></td><td class="r">OD ${f.OD}</td><td>${esc(f.connection === "none" ? "—" : f.connection.replace("_", " "))}</td><td class="r"><strong>${f.qty}</strong></td><td>${srcCell(f.sources)}</td></tr>`).join("");
  const jRows = B.joints.map(j => `<tr><td>${esc(j.item)}</td><td class="r">${esc(j.size)}</td><td class="r"><strong>${j.qty}</strong></td><td>${srcCell(j.sources)}</td></tr>`).join("");
  const flRows = B.flanges.map(x => `<tr><td>${esc(x.item)}</td><td class="r">${esc(x.size)}</td><td class="r">${esc(x.rating)}</td><td class="r"><strong>${x.qty}</strong></td><td>${srcCell(x.sources)}</td></tr>`).join("");
  const blRows = B.blocks.map(b => `<tr><td>Concrete block ${esc(wu("mass", b.piece_kg))}</td><td class="r"><strong>${b.pieces}</strong></td><td class="r">${U.fmt("mass", b.mass / 1000, 1)} t</td><td class="r">${wu("vol", b.concrete, 2)}</td><td>${srcCell(b.sections)}</td></tr>`).join("");
  const empty = (n, txt) => `<tr><td colspan="${n}" class="dim">${esc(txt)}</td></tr>`;
  const left = section("01", "Sources", `
      <div class="bm-srcs">
        ${srcBox("intake", "Intake route", info.intake, "#/intake/sizing")}
        ${srcBox("pipeline", "Pipeline design line", info.pipeline + " — tick only if it was not sent to Intake (no double counting)", "#/pipeline/profile")}
        ${srcBox("blocks", "Concrete blocks (Supports & buoyancy)", info.blocks, "#/buoyancy/sections")}
        ${srcBox("pumps", "Intake pumps", info.pumps || "no pump station", "#/intake/selection")}
      </div>`) +
    section("02", "Settings", `<div class="in-grid">${field("stick_m", "Pipe stick length", "len", "bom.stick_m", "standard straight length")}${field("allowance_pct", "Ordering allowance", "pct", "bom.allowance_pct", "cut-offs and fusion beads")}</div>`) +
    section("03", "Pipes", `<div class="table-wrap"><table class="table"><thead><tr><th>Material</th><th class="r">Size</th><th class="r">Class</th><th class="r">Net ${L("len")}</th><th class="r">Order ${L("len")}</th><th class="r">Lengths</th><th>Source</th></tr></thead>
      <tbody>${pipeRows || empty(7, "No pipes — tick a source.")}</tbody></table></div>
      <p class="dim">Net = along the pipe × lines (pump-local piping × installed pumps). Order = net + ${(B.allow * 100).toFixed(1)} %; lengths of ${wu("len", B.stick, 0)}.</p>`) +
    section("04", "Fittings", `<div class="table-wrap"><table class="table"><thead><tr><th>Fitting</th><th class="r">Size</th><th>Ends</th><th class="r">Qty</th><th>Source</th></tr></thead>
      <tbody>${fitRows || empty(5, "No BOM fittings.")}</tbody></table></div><p class="dim">Items the fittings list marks “not in BOM” (entrances, exits, sudden changes) are left out.</p>`) +
    section("05", "Joints", `<div class="table-wrap"><table class="table"><thead><tr><th>Joint</th><th class="r">Size</th><th class="r">Qty</th><th>Source</th></tr></thead>
      <tbody>${jRows || empty(4, "No joints.")}</tbody></table></div><p class="dim">Pipe-to-pipe joints between lengths (by the segment's joint method) plus one per fitting end.</p>`) +
    section("06", "Flanges, gaskets & bolts", `<div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th class="r">Size</th><th class="r">Rating</th><th class="r">Qty</th><th>Source</th></tr></thead>
      <tbody>${flRows || empty(5, "No flanged joints.")}</tbody></table></div><p class="dim">DN = largest standard DN ≤ pipe OD; PN = the pipe's rating, at least PN 10 (EN 1092-1 drilling).</p>`) +
    section("07", "Ballast", `<div class="table-wrap"><table class="table"><thead><tr><th>Block</th><th class="r">Pieces</th><th class="r">Mass</th><th class="r">Concrete</th><th>Sections</th></tr></thead>
      <tbody>${blRows || empty(5, S.src.blocks ? "No block sections." : "Blocks not included.")}</tbody></table></div>`) +
    section("08", "Equipment", B.pumps ? `<table class="table"><tbody><tr><td>${esc(B.pumps.label)}</td><td class="r"><strong>${B.pumps.duty + B.pumps.standby}</strong></td><td>${B.pumps.duty} duty + ${B.pumps.standby} standby</td></tr></tbody></table>` : `<p class="dim">No pumps included.</p>`);
  const right = `<aside class="in-right"><section class="blueprint in-sec in-results">${corners()}
    <div class="res-head"><h2>Summary</h2><span class="dim">${esc(new Date().toLocaleDateString("en-GB"))}</span></div>
    ${kpiHtml([{ label: "Pipe to order", value: U.fmt("len", B.totals.order, 0), unit: `${L("len")} · ${B.totals.sticks} lengths` },
               { label: "Fittings", value: String(B.totals.fittings), unit: "pieces" },
               { label: "Joints", value: String(B.totals.joints), unit: "fusion / weld / coupling" }])}
    <table class="table res-table"><tbody>
      <tr><td>Pipe net length</td><td class="r">${U.fmt("len", B.totals.net)}</td><td class="u">${L("len")}</td></tr>
      <tr><td>Flange items (stub ends, gaskets, bolt sets)</td><td class="r">${B.flanges.reduce((a, x) => a + x.qty, 0)}</td><td class="u">pcs</td></tr>
      <tr><td>Concrete blocks</td><td class="r">${B.blocks.reduce((a, b) => a + b.pieces, 0)}</td><td class="u">pcs</td></tr>
      <tr><td>Concrete volume</td><td class="r">${U.fmt("vol", B.totals.concrete, 1)}</td><td class="u">${L("vol")}</td></tr>
      <tr><td>Pumps</td><td class="r">${B.pumps ? B.pumps.duty + B.pumps.standby : 0}</td><td class="u">pcs</td></tr>
    </tbody></table>
    <div class="res-checks">${B.warnings.map(w => `<div class="res-check"><span class="tag tag-outline">CHECK</span><span>${esc(w)}</span></div>`).join("")}
      <div class="res-check"><span class="tag tag-neutral">NOTE</span><span>Quantities come from the current Intake, Pipeline design and Supports & buoyancy pages (their saved drafts on this device). Supports, valve actuators and small-bore items are not included.</span></div></div>
  </section></aside>`;
  ROOT.innerHTML = `<div class="in-page"><div class="in-cols"><div class="in-left">${left}</div>${right}</div></div>`;
}

function exportCsv() {
  if (!B) return;
  const { head, rows } = C.csvRows(B);
  RO.csv.download(`bill_of_materials_${new Date().toISOString().slice(0, 10)}.csv`, RO.csv.stringify(head, rows));
}

RO.registerModule({
  id: "bom",
  title: "Bill of materials",
  pageTitle: () => "Bill of materials",
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta; TABS = ctx.tabs; ACTIONS = ctx.actions;
    ROOT.classList.remove("mod-layout"); ROOT.classList.add("mod-scroll");
    META.textContent = "Standalone · Pipes, fittings, joints, flanges and ballast from the design pages";
    ACTIONS.innerHTML = `<button class="btn btn-secondary" data-act="csv">Download CSV</button>`;
    ACTIONS.addEventListener("click", e => { if (e.target.closest('[data-act="csv"]')) exportCsv(); });
    ROOT.addEventListener("change", e => {
      const el = e.target;
      if (el.dataset.src) { S.src[el.dataset.src] = el.checked; savePrefs(); render(); }
      if (el.dataset.key) { const v = U.parse(el.dataset.q, el.value); S[el.dataset.key] = v === null || !isFinite(v) ? null : v; savePrefs(); render(); }
    });
    RO.units.subscribe(() => { if (RO.app.isActive("bom")) render(); });
    RO.values.subscribe(() => { if (RO.app.isActive("bom")) render(); });
    RO.fittings.subscribe(() => { if (RO.app.isActive("bom")) render(); });
    render();
  },
  onShow() { render(); },
  onRoute() { if (ROOT) render(); },
  reset() { S = { src: { intake: true, pipeline: false, blocks: true, pumps: true }, stick_m: null, allowance_pct: null }; savePrefs(); render(); },
  getState: () => ({ state: JSON.parse(JSON.stringify(S)) }),
  setState(st) { if (st && st.state) { S = Object.assign(S, st.state); savePrefs(); render(); } },
  exportMenu: () => [
    { label: "Bill of materials (CSV)", hint: "Every item with size, rating, quantity and source — opens in Excel", run: exportCsv },
    { label: "Print / PDF (A4)", hint: "Use the browser's print dialog → Save as PDF", run: () => window.print() }
  ]
});
})(window.RO = window.RO || {});
