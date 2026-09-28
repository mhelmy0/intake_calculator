/* ============================================================
   Module: Supports & buoyancy (Design › Supports & buoyancy) — PRD §4 Phase 2,
   equations.md §9 / §9.5. Concrete blocks per pipe section against the
   air-filled uplift (PPI Handbook Ch. 10), port of the legacy Python app
   with its errors corrected. Layout follows the Intake page.
   ============================================================ */
(function (RO) {
"use strict";

const C = RO.buoyancyCalc;
const U = RO.units;
const { escHtml: esc } = RO.util;
const DRAFT_KEY = "rocalc.buoyancy.draft";

let ROOT = null, META = null, TABS = null, ACTIONS = null;
let S = C.defaultState();
let tab = "sections", sel = 0;
let R = null, F = null;
let dirty = false, savedAt = null;

const PAGES = [
  { id: "sections", label: "Sections", meta: "Concrete blocks against the air-filled uplift, PPI Handbook Ch. 10" },
  { id: "steps", label: "Calculation steps", meta: "Every formula with its substituted values (SI units)" }
];

/* ================= helpers ================= */
const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const section = (num, title, body, extra = "") =>
  `<section class="blueprint in-sec">${corners()}<div class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2>${extra}</div>${body}</section>`;
const blank = C.blank;
const wu = (q, v, d) => U.withUnit(q, v, d);
const put = (key, html) => { const el = ROOT.querySelector(`[data-out="${key}"]`); if (el) el.innerHTML = html; };
const kpiHtml = list => `<div class="kpis">${list.map(k => `<div class="kpi"><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v">${esc(k.value)}</div><div class="kpi-u">${esc(k.unit)}</div></div>`).join("")}</div>`;
const row = (label, value, unit, strong) => `<tr${strong ? ' class="strong"' : ""}><td>${esc(label)}</td><td class="r">${esc(value)}</td><td class="u">${esc(unit || "")}</td></tr>`;
function checksHtml(list) {
  return `<div class="res-checks">${list.map(c => {
    const tag = c.status === "pass" ? "OK" : c.status === "note" ? "NOTE" : "CHECK";
    const cls = c.status === "pass" ? "tag-accent" : c.status === "note" ? "tag-neutral" : c.status === "warn" ? "tag-outline" : "tag-solid";
    return `<div class="res-check"><span class="tag ${cls}">${tag}</span><span>${esc(c.text)}</span></div>`;
  }).join("")}</div>`;
}

/* ---------- basis fields (REC pattern) ---------- */
function defs() {
  const P = R ? R.P : C.params(S, F);
  return {
    sf:   { key: "sf_target", q: "none", label: "Target safety factor", rec: () => RO.values.get("buoyancy.sf_min"), why: "team practice, air-filled uplift" },
    rw:   { key: "water_rho", q: "dens", label: "Surrounding water density", rec: () => C.seawaterRho(F), why: `seawater at ${U.fmt("temp", F && F.T != null ? F.T : 25)} ${U.label("temp")} (Sharqawy 2010)` },
    rb:   { key: "concrete_rho", q: "dens", label: "Concrete density", rec: () => RO.values.get("buoyancy.concrete_rho"), why: "reinforced concrete (PPI Ch. 10)" },
    rp:   { key: "pe_rho", q: "dens", label: "PE pipe density", rec: () => RO.values.get("buoyancy.pe_rho"), why: "PE100 (PPI Ch. 10)" },
    wf:   { key: "wall_factor", q: "none", label: "Wall factor for weight", rec: () => RO.values.get("buoyancy.wall_factor"), why: "PPI: ≈ 6 % extra wall" },
    rg:   { key: "growth_rho", q: "dens", label: "Marine growth density", rec: () => RO.values.get("buoyancy.growth_rho"), why: "DNV-RP-C205" },
    _P: P
  };
}
let D = {};
function fieldHtml(id) {
  const d = D[id], v = S[d.key], isBlank = blank(v);
  const rec = d.rec(), recTxt = U.fmt(d.q, rec, d.q === "none" ? 2 : undefined);
  const unit = d.q === "none" ? "" : U.label(d.q);
  const value = isBlank ? "" : (d.q === "none" ? String(v) : U.inputValue(d.q, v));
  const help = isBlank ? `Blank uses ${recTxt}${unit ? " " + unit : ""}, ${d.why}.` : `Recommended ${recTxt}${unit ? " " + unit : ""}. Clear to use it.`;
  return `<div class="field in-field${isBlank ? " is-rec" : ""}" data-fwrap="${id}">
    <label for="by_${id}"><span>${esc(d.label)}</span><span class="unit">${esc(unit)}</span></label>
    <div class="in-wrap"><input class="input" id="by_${id}" inputmode="decimal" data-fid="${id}" value="${esc(value)}" placeholder="${isBlank ? esc(recTxt) : ""}" aria-label="${esc(d.label)}">
      ${isBlank ? '<span class="tag tag-accent rec-tag">REC</span>' : ""}</div>
    <div class="in-help">${esc(help)}</div></div>`;
}

/* ---------- sections ---------- */
function secBasis(num) {
  return section(num, "Basis", `
    <div class="in-grid">${["sf", "rw", "rb", "rp", "wf", "rg"].map(fieldHtml).join("")}</div>
    <div class="field in-field in-select" style="margin-top:16px;max-width:560px"><label for="by_def"><span>Pass / fail criterion</span></label>
      <select class="input" id="by_def" data-basis="sf_def">
        <option value="A"${S.sf_def !== "B" ? " selected" : ""}>A — submerged ballast ÷ net uplift (legacy method)</option>
        <option value="B"${S.sf_def === "B" ? " selected" : ""}>B — (pipe + contents + ballast) ÷ buoyancy</option></select>
      <div class="in-help">Both are shown for every section; the criterion decides OK / CHECK (equations.md §9.5).</div></div>`);
}

function odOptions(v) { return RO.pipes.ISO_OD_LIST.map(d => `<option value="${d}"${d === +v ? " selected" : ""}>${U.isImperial() ? `${d} mm (${(d / 25.4).toFixed(1)} in)` : d}</option>`).join(""); }

function secList(num) {
  const rows = S.sections.map((s, i) => {
    const r = R && R.rows[i];
    const st = r && !r.error ? r.checks.find(c => c.key === "sf").status : "fail";
    return `<tr class="${i === sel ? "hl" : ""}">
      <td><button class="link-btn" data-act="pick" data-i="${i}">${esc(s.name)}</button></td>
      <td class="r">OD ${esc(s.od)}${s.custom ? ` × ${esc(s.e_mm)}` : ` · SDR ${esc(s.sdr)}`}</td>
      <td class="r">${U.fmt("len", +s.L)}</td><td class="r">${s.lines} × ${s.bundle}</td>
      <td class="r">${s.pieces} × ${U.fmt("mass", +s.piece_kg)} @ ${U.fmt("len", +s.spacing, 2)}</td>
      <td class="r">${r && !r.error ? r.SF.toFixed(2) : "—"}</td>
      <td>${r && !r.error ? `<span class="tag ${st === "pass" ? "tag-accent" : "tag-solid"}">${st === "pass" ? "OK" : "CHECK"}</span>` : `<span class="dim">${esc(r ? r.error : "")}</span>`}</td>
      <td class="r"><button class="icon-btn del" data-act="del" data-i="${i}" aria-label="Remove ${esc(s.name)}">×</button></td></tr>`;
  }).join("");
  return section(num, "Sections", `
    <div class="toolbar-row">
      <button class="btn btn-secondary btn-sm" data-act="add">+ Section</button>
      <button class="btn btn-secondary btn-sm" data-act="fromintake">Add from Intake gravity line</button>
      <button class="btn btn-secondary btn-sm" data-act="frompipeline">Add from Pipeline design</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Section</th><th class="r">Pipe</th><th class="r">Length ${U.label("len")}</th><th class="r">Lines × bundle</th>
      <th class="r">Blocks (pieces × ${U.label("mass")} @ ${U.label("len")})</th><th class="r">SF</th><th></th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="dim">No sections yet.</td></tr>`}</tbody></table></div>
    <p class="dim">Lines = separate parallel pipes (each gets its own blocks); bundle = pipes held by the same block.</p>`);
}

function secDetail(num) {
  const s = S.sections[sel];
  if (!s) return "";
  const f = (k, label, q, hint, attrs = "") => `<div class="field in-field"><label for="bs_${k}"><span>${esc(label)}</span><span class="unit">${q ? esc(U.label(q)) : ""}</span></label>
    <div class="in-wrap"><input class="input" id="bs_${k}" inputmode="decimal" data-sec="${k}" data-q="${q || ""}" value="${esc(q ? U.inputValue(q, +s[k]) : s[k])}"${attrs}></div><div class="in-help">${esc(hint || "")}</div></div>`;
  const pipe = s.custom
    ? `${f("od", "Outside diameter", "", "mm")}${f("e_mm", "Wall thickness", "wall", "Custom wall")}`
    : `<div class="field in-field in-select"><label for="bs_od"><span>Outside diameter (mm)</span></label><select class="input" id="bs_od" data-sec="od">${odOptions(s.od)}</select><div class="in-help"></div></div>
       <div class="field in-field in-select"><label for="bs_sdr"><span>SDR</span></label><select class="input" id="bs_sdr" data-sec="sdr">${RO.pipes.SDR_SERIES.map(x => `<option value="${x}"${x === +s.sdr ? " selected" : ""}>SDR ${x}</option>`).join("")}</select><div class="in-help">Catalogue wall (ISO 4427)</div></div>`;
  return section(num, "Section " + (sel + 1) + " · " + s.name, `
    <div class="in-grid">
      <div class="field in-field"><label for="bs_name"><span>Name</span></label><div class="in-wrap"><input class="input" id="bs_name" data-sec="name" value="${esc(s.name)}"></div><div class="in-help">${esc(s.source && s.source !== "manual" ? "From " + s.source.split(":")[0] : "")}</div></div>
      ${pipe}
      ${f("L", "Section length", "len", "Along the pipe")}
      ${f("lines", "Parallel lines", "", "Separate pipes, own blocks")}
      ${f("bundle", "Pipes in bundle", "", "Held by one block")}
      ${f("piece_kg", "Block piece weight (in air)", "mass", "")}
      ${f("pieces", "Pieces per location", "", "2 = sandwich (top + bottom half)")}
      ${f("spacing", "Centre-to-centre spacing", "len", "")}
      <div class="field in-field in-select"><label for="bs_contents"><span>Contents</span></label><select class="input" id="bs_contents" data-sec="contents">
        <option value="air"${s.contents !== "water" ? " selected" : ""}>Air-filled (design case)</option><option value="water"${s.contents === "water" ? " selected" : ""}>Water-filled</option></select><div class="in-help"></div></div>
      ${f("growth_mm", "Marine growth thickness", "wall", "0 = none")}
      <div class="field in-field in-select"><label for="bs_install"><span>Installation (PPI Table 1)</span></label><select class="input" id="bs_install" data-sec="install">
        ${Object.entries(C.INSTALL).map(([k, v]) => `<option value="${k}"${k === s.install ? " selected" : ""}>${esc(v.label)}${v.lo != null ? ` (${v.lo}–${v.hi} %)` : ""}</option>`).join("")}</select><div class="in-help">Reference range for the percent weighting</div></div>
    </div>
    <label class="pl-check"><input type="checkbox" data-sec="custom"${s.custom ? " checked" : ""}><span>Custom pipe (OD × wall instead of the PE catalogue)</span></label>
    <div class="in-suggest" data-out="suggest"></div>`);
}

/* ================= render ================= */
function renderPage() {
  F = RO.fluid.props();
  R = C.compute(S, F);
  D = defs();
  if (sel >= S.sections.length) sel = Math.max(0, S.sections.length - 1);
  let left, right = `<aside class="in-right"><section class="blueprint in-sec in-results">${corners()}<div data-out="results"></div></section></aside>`;
  if (tab === "steps") { left = section("01", "Calculation steps", `<div class="steps" id="by-steps"></div>`); right = ""; }
  else left = secBasis("01") + secList("02") + (S.sections.length ? secDetail("03") : "");
  ROOT.innerHTML = `<div class="in-page"><div class="in-cols${right ? "" : " single"}"><div class="in-left">${left}</div>${right}</div></div>`;
  recalc(true);
}
function recalc(fresh) {
  F = RO.fluid.props();
  R = C.compute(S, F);
  if (!fresh) {                                                     // refresh the overview table in place
    const tb = ROOT.querySelector(".in-left section:nth-child(2) tbody");
    if (tb) { const tmp = document.createElement("div"); tmp.innerHTML = secList("02"); tb.innerHTML = tmp.querySelector("tbody").innerHTML; }
  }
  put("results", resultsHtml());
  const r = R.rows[sel];
  put("suggest", r && !r.error ? `<span class="dim">For SF ${R.P.sf.toFixed(2)} at ${wu("len", +r.sec.spacing, 2)}: <strong>${wu("mass", r.reqLoc)}</strong> per location (${r.sec.pieces} × ${wu("mass", r.reqLoc / r.sec.pieces)}). With ${r.sec.pieces} × ${wu("mass", +r.sec.piece_kg)} the largest spacing is <strong>${isFinite(r.maxSpacing) ? wu("len", r.maxSpacing, 2) : "unlimited"}</strong>.</span>
    <button class="btn btn-secondary btn-sm" data-act="usereq">Use ${esc(wu("mass", Math.ceil(r.reqLoc / r.sec.pieces / 10) * 10))} pieces</button>
    ${isFinite(r.maxSpacing) ? `<button class="btn btn-secondary btn-sm" data-act="usespacing">Use ${esc(wu("len", Math.floor(r.maxSpacing * 10) / 10, 1))} spacing</button>` : ""}` : "");
  if (tab === "steps") RO.util.renderSteps("by-steps", stepsList());
  renderActions();
}

function checkText(c, r) {
  switch (c.key) {
    case "sf": return `${r.sec.name}: SF ${c.SF.toFixed(2)} ${c.status === "pass" ? "≥" : "<"} ${c.target.toFixed(2)} (method ${c.def}; the other method gives ${(c.def === "A" ? r.SF_B : r.SF_A).toFixed(2)}).`;
    case "spacing": return `${r.sec.name}: spacing ${wu("len", c.Ls, 2)} ${c.status === "pass" ? "within" : "outside"} 1–12 × OD (${U.fmt("len", c.lo, 2)}–${wu("len", c.hi, 2)}, PPI Table 2).`;
    case "wpct": return `${r.sec.name}: PPI weighting ${c.Wpct.toFixed(0)} % of the air-filled buoyancy — ${c.within ? "within" : c.Wpct > c.hi ? "above" : "below"} the PPI range ${c.lo}–${c.hi} % for ${c.label.toLowerCase()}${c.Wpct > c.hi ? " (PPI assumes water-filled service; the air-filled SF criterion is more conservative)" : ""}.`;
    case "float": return `${r.sec.name}: weighting above 85 % — a float-and-sink installation needs 15 % reserve buoyancy.`;
    case "sinks": return `${r.sec.name}: the pipe sinks without ballast (no net uplift).`;
    default: return c.key;
  }
}

function resultsHtml() {
  if (!S.sections.length) return `<div class="res-head"><h2>Results</h2></div><p class="dim">Add a section.</p>`;
  const ok = R.rows.filter(r => !r.error);
  const d = v => Math.min(v, 9.99);
  const top = Math.max(R.P.sf * 1.3, ...ok.map(r => d(r.SF))) * 1.1;
  const chart = ok.length ? RO.svgchart.bars({ w: 520, h: 220, ymin: 0, ymax: top, label: "Safety factor per section",
    bars: ok.map(r => ({ label: r.sec.name.length > 16 ? r.sec.name.slice(0, 15) + "…" : r.sec.name, segs: [{ v0: 0, v1: d(r.SF), kind: r.SF >= R.P.sf ? "base" : "short", text: r.SF.toFixed(2) }] })),
    hlines: [{ y: R.P.sf, label: `target ${R.P.sf.toFixed(2)}` }] }) : "";
  const r = R.rows[sel];
  const detail = r && !r.error ? `<table class="table res-table"><tbody>
      ${row(`${r.sec.name} — pipe OD × wall (weight)`, `${r.OD} × ${r.eW.toFixed(1)}`, "mm")}
      ${row("Displaced water W_DW (bundle)", U.fmt("fpm", r.up), U.label("fpm"))}
      ${row("Pipe + contents + growth (bundle)", U.fmt("fpm", r.down), U.label("fpm"))}
      ${row("Net uplift without ballast", U.fmt("fpm", r.uplift), U.label("fpm"), true)}
      ${row(`Ballast, submerged (× ${(r.subF).toFixed(3)})`, U.fmt("fpm", r.Wb), U.label("fpm"))}
      ${row("SF A — ballast ÷ net uplift", r.SF_A.toFixed(2), "", R.P.def === "A")}
      ${row("SF B — total down ÷ buoyancy", r.SF_B.toFixed(2), "", R.P.def === "B")}
      ${row("PPI weighting W%", r.Wpct != null ? r.Wpct.toFixed(0) : "—", "%")}
      ${row("Block locations × lines", `${r.N} × ${r.lines}`, "")}
      ${row("Pieces / total mass", `${r.piecesTotal} / ${U.fmt("mass", r.massTotal)}`, U.label("mass"))}
      ${row("Concrete volume", U.fmt("vol", r.concrete, 2), U.label("vol"))}
    </tbody></table>` : "";
  const checks = [];
  R.errors.forEach(e => checks.push({ status: "fail", text: e }));
  ok.forEach(x => x.checks.forEach(c => checks.push({ status: c.status, text: checkText(c, x) })));
  return `<div class="res-head"><h2>Results</h2><span class="dim">Method ${R.P.def} · ρ_W ${esc(wu("dens", R.P.rhoW))}</span></div>
    ${kpiHtml([
      { label: "Lowest SF", value: R.minSF != null ? R.minSF.toFixed(2) : "—", unit: `target ${R.P.sf.toFixed(2)}` },
      { label: "Blocks", value: R.pieces.toLocaleString("en-GB"), unit: `pieces · ${U.fmt("mass", R.mass / 1000, 1)} t` },
      { label: "Concrete", value: U.fmt("vol", R.concrete, 1), unit: U.label("vol") }])}
    ${chart ? `<figure class="res-chart">${chart}<figcaption class="legend-row"><span><i class="lg base"></i>SF ≥ target</span><span><i class="lg short"></i>Below target</span><span>Safety factor (method ${R.P.def})</span></figcaption></figure>` : ""}
    ${detail}${checksHtml(checks)}`;
}

function stepsList() {
  const st = [], f = (v, d = 3) => (isFinite(v) ? (+v).toFixed(d) : "—"), P = R.P, G = RO.hyd.G;
  st.push({ head: "Basis (equations.md §9, §9.5)" });
  st.push({ label: "Densities", res: `ρ_W = ${f(P.rhoW, 1)} · ρ_B = ${f(P.rhoB, 0)} · ρ_P = ${f(P.rhoP, 0)} · ρ_contents = ${f(P.rhoC, 1)} kg/m³`, note: `wall factor ${f(P.wf, 2)}, target SF ${f(P.sf, 2)} (method ${P.def})` });
  R.rows.forEach(r => {
    if (r.error) { st.push({ head: r.error }); return; }
    st.push({ head: `${r.sec.name} — OD ${r.OD}, ${r.n} pipe${r.n > 1 ? "s" : ""} per block, ${r.lines} line${r.lines > 1 ? "s" : ""}` });
    st.push({ label: "Diameters", eq: "D_I = D_O − 2 × wall factor × e", sub: `= ${r.OD} − 2 × ${f(P.wf, 2)} × ${f(r.e, 2)}`, res: `D_I = ${f(r.Di, 1)} mm` });
    st.push({ label: "Displaced water", eq: "W_DW = ρ_W g π/4 D_O² (+ growth)", res: `${f(r.WDW, 2)} N/m per pipe` });
    st.push({ label: "Pipe and contents", eq: "W_P = ρ_P g π/4 (D_O² − D_I²) · W_C = ρ_C g π/4 D_I²", res: `W_P = ${f(r.WP, 2)} · W_C = ${f(r.WC, 2)} · growth ${f(r.WG, 2)} N/m` });
    st.push({ label: "Ballast per metre", eq: "W_b = m_piece × k × g (1 − ρ_W/ρ_B) / L_s", sub: `= ${r.sec.piece_kg} × ${r.sec.pieces} × ${G} × ${f(r.subF, 4)} / ${r.sec.spacing}`, res: `= ${f(r.Wb, 2)} N/m` });
    st.push({ label: "Safety factors", eq: "SF_A = W_b / (n(W_DW − W_P − W_C)) · SF_B = (n(W_P + W_C) + W_b) / (n W_DW)", res: `SF_A = ${f(r.SF_A, 3)} · SF_B = ${f(r.SF_B, 3)}` });
    st.push({ label: "Required per location", eq: P.def === "A" ? "m = SF · n(W_DW − W_P − W_C) · L_s / (g(1 − ρ_W/ρ_B))" : "m = (SF · nW_DW − n(W_P + W_C)) · L_s / (g(1 − ρ_W/ρ_B))", res: `${f(r.reqLoc, 1)} kg` });
    st.push({ label: "Quantities", eq: "N = ⌈L / L_s⌉ + 1", sub: `N = ⌈${r.sec.L} / ${r.sec.spacing}⌉ + 1 = ${r.N}`, res: `${r.piecesTotal} pieces · ${f(r.massTotal / 1000, 2)} t · ${f(r.concrete, 2)} m³` });
  });
  return st;
}

/* ================= actions / events ================= */
function renderActions() {
  if (!ACTIONS) return;
  const tagTxt = savedAt ? (dirty ? "Unsaved changes" : "Local draft") : "Not saved";
  ACTIONS.innerHTML = `<span class="tag ${savedAt && !dirty ? "tag-outline" : "tag-neutral"} top-tag">${tagTxt}</span>
    ${savedAt ? `<span class="dim">Saved ${esc(savedAt)} on this device</span>` : ""}
    <button class="btn btn-secondary" data-act="savedraft">Save on this device</button>
    <a class="btn btn-secondary" href="#/bom">Bill of materials</a>`;
}
function saveDraft() {
  try {
    const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: t, state: S }));
    savedAt = t; dirty = false; renderActions(); RO.ui.toast("Draft saved on this device", "ok");
  } catch (e) { RO.ui.toast("This browser does not allow saving drafts", "error"); }
}
const markDirty = () => { if (!dirty) { dirty = true; renderActions(); } };

function importFrom(kind) {
  let segs = [], lines = 1, prefix = "";
  if (kind === "intake") {
    const def = RO.app.ensure("intake");
    const I = RO.bomCalc.fromIntake(def.getState().state);
    segs = I.segs.filter(s => /gravity/.test(s.source));
    if (!segs.length) { RO.ui.toast("The Intake arrangement has no gravity line", "warn"); return; }
    prefix = "Intake";
  } else {
    const def = RO.app.ensure("pipeline");
    const P = RO.bomCalc.fromPipeline(def.getState().state);
    if (P.error) { RO.ui.toast("Pipeline design: " + P.error, "error"); return; }
    segs = P.segs; prefix = P.name || "Pipeline";
    if (!P.submerged) RO.ui.toast("That pipeline is not marked Submerged — check it really needs ballast", "warn", 5000);
  }
  const added = segs.map(s => C.newSection({ name: `${prefix} · ${s.name}`, source: s.source, od: s.OD, sdr: s.sdr || 17, custom: s.custom, e_mm: +s.e.toFixed(1), L: +s.L.toFixed(1), lines: s.mult }));
  S.sections.push(...added);
  sel = S.sections.length - added.length;
  markDirty(); renderPage();
  RO.ui.toast(`${added.length} section${added.length > 1 ? "s" : ""} added — enter the block weight and spacing`, "ok");
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.fid) {
    const d = D[el.dataset.fid];
    S[d.key] = el.value.trim() === "" ? null : (d.q === "none" ? Number(el.value.replace(/,/g, "")) : U.parse(d.q, el.value));
    const wrap = ROOT.querySelector(`[data-fwrap="${el.dataset.fid}"]`);
    if (wrap) { const tmp = document.createElement("div"); tmp.innerHTML = fieldHtml(el.dataset.fid); const nw = tmp.firstElementChild;
      wrap.className = nw.className; wrap.querySelector(".in-help").textContent = nw.querySelector(".in-help").textContent; el.placeholder = nw.querySelector("input").placeholder;
      const a = wrap.querySelector(".rec-tag"), b = nw.querySelector(".rec-tag"); if (a && !b) a.remove(); if (!a && b) wrap.querySelector(".in-wrap").appendChild(b); }
    markDirty(); recalc(); return;
  }
  if (el.dataset.sec && el.tagName === "INPUT" && el.type !== "checkbox") {
    const s = S.sections[sel], k = el.dataset.sec;
    if (k === "name") s.name = el.value;
    else { const v = el.dataset.q ? U.parse(el.dataset.q, el.value) : Number(el.value.replace(/,/g, "")); if (v !== null && isFinite(v)) s[k] = v; }
    markDirty(); recalc();
  }
}
function onChange(e) {
  const el = e.target;
  if (el.dataset.basis) { S[el.dataset.basis] = el.value; markDirty(); renderPage(); return; }
  if (el.dataset.sec && (el.tagName === "SELECT" || el.type === "checkbox")) {
    const s = S.sections[sel], k = el.dataset.sec;
    if (el.type === "checkbox") { s[k] = el.checked; if (k === "custom" && el.checked) s.e_mm = +RO.pipes.catalogueWall(+s.od, +s.sdr).e.toFixed(1); }
    else s[k] = k === "contents" || k === "install" ? el.value : +el.value;
    markDirty(); renderPage();
  }
}
function onClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b || (!ROOT.contains(b) && !ACTIONS.contains(b))) return;
  const a = b.dataset.act;
  if (a === "savedraft") { saveDraft(); return; }
  if (a === "fromintake") { importFrom("intake"); return; }
  if (a === "frompipeline") { importFrom("pipeline"); return; }
  if (a === "pick") sel = +b.dataset.i;
  if (a === "add") { const p = S.sections[S.sections.length - 1]; S.sections.push(C.newSection(p ? Object.assign({}, p, { name: "Section " + (S.sections.length + 1), source: "manual" }) : {})); sel = S.sections.length - 1; }
  if (a === "del") { S.sections.splice(+b.dataset.i, 1); if (sel >= S.sections.length) sel = S.sections.length - 1; }
  const r = R && R.rows[sel];
  if (a === "usereq" && r && !r.error) S.sections[sel].piece_kg = Math.ceil(r.reqLoc / r.sec.pieces / 10) * 10;
  if (a === "usespacing" && r && !r.error) S.sections[sel].spacing = Math.floor(r.maxSpacing * 10) / 10;
  markDirty(); renderPage();
}

/* ================= tabs / state / registration ================= */
function renderTabs() {
  TABS.innerHTML = PAGES.map(p => `<button class="tab${p.id === tab ? " active" : ""}" data-tab="${p.id}">${p.label}</button>`).join("");
  TABS.querySelectorAll("button.tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
}
function setTab(t, fromRoute) {
  tab = PAGES.some(p => p.id === t) ? t : "sections";
  renderTabs();
  if (!fromRoute && RO.app.isActive("buoyancy")) history.replaceState(null, "", "#/buoyancy/" + tab);
  META.textContent = "Standalone · " + PAGES.find(p => p.id === tab).meta;
  renderPage();
  RO.app.refresh();
}
function getState() { return { state: JSON.parse(JSON.stringify(S)), tab }; }
function setState(st) {
  const d = C.defaultState(), s = st && st.state ? st.state : st;
  S = Object.assign(d, JSON.parse(JSON.stringify(s || {})));
  S.sections = (S.sections || []).map(x => C.newSection(x));
  sel = 0;
  if (ROOT) renderPage();
}
function exportCsv() {
  const rows = R.rows.filter(r => !r.error).map(r => [r.sec.name, r.OD, r.sec.custom ? "" : r.sec.sdr, r.e.toFixed(2), r.sec.L, r.lines, r.n, r.sec.contents, r.sec.piece_kg, r.sec.pieces, r.sec.spacing,
    r.up.toFixed(2), r.down.toFixed(2), r.uplift.toFixed(2), r.Wb.toFixed(2), r.SF_A.toFixed(3), r.SF_B.toFixed(3), r.Wpct != null ? r.Wpct.toFixed(1) : "", r.reqLoc.toFixed(1), r.N, r.piecesTotal, r.massTotal.toFixed(0), r.concrete.toFixed(3)]);
  RO.csv.download(`supports_buoyancy_${new Date().toISOString().slice(0, 10)}.csv`, RO.csv.stringify(["section", "OD_mm", "SDR", "e_mm", "L_m", "lines", "pipes_in_bundle", "contents", "piece_kg", "pieces_per_location", "spacing_m",
    "W_DW_N_m", "down_N_m", "net_uplift_N_m", "ballast_sub_N_m", "SF_A", "SF_B", "PPI_weighting_pct", "required_kg_per_location", "locations_per_line", "pieces_total", "mass_total_kg", "concrete_m3"], rows));
}

RO.registerModule({
  id: "buoyancy",
  title: "Supports & buoyancy",
  pageTitle: () => (tab === "steps" ? "Buoyancy calculation steps" : "Supports & buoyancy"),
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta; TABS = ctx.tabs; ACTIONS = ctx.actions;
    ROOT.classList.remove("mod-layout"); ROOT.classList.add("mod-scroll");
    ROOT.addEventListener("input", onInput); ROOT.addEventListener("change", onChange); ROOT.addEventListener("click", onClick);
    ACTIONS.addEventListener("click", onClick);
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); if (d && d.state) { setState({ state: d.state }); savedAt = d.savedAt; } } catch (e) { /* no draft */ }
    RO.units.subscribe(() => { if (ROOT) renderPage(); });
    RO.values.subscribe(() => { if (ROOT) renderPage(); });
    RO.fluid.subscribe(() => { if (ROOT && RO.app.isActive("buoyancy")) renderPage(); });
    setTab(tab, true);
  },
  onShow() { renderPage(); },
  onRoute(sub) { if (sub && sub !== tab) setTab(sub, true); },
  reset() { savedAt = null; dirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } setState({ state: C.defaultState() }); },
  getState, setState,
  compute: () => C.compute(S, RO.fluid.props()),
  exportMenu: () => [
    { label: "Calculation file (JSON)", hint: "All sections and settings — re-import it later with Import", run: () => RO.csv.download(`supports_buoyancy_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "RO Workbench", module: "buoyancy", format: 1, exported_at: new Date().toISOString(), state: S, note: "SI: mm, m, kg, kg/m³" }, null, 2), "application/json") },
    { label: "Section results (CSV)", hint: "Forces, safety factors, required block mass and quantities per section", run: exportCsv },
    { label: "Print / PDF (A4)", hint: "Use the browser's print dialog → Save as PDF", run: () => window.print() }
  ],
  importJson(doc) { if (!doc || doc.module !== "buoyancy" || !doc.state) throw new Error("Not a supports & buoyancy export"); setState({ state: doc.state }); markDirty(); }
});
})(window.RO = window.RO || {});
