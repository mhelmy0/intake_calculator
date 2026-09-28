/* ============================================================
   Module: Pipeline design (Tools › Pipeline design) — PRD §8A.
   Any single line along a surveyed profile: ground + cover → pipe level,
   segments by chainage, fittings at a chainage or spread per segment.
   Pages: Profile · Segments & fittings · Hydraulics · Pressures & valves ·
          Surge & class · Diameter comparison · Calculation steps
   Layout and REC fields follow the Intake page. Calculations: pipeline_calc.js (SI).
   ============================================================ */
(function (RO) {
"use strict";

const C = RO.pipelineCalc;
const U = RO.units;
const { escHtml: esc } = RO.util;
const DRAFT_KEY = "rocalc.pipeline.draft";

let ROOT = null, META = null, TABS = null, ACTIONS = null;
let S = C.defaultState();
let tab = "profile";
let R = null, F = null;
let fitSel = 0;
let dirty = false, savedAt = null;

const PAGES = [
  { id: "profile", label: "Profile", meta: "Ground, cover and pipe level along the route · hydraulic grade line" },
  { id: "segments", label: "Segments & fittings", meta: "Pipe per chainage range, fittings at a chainage or per segment" },
  { id: "hydraulics", label: "Hydraulics", meta: "Darcy–Weisbach per segment, flow range and quantities" },
  { id: "pressures", label: "Pressures & valves", meta: "Pressure at every point, sub-atmospheric zones, air valves and drains" },
  { id: "surge", label: "Surge & class", meta: "Joukowsky surge and PE pressure class along the line" },
  { id: "compare", label: "Diameter comparison", meta: "The same route with neighbouring pipe sizes" },
  { id: "steps", label: "Calculation steps", meta: "Every formula with its substituted values (SI units)" }
];
const JOINTS = [["butt_fusion", "Butt fusion"], ["electrofusion", "Electrofusion"], ["welded", "Welded"], ["flanged", "Flanged"], ["mechanical", "Mechanical coupling"]];

/* ================= helpers ================= */
const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const section = (num, title, body, extra = "") =>
  `<section class="blueprint in-sec">${corners()}<div class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2>${extra}</div>${body}</section>`;
const blank = C.blank;
function getP(p) { if (p.startsWith("ov:")) return S.overrides[p.slice(3)]; return p.split(".").reduce((a, k) => (a == null ? a : a[k]), S); }
function setP(p, v) {
  if (p.startsWith("ov:")) { S.overrides[p.slice(3)] = v; return; }
  const ks = p.split("."), last = ks.pop(); ks.reduce((a, k) => a[k], S)[last] = v;
}
const mats = () => RO.pipeclass.materials();
const val = k => RO.values.get(k);
const grav = () => S.mode === "gravity";
const isPE = () => !!(mats()[S.line.material] || {}).grade;
const fx = (q, v, d) => U.fmt(q, v, d);
const wu = (q, v, d) => U.withUnit(q, v, d);
const ch = x => `${U.fmt("len", x)} ${U.label("len")}`;

/* ================= field definitions (REC pattern as in Intake) ================= */
function endZrec() {
  try { const X = C.effective(S); if (C.validate(X).length) return null; const g = C.buildGeometry(X); return g.pts[g.pts.length - 1].z; } catch (e) { return null; }
}
function fieldDefs() {
  const T = F && !F.error ? F.T : 25;
  return {
    Qd:    { path: "flow.Q_design", q: "flow", label: "Design flow", req: true, hint: "Total flow through the pipeline" },
    Qmin:  { path: "flow.Q_min", q: "flow", label: "Minimum flow", hint: "For the flow range table" },
    Qmax:  { path: "flow.Q_max", q: "flow", label: "Maximum flow", hint: "For the flow range table" },
    nl:    { path: "flow.nLines", q: "none", label: "Parallel lines", int: true, min: 1, req: true, hint: "Identical lines sharing the flow" },
    sl:    { path: "start.level", q: "elev", label: grav() ? "Upstream water level" : "Suction water level", req: grav() && S.start.type === "level",
             hint: grav() ? "Tank / reservoir / sea level at chainage 0" : "Optional — gives the pump TDH" },
    sp:    { path: "start.pressure", q: "press", label: "Pressure at chainage 0", req: true, hint: "Known gauge pressure at the start" },
    ez:    { path: "end.z", q: "elev", label: "Delivery elevation", rec: endZrec, why: "the pipe level at the last profile point" },
    eres:  { path: "end.residual", q: "press", label: "Residual pressure", rec: () => val("pipeline.residual_bar"), why: "pressure required at the delivery point" },
    elev:  { path: "end.level", q: "elev", label: "Downstream water level", req: true, hint: "Tank / sump / sea level at the end" },
    eps:   { path: "line.eps_mm", q: "rough", label: "Absolute roughness", rec: () => (mats()[S.line.material] || {}).eps, why: "typical for the pipe material" },
    cover: { path: "line.cover", q: "elev", label: "Cover to pipe crown", rec: () => val("pipeline.cover_m"), why: "default for points without their own cover" },
    psi:   { path: "surge.psi", q: "none", label: "Restraint factor ψ", rec: () => val("surge.psi_pe"), why: "PE anchored throughout (1 − μ²)" },
    ksurge:{ path: "surge.k_surge", q: "none", label: "Surge allowance k", hint: "PMA = k × PFA; 1.0 checks against the plain PN" },
    fT:    { path: "surge.fT", q: "none", label: "Temperature derating f_T", rec: () => +RO.pipeclass.deratingPE(T).f.toFixed(3), why: `ISO 4427-1 at ${U.fmt("temp", T)} ${U.label("temp")}` },
    tclose:{ path: "surge.t_close", q: "time", label: "Valve closure time", hint: "Optional — compared with 2ΣL/a" }
  };
}
function critDefs(keys) {
  const out = {};
  const qOf = unit => ({ "m/s": "vel", m: "head", bar: "press" })[unit] || "none";
  keys.forEach(k => {
    const m = RO.values.meta(k) || {};
    out["cr_" + k] = { path: "ov:" + k, q: qOf(m.unit), label: m.label || k, rec: () => val(k), why: (m.source || "recommended").toLowerCase() };
  });
  return out;
}
const critKeys = () => (grav() ? ["velocity.gravity_min", "velocity.gravity_max"] : ["velocity.discharge_min", "velocity.discharge_max"]).concat(["pipeline.min_pressure_bar", "pipeline.bend_min_deg"]);
let DEFS = {};
let shownIds = new Set();

function fieldHtml(id) {
  const d = DEFS[id];
  shownIds.add(id);
  const v = getP(d.path), isBlank = blank(v);
  const rec = d.rec ? d.rec() : null, hasRec = rec !== null && rec !== undefined && isFinite(rec);
  const recTxt = hasRec ? U.fmt(d.q, rec) : "";
  const value = isBlank ? "" : (d.q === "none" || d.int ? String(v) : U.inputValue(d.q, v));
  const bad = !isBlank && (!isFinite(v) || (d.min !== undefined && v < d.min));
  const err = bad ? "Enter a valid number" : (d.req && isBlank ? "Required" : "");
  const unit = d.q === "none" ? "" : U.label(d.q);
  const help = err || (isBlank && hasRec ? `Blank uses ${recTxt}${unit ? " " + unit : ""}, ${d.why}.` : hasRec ? `Recommended ${recTxt}${unit ? " " + unit : ""}. Clear to use it.` : (d.hint || ""));
  const cls = err ? " is-err" : (isBlank && hasRec ? " is-rec" : "");
  return `<div class="field in-field${cls}" data-fwrap="${id}">
    <label for="pl_${id}"><span>${esc(d.label)}</span><span class="unit">${esc(unit)}</span></label>
    <div class="in-wrap"><input class="input" id="pl_${id}" inputmode="decimal" data-fid="${id}" value="${esc(value)}" placeholder="${isBlank && hasRec ? esc(recTxt) : ""}" aria-label="${esc(d.label)}">
      ${isBlank && hasRec ? '<span class="tag tag-accent rec-tag">REC</span>' : ""}</div>
    <div class="in-help">${esc(help)}</div></div>`;
}
const grid = ids => `<div class="in-grid">${ids.map(fieldHtml).join("")}</div>`;
function selectHtml(id, label, path, options, hint) {
  const v = getP(path);
  return `<div class="field in-field in-select"><label for="pls_${id}"><span>${esc(label)}</span></label>
    <select class="input" id="pls_${id}" data-sel="${path}">${options.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
    ${hint ? `<div class="in-help">${esc(hint)}</div>` : ""}</div>`;
}

/* ================= sections ================= */
function secBasis(num) {
  const fl = RO.fluid.get();
  const presets = Object.entries(RO.fluids.PRESETS).map(([k, p]) => [k, p.label]);
  return section(num, "Design basis", `
    <div class="pl-mode seg" role="radiogroup" aria-label="Mode">
      <label class="seg-opt"><input type="radio" name="pl-mode" value="pumped" data-mode${!grav() ? " checked" : ""}>Pumped — required inlet pressure</label>
      <label class="seg-opt"><input type="radio" name="pl-mode" value="gravity" data-mode${grav() ? " checked" : ""}>Gravity — capacity and margin</label>
    </div>
    <div class="in-grid" style="margin-top:16px">
      <div class="field in-field"><label for="pl_name"><span>Line name</span></label><div class="in-wrap"><input class="input" id="pl_name" data-name value="${esc(S.name || "")}"></div><div class="in-help">Used in exports and when sent to Intake</div></div>
      ${fieldHtml("Qd")}${fieldHtml("Qmin")}${fieldHtml("Qmax")}${fieldHtml("nl")}
    </div>
    <div class="in-grid" style="margin-top:16px">
      <div class="field in-field in-select"><label for="pl_fp"><span>Fluid</span></label>
        <select class="input" id="pl_fp" data-fluid="preset">${presets.map(([k, l]) => `<option value="${k}"${k === fl.preset ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <div class="in-help">${fl.preset === "custom" ? "Custom properties are edited in Tools › Fluid properties" : "Shared with every calculator"}</div></div>
      <div class="field in-field"><label for="pl_fT"><span>Temperature</span><span class="unit">${U.label("temp")}</span></label><div class="in-wrap"><input class="input" id="pl_fT" inputmode="decimal" data-fluid="T_C" value="${esc(U.inputValue("temp", fl.T_C))}"></div><div class="in-help"></div></div>
      ${fl.preset !== "custom" ? `<div class="field in-field"><label for="pl_fS"><span>Salinity</span><span class="unit">g/kg</span></label><div class="in-wrap"><input class="input" id="pl_fS" inputmode="decimal" data-fluid="S_gkg" value="${esc(fl.S_gkg ?? "")}"></div><div class="in-help"></div></div>` : ""}
    </div>
    <div class="in-note" data-out="fluidnote"></div>`);
}

function secEnds(num) {
  const startBody = grav()
    ? `${selectHtml("stype", "Start condition", "start.type", [["level", "Upstream water level"], ["pressure", "Known pressure at chainage 0"]])}${grid([S.start.type === "pressure" ? "sp" : "sl"])}`
    : grid(["sl"]);
  const endBody = `${selectHtml("etype", "End condition", "end.type", [["delivery", "Delivery point: elevation + residual pressure"], ["level", "Downstream water level (tank / sump / sea)"]])}
    ${grid(S.end.type === "level" ? ["elev"] : ["ez", "eres"])}`;
  return section(num, "Start & end conditions", `<h3 class="pl-h3">Start · chainage ${esc(ch(+(S.profile[0] || {}).x || 0))}</h3>${startBody}
    <h3 class="pl-h3">End · chainage ${esc(ch(+(S.profile[S.profile.length - 1] || {}).x || 0))}</h3>${endBody}`);
}

function secLine(num) {
  const matOpts = Object.entries(mats()).map(([k, m]) => [k, m.label]);
  return section(num, "Line", `
    <div class="in-grid">
      ${selectHtml("mat", "Pipe material", "line.material", matOpts)}
      ${fieldHtml("eps")}${fieldHtml("cover")}
      ${selectHtml("tr", "Diameter changes", "line.transition", [["gradual", "Gradual reducer / expander"], ["sudden", "Sudden (Borda–Carnot)"], ["none", "Ignore"]])}
    </div>
    <div class="pl-pipes"><div class="pl-pipes-head"><span>Pipe per segment</span><button class="btn btn-secondary btn-sm" data-act="gosegs">Change diameters on Segments &amp; fittings</button></div><ul data-out="pipesum">${pipeSummary()}</ul></div>
    <label class="pl-check"><input type="checkbox" data-submerged${S.line.submerged ? " checked" : ""}>
      <span><strong>Submerged line</strong> — always full (e.g. an intake sea line). No air-valve or drain checks.</span></label>`);
}

function reachLen(k) {
  const a = S.profile[k - 1], b = S.profile[k];
  return a && b && !blank(a.x) && !blank(b.x) && isFinite(a.x) && isFinite(b.x) ? U.inputValue("len", +b.x - +a.x) : "";
}
/** Refresh chainage / length inputs after an edit (never the one being typed in). */
function syncProfileInputs() {
  S.profile.forEach((p, k) => {
    const x = ROOT.querySelector(`[data-prof="${k}:x"]`), l = ROOT.querySelector(`[data-prof="${k}:len"]`);
    if (x && x !== document.activeElement) x.value = blank(p.x) ? "" : U.inputValue("len", p.x);
    if (l && l !== document.activeElement) l.value = reachLen(k);
  });
}
function pipeSummary() {
  if (S.profile.length < 2) return "";
  let ranges = [];
  try { ranges = C.segRanges(S); } catch (e) { return ""; }
  return S.segments.map((sg, i) => {
    const r = ranges[i] || {}, size = sg.custom ? `OD ${sg.od_mm} × ${sg.e_mm} mm` : `OD ${sg.dn} mm · SDR ${sg.sdr}`;
    return `<li><strong>${esc(sg.name)}</strong>: ${esc(size)} <span class="dim">(${isFinite(r.xa) ? U.fmt("len", r.xa) : "?"}–${isFinite(r.xb) ? U.fmt("len", r.xb) : "end"} ${U.label("len")})</span></li>`;
  }).join("");
}
function secProfile(num) {
  const cover0 = C.recOr(S.line.cover, "pipeline.cover_m");
  const rows = S.profile.map((p, k) => `<tr>
      <td class="r dim">${k + 1}</td>
      <td><input class="input w-s" data-prof="${k}:x" value="${esc(blank(p.x) ? "" : U.inputValue("len", p.x))}" aria-label="Chainage point ${k + 1}"></td>
      <td>${k === 0 ? '<span class="dim">start</span>' : `<input class="input w-s" data-prof="${k}:len" value="${esc(reachLen(k))}" aria-label="Length of reach ${k} to ${k + 1}" title="Horizontal length from the previous point — later points move with it">`}</td>
      <td><input class="input w-s" data-prof="${k}:ground" value="${esc(blank(p.ground) ? "" : U.inputValue("elev", p.ground))}" aria-label="Ground level point ${k + 1}"></td>
      <td><input class="input w-s" data-prof="${k}:cover" value="${esc(blank(p.cover) ? "" : U.inputValue("elev", p.cover))}" placeholder="${esc(U.fmt("elev", cover0))}" aria-label="Cover point ${k + 1}"></td>
      <td><input class="input w-s" data-prof="${k}:z" value="${esc(blank(p.z) ? "" : U.inputValue("elev", p.z))}" data-out="prof:${k}:zph" placeholder="auto" aria-label="Pipe level point ${k + 1}"></td>
      <td><input class="input" data-prof="${k}:label" value="${esc(p.label || "")}" aria-label="Label point ${k + 1}"></td>
      <td class="r" data-out="prof:${k}:p">—</td>
      <td class="r nowrap"><button class="icon-btn" data-act="pins" data-k="${k}" title="Insert a point after this one">+</button><button class="icon-btn del" data-act="pdel" data-k="${k}" aria-label="Remove point ${k + 1}">×</button></td></tr>`).join("");
  return section(num, "Elevation profile", `
    <div class="toolbar-row pl-tools">
      <button class="btn btn-secondary btn-sm" data-act="padd">+ Point</button>
      <button class="btn btn-secondary btn-sm" data-act="ppaste">Paste from Excel</button>
      <button class="btn btn-secondary btn-sm" data-act="pimport">Import CSV</button>
      <button class="btn btn-secondary btn-sm" data-act="ptemplate">Download template</button>
      <input type="file" accept=".csv,text/csv" data-act-file="pimport" hidden>
      <span class="dim">Pipe level blank = ground − cover − OD/2 · Length = from the previous point; changing it moves every later point</span></div>
    <div class="table-wrap"><table class="table seg-table pl-prof"><thead><tr><th class="r">#</th><th>Chainage ${U.label("len")}</th><th title="Horizontal length from the previous point">Length ${U.label("len")}</th><th>Ground ${U.label("elev")}</th><th>Cover ${U.label("elev")}</th><th>Pipe level ${U.label("elev")}</th><th>Label</th><th class="r">p ${U.label("press")} g</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="in-note" data-out="proftotal"></div>`);
}

function odOptions(sel) {
  return RO.pipes.ISO_OD_LIST.map(d => `<option value="${d}"${d === +sel ? " selected" : ""}>${U.isImperial() ? `${d} mm (${(d / 25.4).toFixed(1)} in)` : d}</option>`).join("");
}
function secSegments(num) {
  const pe = isPE(), ranges = S.profile.length >= 2 ? C.segRanges(S) : [];
  const rows = S.segments.map((sg, i) => {
    const last = i === S.segments.length - 1;
    const pipe = sg.custom || !pe
      ? `<input class="input w-s" data-seg="${i}:od_mm" value="${esc(U.inputValue("dia", sg.od_mm))}" title="OD (${U.label("dia")})"> × <input class="input w-s" data-seg="${i}:e_mm" value="${esc(U.inputValue("wall", sg.e_mm))}" title="Wall (${U.label("wall")})">`
      : `<select class="input w-od" data-seg="${i}:dn" title="Outer diameter">${odOptions(sg.dn)}</select>
         <select class="input w-sdr" data-seg="${i}:sdr" title="SDR">${RO.pipes.SDR_SERIES.map(s => `<option value="${s}"${s === +sg.sdr ? " selected" : ""}>SDR ${s}</option>`).join("")}</select>`;
    const from = ranges[i] ? U.fmt("len", ranges[i].xa) : "—";
    return `<tr>
      <td><input class="input" data-seg="${i}:name" value="${esc(sg.name)}"></td>
      <td class="r">${from}</td>
      <td>${last ? `<span class="dim">end</span>` : `<input class="input w-s" data-seg="${i}:x1" value="${esc(blank(sg.x1) ? "" : U.inputValue("len", sg.x1))}" aria-label="End chainage">`}</td>
      <td class="pipe">${pipe}${pe ? `<label class="mini"><input type="checkbox" data-seg="${i}:custom"${sg.custom ? " checked" : ""}> custom</label>` : ""}</td>
      <td><select class="input w-joint" data-seg="${i}:joint" aria-label="Joint method">${JOINTS.map(([k, l]) => `<option value="${k}"${k === sg.joint ? " selected" : ""}>${l}</option>`).join("")}</select></td>
      <td class="r" data-out="seg:${i}:La">—</td><td class="r" data-out="seg:${i}:V">—</td><td class="r" data-out="seg:${i}:h">—</td>
      <td class="r"><button class="icon-btn del" data-act="sdel" data-i="${i}" aria-label="Remove ${esc(sg.name)}"${S.segments.length < 2 ? " disabled" : ""}>×</button></td></tr>`;
  }).join("");
  return section(num, "Segments", `
    <div class="seg-side-head"><span class="dim">Contiguous chainage ranges; the last segment runs to the end of the profile.</span>
      <button class="btn btn-secondary btn-sm" data-act="sadd">+ Segment</button></div>
    <div class="table-wrap"><table class="table seg-table"><thead><tr><th>Segment</th><th class="r">From ${U.label("len")}</th><th>To ${U.label("len")}</th><th>Pipe (OD · SDR)</th><th>Joint</th>
      <th class="r">Length ${U.label("len")}</th><th class="r">V ${U.label("vel")}</th><th class="r">h ${U.label("head")}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

function libOptions() {
  const act = RO.fittings.active();
  if (!act) return "";
  const groups = {};
  act.items.filter(it => it.basis !== "formula").forEach(it => (groups[it.category] = groups[it.category] || []).push(it));
  return Object.keys(groups).map(g => `<optgroup label="${esc(g)}">${groups[g].map(it => `<option value="${esc(it.code)}">${esc(it.name)}</option>`).join("")}</optgroup>`).join("");
}
function secFittings(num) {
  if (fitSel >= S.segments.length) fitSel = S.segments.length - 1;
  const sg = S.segments[fitSel], act = RO.fittings.active();
  const rows = sg.fittings.map((f, j) => {
    const item = RO.fittings.resolve(f.code, sg.dn).item;
    const isKv = item && item.basis === "kv";
    return `<tr><td>${esc(item ? item.name : f.code)}${item && item.status === "placeholder" ? ' <span class="tag placeholder">placeholder</span>' : ""}</td>
      <td><input class="input w-k" data-fit="${fitSel}:${j}:x" value="${esc(blank(f.x) ? "" : U.inputValue("len", f.x))}" placeholder="spread" title="Chainage (${U.label("len")}); blank = spread along the segment"></td>
      <td class="r kcell">${isKv
        ? `<input class="input w-k" data-fit="${fitSel}:${j}:kv" value="${esc(blank(f.kv) ? "" : U.inputValue("kv", f.kv))}" placeholder="${U.label("kv")}" title="Manufacturer ${U.label("kv")}">`
        : `<input class="input w-k" data-fit="${fitSel}:${j}:k" value="${esc(blank(f.k) ? "" : f.k)}" placeholder="list" title="Blank = K from the list; type to override" data-out="f${j}:kph">`}</td>
      <td class="c"><span class="stepper"><button data-act="finc" data-j="${j}" aria-label="More">+</button><span>${f.qty}</span><button data-act="fdec" data-j="${j}" aria-label="Fewer">−</button></span></td>
      <td class="r" data-out="f${j}:Kq">—</td>
      <td class="r"><button class="icon-btn del" data-act="fdel" data-j="${j}" aria-label="Remove ${esc(item ? item.name : f.code)}">×</button></td></tr>`;
  }).join("");
  return section(num, "Fittings", `
    <div class="seg-pick" role="tablist">${S.segments.map((x, i) => `<button class="seg-pick-btn${i === fitSel ? " on" : ""}" data-act="fitsel" data-i="${i}">${esc(x.name)}</button>`).join("")}</div>
    <table class="table fit-table"><thead><tr><th>Fitting</th><th>Chainage ${U.label("len")}</th><th class="r">K</th><th class="c" style="width:130px">Qty</th><th class="r">K × qty</th><th style="width:40px"></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="dim">No fittings on this segment.</td></tr>`}
      <tr class="total"><td>Total ΣK</td><td></td><td></td><td></td><td class="r" data-out="sumK">—</td><td></td></tr></tbody></table>
    <div class="field in-field" style="margin-top:14px;max-width:360px"><label>Add from library</label>
      <select class="input" data-act-select="fadd"><option value="">Choose a fitting…</option>${libOptions()}</select></div>
    <p class="dim">A fitting with a chainage is a step in the grade line at that point (and a marker on the profile); without one its loss is spread along the segment.</p>`,
    `<span class="sec-aside">K values from ${esc(act ? act.name + " v" + act.version : "—")}</span>`);
}
function secBends(num) { return section(num, "Suggested bends", `<div data-out="bends"></div>`, `<span class="sec-aside">Where the profile deflects ≥ ${esc(U.fmt("none", C.crit(S, "pipeline.bend_min_deg"), 2))}°</span>`); }
function secCriteria(num) {
  Object.assign(DEFS, critDefs(critKeys()));
  return section(num, "Design criteria", `<p class="dim">Limits used by the checks. Blank uses the recommended value from the library.</p>${grid(critKeys().map(k => "cr_" + k))}`);
}

/* ================= page render ================= */
function renderPage() {
  F = RO.fluid.props();
  DEFS = fieldDefs();
  shownIds = new Set();
  let left = "", right = `<aside class="in-right"><section class="blueprint in-sec in-results">${corners()}<div data-out="results"></div></section></aside>`;
  if (tab === "profile") left = secBasis("01") + secEnds("02") + secLine("03") + secProfile("04");
  if (tab === "segments") left = secSegments("01") + secFittings("02") + secBends("03") + secCriteria("04");
  if (tab === "hydraulics") left = section("01", "Segment hydraulics", `<div class="table-wrap" data-out="hydtable"></div>`) + section("02", "Flow range", `<div class="table-wrap" data-out="rangetable"></div>`) + section("03", "Quantities", `<div class="table-wrap" data-out="qtytable"></div>`, `<span class="sec-aside">Input to the bill of materials (Phase 2)</span>`);
  if (tab === "pressures") left = section("01", "Pressure along the line", `<div class="table-wrap" data-out="sttable"></div>`) + section("02", "Air valves & drains", `<div data-out="valves"></div>`);
  if (tab === "surge") left = section("01", "Settings", grid(["psi", "ksurge", "fT", "tclose"])) + section("02", "Segments", `<div class="table-wrap" data-out="surgetable"></div>`);
  if (tab === "compare") left = section("01", "Diameter comparison", `<div class="table-wrap" data-out="cmptable"></div>`);
  if (tab === "steps") { left = section("01", "Calculation steps", `<div class="steps" id="pl-steps" data-out="steps"></div>`); right = ""; }
  ROOT.innerHTML = `<div class="in-page"><div class="in-cols${right ? "" : " single"}"><div class="in-left">${left}</div>${right}</div></div>`;
  recalc();
}
function renderTabs() {
  TABS.innerHTML = PAGES.map(p => `<button class="tab${p.id === tab ? " active" : ""}" data-tab="${p.id}">${p.label}</button>`).join("");
  TABS.querySelectorAll("button.tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
}
function setTab(t, fromRoute) {
  tab = PAGES.some(p => p.id === t) ? t : "profile";
  renderTabs();
  if (!fromRoute && RO.app.isActive("pipeline")) history.replaceState(null, "", "#/pipeline/" + tab);
  META.textContent = `Standalone · ${PAGES.find(x => x.id === tab).meta}`;
  renderPage();
  RO.app.refresh();
}

/* ================= recalc & outputs ================= */
function put(key, html, isHtml) { const el = ROOT.querySelector(`[data-out="${key}"]`); if (el) { if (isHtml) el.innerHTML = html; else el.textContent = html; } }

function recalc() {
  if (!ROOT) return;
  F = RO.fluid.props();
  R = F.error ? { errors: [F.error] } : C.compute(S, F);
  put("fluidnote", F.error ? F.error : `Fluid: ρ ${U.fmt("dens", F.rho)} ${U.label("dens")} · ν ${(F.nu * 1e6).toFixed(3)} cSt · K ${U.fmt("gpa", F.K / 1e9)} ${U.label("gpa")} · P_v ${U.fmt("kpa", F.Pv / 1000)} ${U.label("kpa")} — shared with every calculator.`);
  const ok = R && !R.errors;
  const box = ROOT.querySelector('[data-out="results"]');
  if (box) box.innerHTML = ok ? (tab === "surge" ? surgeResults() : resultsHtml()) : `<div class="res-head"><h2>Results</h2></div>${checksHtml(R.errors.map(e => ({ status: "fail", text: e })))}`;
  if (ok) updateOuts();
  const errBox = `<p class="dim">${esc(ok ? "" : R.errors.join(" "))}</p>`;
  if (tab === "hydraulics") { put("hydtable", ok ? hydTable() : errBox, true); put("rangetable", ok ? rangeTable() : "", true); put("qtytable", ok ? qtyTable() : "", true); }
  if (tab === "pressures") { put("sttable", ok ? stationTable() : errBox, true); put("valves", ok ? valvesHtml() : "", true); }
  if (tab === "surge") put("surgetable", ok ? surgeTable() : errBox, true);
  if (tab === "compare") put("cmptable", ok ? compareTable() : errBox, true);
  if (tab === "segments") put("bends", ok ? bendsHtml() : "", true);
  if (tab === "steps") { if (ok) RO.util.renderSteps("pl-steps", stepsList()); else put("steps", errBox, true); }
  renderActions();
}

function updateOuts() {
  // profile table: computed pipe level placeholder + pressure
  R.geo.pts.forEach(p => {
    const inp = ROOT.querySelector(`[data-out="prof:${p.k}:zph"]`);
    if (inp) inp.placeholder = U.fmt("elev", p.z);
    const st = R.stations.find(s => Math.abs(s.x - p.x) < 1e-6);
    put(`prof:${p.k}:p`, st ? U.fmt("press", st.p) : "—");
  });
  put("proftotal", `Horizontal length ${ch(R.Lh)} · along the pipe ${ch(R.La)} · pipe level ${wu("elev", Math.min(...R.geo.pts.map(p => p.z)))} to ${wu("elev", Math.max(...R.geo.pts.map(p => p.z)))}`);
  R.segs.forEach(r => {
    put(`seg:${r.i}:La`, U.fmt("len", r.geo.La));
    put(`seg:${r.i}:V`, U.fmt("vel", r.ev.V));
    put(`seg:${r.i}:h`, U.fmt("head", r.ev.h));
  });
  const s = R.segs[fitSel];
  if (s) {
    put("sumK", s.ev.sumK.toFixed(2));
    s.ev.fits.forEach(f => {
      put(`f${f.j}:Kq`, (f.K * f.qty).toFixed(2));
      const el = ROOT.querySelector(`[data-out="f${f.j}:kph"]`);
      if (el && !f.overridden) el.placeholder = f.K.toFixed(3);
    });
  }
}

const kpiHtml = list => `<div class="kpis">${list.map(k => `<div class="kpi"><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v">${esc(k.value)}</div><div class="kpi-u">${esc(k.unit)}</div></div>`).join("")}</div>`;
const row = (label, value, unit, strong) => `<tr${strong ? ' class="strong"' : ""}><td>${esc(label)}</td><td class="r">${esc(value)}</td><td class="u">${esc(unit || "")}</td></tr>`;
const rowQ = (label, q, v, strong) => row(label, U.fmt(q, v), U.label(q), strong);
function checksHtml(list) {
  return `<div class="res-checks">${list.map(c => {
    const tag = c.status === "pass" ? "OK" : c.status === "note" ? "NOTE" : "CHECK";
    const cls = c.status === "pass" ? "tag-accent" : c.status === "note" ? "tag-neutral" : c.status === "warn" ? "tag-outline" : "tag-solid";
    return `<div class="res-check"><span class="tag ${cls}">${tag}</span><span>${esc(c.text)}</span></div>`;
  }).join("")}</div>`;
}
function recCount() {
  let n = 0;
  shownIds.forEach(id => { const d = DEFS[id]; if (d && d.rec && blank(getP(d.path))) n++; });
  return n ? `${n} recommended value${n > 1 ? "s" : ""} in use` : "All values entered";
}
const segName = i => (R.segs[i] ? R.segs[i].name : "");
const listX = xs => xs.map(x => U.fmt("len", x)).join(", ") + " " + U.label("len");

function checkText(c) {
  const P = v => wu("press", v);
  switch (c.key) {
    case "vel": return `${segName(c.seg)}: velocity ${wu("vel", c.V)} ${c.status === "pass" ? "within" : "outside"} ${U.fmt("vel", c.vmin)}–${wu("vel", c.vmax)}.`;
    case "pmin": return c.p < c.Pv_g ? `Lowest pressure ${P(c.p)} g at ${ch(c.x)} is below the vapour pressure — column separation.`
      : c.p < 0 ? `Lowest pressure ${P(c.p)} g at ${ch(c.x)} is sub-atmospheric — the grade line drops below the pipe.`
      : `Lowest pressure ${P(c.p)} g at ${ch(c.x)} ${c.p >= c.lim ? "≥" : "<"} the minimum ${P(c.lim)}.`;
    case "pfa": return `${segName(c.seg)}: max steady / static ${P(c.p)} g ${c.status === "pass" ? "≤" : ">"} PFA ${c.PFA != null ? P(c.PFA) : "—"} (PN ${c.PN ?? "—"} × f_T ${c.fT.toFixed(2)}).`;
    case "pma": return `${segName(c.seg)}: peak with surge ${P(c.p)} g ${c.status === "pass" ? "≤" : ">"} PMA ${c.PMA != null ? P(c.PMA) : "—"} (k ${c.k}).`;
    case "cls-na": return `${segName(c.seg)}: non-PE pipe — check the peak ${P(c.peak)} g against the pipe's own rating.`;
    case "wall": return `${segName(c.seg)}: custom wall is ${c.cat} for the catalogue (nearest SDR ${c.near}).`;
    case "downsurge": return `Downsurge minimum ${P(c.p)} g in ${segName(c.seg)} ${c.p >= 0 ? "stays above atmospheric" : c.p > c.Pv_g ? "is sub-atmospheric" : "reaches the vapour pressure"}.`;
    case "cap": return `Gravity capacity ${wu("flow", c.Qcap)} ${c.status === "pass" ? "≥" : "<"} design flow ${wu("flow", c.Qd)} (margin ${wu("head", c.margin)} at design flow).`;
    case "sub": return "Submerged line — air valves and drains not required.";
    case "av": return c.list.length ? `Air release / vacuum valve at each high point: ${listX(c.list)}.` : "No interior high points — no air valves needed along the line.";
    case "drain": return `Drain / washout at each low point: ${listX(c.list)}.`;
    case "tclose": return `Valve closure ${c.t} s ${c.status === "pass" ? ">" : "≤"} 2ΣL/a = ${c.Tc.toFixed(2)} s${c.status === "pass" ? " — slow closure" : " — full Joukowsky surge"}.`;
    default: return c.text || c.key;
  }
}
const checkList = () => R.checks.map(c => ({ status: c.status, text: checkText(c) })).concat(R.warnings.map(w => ({ status: "note", text: w })));

function profileChart(w = 520, h = 260) {
  const X = v => U.toDisp("len", v), Y = v => U.toDisp("elev", v);
  const st = R.stations;
  const series = [];
  const gpts = R.geo.pts.filter(p => p.ground !== null).map(p => [X(p.x), Y(p.ground)]);
  if (gpts.length > 1) series.push({ pts: gpts, kind: "ground" });
  series.push({ pts: R.geo.pts.map(p => [X(p.x), Y(p.z)]), kind: "pipe" });
  series.push({ pts: st.map(s => [X(s.x), Y(R.HGLstatic)]), kind: "static" });
  series.push({ pts: st.map(s => [X(s.x), Y(s.EGL)]), kind: "egl" });
  series.push({ pts: st.map(s => [X(s.x), Y(s.HGL)]), kind: "sys" });
  const ys = [].concat(...series.map(s => s.pts.map(p => p[1])));
  const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.08 || 1;
  const marks = [];
  R.valves.highs.forEach(p => marks.push({ x: X(p.x), y: Y(p.z), shape: "up", label: "AV" }));
  R.valves.lows.forEach(p => marks.push({ x: X(p.x), y: Y(p.z), shape: "down", label: "D" }));
  st.filter(s => s.kind === "fit-out").forEach(s => marks.push({ x: X(s.x), y: Y(s.z), shape: "dot" }));
  return RO.svgchart.lines({ w, h, xmin: X(R.geo.pts[0].x), xmax: X(R.geo.pts[R.geo.pts.length - 1].x), ymin: lo - pad, ymax: hi + pad, series, marks,
    shade: R.zones.map(z => ({ x0: X(z.x0), x1: X(z.x1) })), label: "Pipeline profile and hydraulic grade line", xTitle: `Chainage (${U.label("len")})`, yTitle: `Level (${U.label("elev")})` });
}
const legend = () => `<figcaption class="legend-row"><span><i class="lg ground"></i>Ground</span><span><i class="lg pipe"></i>Pipe</span><span><i class="lg sys"></i>HGL</span><span><i class="lg egl"></i>EGL</span><span><i class="lg static"></i>Static (no flow)</span>${R.zones.length ? '<span><i class="lg shade"></i>Sub-atmospheric</span>' : ""}${R.valves.highs.length ? "<span>▲ AV air valve</span>" : ""}${R.valves.lows.length ? "<span>▼ D drain</span>" : ""}</figcaption>`;

function resultsHtml() {
  const k = grav()
    ? [{ label: "Margin @ design", value: U.fmt("head", R.margin), unit: U.label("head") },
       { label: "Capacity", value: R.Qcap != null ? U.fmt("flow", R.Qcap) : "—", unit: U.label("flow") + " total" },
       { label: "Losses", value: U.fmt("head", R.hTotal), unit: U.label("head") + ` @ ${U.fmt("flow", +S.flow.Q_design)} ${U.label("flow")}` }]
    : [{ label: "Inlet pressure", value: U.fmt("press", R.Pin), unit: U.label("press") + " g required" },
       { label: R.TDH != null ? "Pump TDH" : "Inlet head", value: U.fmt("head", R.TDH != null ? R.TDH : R.Hin), unit: U.label("head") + (R.TDH != null ? " from suction level" : " HGL at chainage 0") },
       { label: "Losses", value: U.fmt("head", R.hTotal), unit: U.label("head") + ` @ ${U.fmt("flow", +S.flow.Q_design)} ${U.label("flow")}` }];
  const pmaxV = Math.max(R.pmax.p, R.pmax.pStatic);
  return `<div class="res-head"><h2>Results</h2><span class="dim">${esc(recCount())}</span></div>
    ${kpiHtml(k)}
    <figure class="res-chart">${profileChart()}${legend()}</figure>
    <table class="table res-table"><tbody>
      ${row("Pipe", R.segs.map(s => `OD ${s.ev.g.OD}${S.segments[s.i].custom ? "" : " SDR " + S.segments[s.i].sdr}`).filter((v, i, a) => a.indexOf(v) === i).join(" / "), "")}
      ${row("Length — horizontal / along the pipe", `${U.fmt("len", R.Lh)} / ${U.fmt("len", R.La)}`, U.label("len"))}
      ${rowQ("Flow per line", "flow", +S.flow.Q_design / R.nLines)}
      ${rowQ("Friction loss", "head", R.hf)}
      ${rowQ("Fittings + transitions", "head", R.hTotal - R.hf)}
      ${rowQ("Total losses", "head", R.hTotal, true)}
      ${grav() ? rowQ("Available head (start − end)", "head", R.available) : rowQ("Grade line at the end", "elev", R.HGLend)}
      ${grav() ? rowQ("Margin at design flow", "head", R.margin, true) : rowQ("Required head at chainage 0", "elev", R.Hin, true)}
      ${row(`Lowest pressure — at ${ch(R.pmin.x)}`, U.fmt("press", R.pmin.p), U.label("press") + " g")}
      ${row(`Highest pressure, steady or static — at ${ch(R.pmax.x)}`, U.fmt("press", pmaxV), U.label("press") + " g")}
      ${row("Air valves / drains", R.X.line.submerged ? "not required (submerged)" : `${R.valves.highs.length} / ${R.valves.lows.length}`, "")}
    </tbody></table>
    ${checksHtml(checkList())}`;
}

function surgeResults() {
  const u = R.surge;
  const surgeChecks = R.checks.filter(c => ["pfa", "pma", "cls-na", "wall", "downsurge", "tclose"].includes(c.key)).map(c => ({ status: c.status, text: checkText(c) }));
  const X = v => U.toDisp("len", v), P = v => U.toDisp("press", v);
  const st = R.stations;
  const series = [{ pts: st.map(s => [X(s.x), P(s.peak)]), kind: "pumpN" }, { pts: st.map(s => [X(s.x), P(Math.max(s.p, s.pStatic))]), kind: "sys" }, { pts: st.map(s => [X(s.x), P(s.min)]), kind: "sys2" }];
  const ys = [].concat(...series.map(s => s.pts.map(p => p[1])));
  R.segs.forEach(r => { if (r.cls && r.cls.PMA != null) ys.push(P(r.cls.PMA)); });
  const lo = Math.min(0, ...ys), hi = Math.max(...ys) * 1.08;
  const hl = [];
  R.segs.forEach(r => { if (r.cls && r.cls.PMA != null) hl.push({ y: P(r.cls.PMA), label: `PMA ${r.name}`, kind: "line2" }); });
  const chart = RO.svgchart.lines({ w: 520, h: 240, xmin: X(st[0].x), xmax: X(st[st.length - 1].x), ymin: lo, ymax: hi, series, hlines: hl.slice(0, 3), label: "Pressure envelope", xTitle: `Chainage (${U.label("len")})`, yTitle: `Pressure (${U.label("press")} g)` });
  return `<div class="res-head"><h2>Results</h2><span class="dim">Joukowsky screening</span></div>
    ${kpiHtml([
      { label: "Governing surge", value: U.fmt("press", u.dPgov), unit: U.label("press") + " ΔP · " + u.gov.name },
      { label: "Wave speed", value: U.fmt("speed", u.gov.a), unit: U.label("speed") },
      { label: "Critical time", value: u.Tc.toFixed(2), unit: "s, 2ΣL/a" }])}
    <figure class="res-chart">${chart}<figcaption class="legend-row"><span><i class="lg pumpN"></i>Peak</span><span><i class="lg sys"></i>Steady / static</span><span><i class="lg sys2"></i>Minimum</span><span><i class="lg line2"></i>PMA</span></figcaption></figure>
    ${checksHtml(surgeChecks)}`;
}

/* ---------- tables ---------- */
function hydTable() {
  const trs = R.segs.map(r => {
    const s = r.ev, t = R.ev.trans.find(tt => tt.index === r.i);
    return (t ? `<tr class="dim"><td colspan="11">${esc(t.label)} ${esc(t.from)} → ${esc(t.to)}: K ${t.K.toFixed(3)}, h ${wu("head", t.h)}</td></tr>` : "") +
      `<tr><td>${esc(r.name)}</td><td class="r">${U.fmt("dia", s.g.OD, U.isImperial() ? 2 : 0)} × ${U.fmt("wall", s.g.e)}</td><td class="r">${U.fmt("dia", s.g.ID)}</td>
      <td class="r">${U.fmt("len", r.geo.La)}</td><td class="r">${U.fmt("elev", r.geo.dz)}</td><td class="r">${U.fmt("vel", s.V)}</td><td class="r">${Math.round(s.Re).toLocaleString("en-GB")}</td>
      <td class="r">${s.f.toFixed(4)}</td><td class="r">${U.fmt("head", s.hf)}</td><td class="r">${s.sumK.toFixed(2)}</td><td class="r">${U.fmt("head", s.h)}</td></tr>`;
  }).join("");
  return `<table class="table"><thead><tr><th>Segment</th><th class="r">OD × e</th><th class="r">ID</th><th class="r">L along</th><th class="r">Δz</th><th class="r">V</th><th class="r">Re</th><th class="r">f</th><th class="r">h_f</th><th class="r">ΣK</th><th class="r">h</th></tr></thead>
    <tbody>${trs}<tr class="total"><td>Total</td><td></td><td></td><td class="r">${U.fmt("len", R.La)}</td><td class="r">${U.fmt("elev", R.zE - R.z0)}</td><td></td><td></td><td></td><td class="r">${U.fmt("head", R.hf)}</td><td></td><td class="r">${U.fmt("head", R.hTotal)}</td></tr></tbody></table>
    <p class="dim">Sizes in ${U.label("dia")}, lengths ${U.label("len")}, levels ${U.label("elev")}, velocity ${U.label("vel")}, losses ${U.label("head")}. Flow per line ${wu("flow", +S.flow.Q_design / R.nLines)}.</p>`;
}
function rangeTable() {
  if (!R.range.length) return `<p class="dim">Enter flows.</p>`;
  return `<table class="table"><thead><tr><th class="r">Flow</th><th class="r">Max velocity</th><th class="r">Losses</th>${grav() ? `<th class="r">Margin</th>` : `<th class="r">Inlet pressure</th>${R.TDH != null ? `<th class="r">Pump TDH</th>` : ""}`}</tr></thead><tbody>` +
    R.range.map(r => `<tr${r.design ? ' class="hl"' : ""}><td class="r">${wu("flow", r.Q)}</td><td class="r">${wu("vel", r.Vmax)}</td><td class="r">${wu("head", r.h)}</td>
      ${grav() ? `<td class="r">${wu("head", r.margin)}</td>` : `<td class="r">${wu("press", r.Pin)} g</td>${r.TDH != null ? `<td class="r">${wu("head", r.TDH)}</td>` : ""}`}</tr>`).join("") + "</tbody></table>";
}
function qtyTable() {
  const q = R.quantities, n = R.nLines;
  const jl = Object.fromEntries(JOINTS);
  return `<table class="table"><thead><tr><th>Pipe</th><th class="r">Along the pipe</th><th class="r">Horizontal</th><th>Joints</th></tr></thead><tbody>` +
    q.pipes.map(p => `<tr><td>${esc((mats()[p.material] || {}).label || p.material)} · OD ${p.OD}${p.sdr ? ` · SDR ${p.sdr}` : ` × ${p.e.toFixed(1)}`}</td><td class="r">${wu("len", p.La)}</td><td class="r">${wu("len", p.Lh)}</td>
      <td>${Object.keys(p.joints).map(j => esc(jl[j] || j)).join(", ")}</td></tr>`).join("") + "</tbody></table>" +
    `<table class="table" style="margin-top:14px"><thead><tr><th>Fitting</th><th class="r">OD</th><th class="r">Qty</th><th>BOM</th></tr></thead><tbody>` +
    (q.fittings.length ? q.fittings.map(f => `<tr><td>${esc(f.name)} <span class="dim">${esc(f.code)}</span></td><td class="r">${f.OD}</td><td class="r">${f.qty}</td><td>${f.bom ? "counted" : "—"}</td></tr>`).join("") : `<tr><td colspan="4" class="dim">No fittings.</td></tr>`) +
    `</tbody></table><p class="dim">Totals include ${n} parallel line${n > 1 ? "s" : ""}. Sizes in mm.</p>`;
}
function stationTable() {
  const rows = R.stations.filter(s => !(s.fits && s.kind !== "fit-out")).map(s => {
    const sub = s.p < 0;
    const fits = s.fits ? s.fits.map(f => `${f.qty}× ${f.code}`).join(", ") : "";
    return `<tr${sub ? ' class="hl"' : ""}><td class="r">${U.fmt("len", s.x)}</td><td class="r">${s.ground != null ? U.fmt("elev", s.ground) : "—"}</td><td class="r">${U.fmt("elev", s.z)}</td>
      <td class="r">${U.fmt("elev", s.HGL)}</td><td class="r">${U.fmt("elev", s.EGL)}</td><td class="r">${U.fmt("press", s.p)}</td><td class="r">${U.fmt("press", s.pStatic)}</td>
      <td>${esc(segName(s.seg))}</td><td>${esc([s.label, fits].filter(Boolean).join(" · "))}</td></tr>`;
  }).join("");
  return `<table class="table"><thead><tr><th class="r">Chainage</th><th class="r">Ground</th><th class="r">Pipe</th><th class="r">HGL</th><th class="r">EGL</th><th class="r">p steady</th><th class="r">p static</th><th>Segment</th><th>Point</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="dim">Chainage ${U.label("len")}, levels ${U.label("elev")}, pressures ${U.label("press")} g. Highlighted rows are sub-atmospheric. Pressure after a located fitting is shown at its chainage.</p>`;
}
function valvesHtml() {
  if (R.X.line.submerged) return `<p class="dim">Submerged line — always full, so no air valves or drains are required. Turn off “Submerged line” on the Profile page for an onshore line.</p>`;
  const ex = R.extrema;
  if (!ex.highs.length && !ex.lows.length) return `<p class="dim">No interior high or low points along the profile.</p>`;
  const r = (p, what) => { const s = R.stations.find(x => Math.abs(x.x - p.x) < 1e-6); return `<tr><td>${what}</td><td class="r">${U.fmt("len", p.x)}</td><td class="r">${U.fmt("elev", p.z)}</td><td class="r">${s ? U.fmt("press", s.p) : "—"}</td><td class="r">${s ? U.fmt("press", s.pStatic) : "—"}</td><td>${esc(p.label || "")}</td></tr>`; };
  return `<table class="table"><thead><tr><th>Valve</th><th class="r">Chainage ${U.label("len")}</th><th class="r">Pipe level ${U.label("elev")}</th><th class="r">p steady ${U.label("press")} g</th><th class="r">p static</th><th>Point</th></tr></thead><tbody>
    ${ex.highs.map(p => r(p, "Air release / vacuum valve (high point)")).join("")}${ex.lows.map(p => r(p, "Drain / washout (low point)")).join("")}</tbody></table>
    <p class="dim">High and low points are interior local maxima / minima of the pipe level (a flat run counts once).</p>`;
}
function surgeTable() {
  return `<table class="table"><thead><tr><th>Segment</th><th class="r">OD × e</th><th class="r">Class</th><th class="r">PFA / PMA</th><th class="r">a</th><th class="r">V</th><th class="r">ΔP</th><th class="r">Max steady / static</th><th class="r">Peak</th><th class="r">Min</th></tr></thead><tbody>` +
    R.segs.map(r => `<tr${r === R.surge.gov ? ' class="hl"' : ""}><td>${esc(r.name)}</td>
      <td class="r">${U.fmt("dia", r.ev.g.OD, U.isImperial() ? 2 : 0)} × ${U.fmt("wall", r.ev.g.e)}</td>
      <td class="r">${r.cls ? (r.cls.rated ? `SDR ${r.cls.rated} · PN ${r.cls.PN_rated}` : "none") : "non-PE"}</td>
      <td class="r">${r.cls && r.cls.PFA != null ? `${U.fmt("press", r.cls.PFA)} / ${U.fmt("press", r.cls.PMA)}` : "—"}</td>
      <td class="r">${U.fmt("speed", r.a)}</td><td class="r">${U.fmt("vel", r.ev.V)}</td><td class="r">${U.fmt("press", r.dP)}</td>
      <td class="r">${U.fmt("press", r.pSteadyMax)}</td><td class="r">${U.fmt("press", r.peak)}</td><td class="r">${U.fmt("press", r.min)}</td></tr>`).join("") +
    `</tbody></table><p class="dim">Pressures in ${U.label("press")} g, wave speed ${U.label("speed")}, velocity ${U.label("vel")}. Peak = highest steady or static pressure in the segment + governing ΔP; minimum = lowest steady pressure − ΔP.</p>`;
}
function compareTable() {
  const c = R.compare;
  if (!c.rows.length) return `<p class="dim">${esc(c.note || "")}</p>`;
  return `<p class="dim">Every catalogue segment set to the candidate OD (keeping its SDR: ${esc(c.sdrNote)}). Base size from the longest segment, ${esc(c.baseName)}.</p>
    <table class="table"><thead><tr><th class="r">OD</th><th class="r">Max V</th><th class="r">Losses</th>${grav() ? `<th class="r">Margin</th><th class="r">Capacity</th>` : `<th class="r">Inlet pressure</th>`}<th class="r">Max steady</th><th class="r">Peak</th><th class="r">Lowest PN</th><th>Checks</th><th></th></tr></thead><tbody>` +
    c.rows.map(r => r.error ? `<tr><td class="r">${r.od}</td><td colspan="9" class="dim">${esc(r.error)}</td></tr>` :
      `<tr${r.current ? ' class="hl"' : ""}><td class="r">${r.od}${U.isImperial() ? ` <span class="dim">(${(r.od / 25.4).toFixed(1)} in)</span>` : ""}</td><td class="r">${wu("vel", r.Vmax)}</td><td class="r">${wu("head", r.h)}</td>
      ${grav() ? `<td class="r">${wu("head", r.margin)}</td><td class="r">${r.Qcap != null ? wu("flow", r.Qcap) : "—"}</td>` : `<td class="r">${wu("press", r.Pin)} g</td>`}
      <td class="r">${wu("press", r.pmax)} g</td><td class="r">${wu("press", r.peak)} g</td><td class="r">${r.pn != null ? "PN " + r.pn : "—"}</td>
      <td>${r.fails ? `<span class="tag tag-solid">${r.fails} check${r.fails > 1 ? "s" : ""}</span>` : ""} ${r.warns ? `<span class="tag tag-outline">${r.warns} marginal</span>` : ""} ${!r.fails && !r.warns ? '<span class="tag tag-accent">OK</span>' : ""}</td>
      <td class="r">${r.current ? '<span class="dim">current</span>' : `<button class="btn btn-secondary btn-sm" data-act="useod" data-od="${r.od}">Use</button>`}</td></tr>`).join("") + "</tbody></table>";
}
function bendsHtml() {
  if (!R.bends.length) return `<p class="dim">No deflections at or above the threshold.</p>`;
  return `<table class="table"><thead><tr><th class="r">Chainage ${U.label("len")}</th><th class="r">Deflection</th><th>Suggested</th><th>Segment</th><th></th></tr></thead><tbody>` +
    R.bends.map((b, n) => `<tr><td class="r">${U.fmt("len", b.x)}</td><td class="r">${b.deg.toFixed(1)}° ${b.crest ? "crest" : "sag"}</td><td>${esc(b.code)} (${b.std}°)</td><td>${esc(segName(b.seg))}</td>
      <td class="r">${b.already ? '<span class="dim">added</span>' : `<button class="btn btn-secondary btn-sm" data-act="addbend" data-n="${n}">Add</button>`}</td></tr>`).join("") +
    `</tbody></table><p class="dim">PE can often be cold-bent instead (radius ≥ 20–30 × OD); add a bend only where the route needs a fitting.</p>`;
}

function stepsList() {
  const st = [], G = RO.hyd.G, f = (v, d = 3) => (isFinite(v) ? (+v).toFixed(d) : "—");
  const rg = F.rho * G;
  st.push({ head: `Fluid: ${F.label}${F.S != null ? " " + F.S + " g/kg" : ""} @ ${F.T} °C` });
  st.push({ label: "Fluid properties", res: `ρ = ${f(F.rho, 2)} kg/m³ · ν = ${F.nu.toExponential(3)} m²/s · K = ${f(F.K / 1e9, 3)} GPa · Pv = ${f(F.Pv / 1000, 3)} kPa`, note: F.source });
  st.push({ head: "Profile (equations.md §5A)" });
  st.push({ label: "Pipe centreline", eq: "z = ground − cover − OD/2 (typed pipe level overrides)", sub: `default cover ${f(R.geo.cover0, 2)} m`, res: R.geo.pts.map(p => `${f(p.x, 1)}: ${f(p.z, 2)}`).join(" · ") + " m" });
  R.segs.forEach(r => st.push({ label: `${r.name}: ${f(r.geo.xa, 1)}–${f(r.geo.xb, 1)} m`, eq: "L = Σ√(Δx² + Δz²)", sub: `horizontal ${f(r.geo.Lh, 2)} m, Δz = ${f(r.geo.dz, 3)} m`, res: `L = ${f(r.geo.La, 3)} m` }));
  st.push({ head: `Hydraulics @ ${f(+S.flow.Q_design, 1)} m³/h (${R.nLines} line${R.nLines > 1 ? "s" : ""})` });
  R.segs.forEach(r => {
    const s = r.ev, t = R.ev.trans.find(tt => tt.index === r.i);
    if (t) st.push({ label: `${t.label}: ${t.from} → ${t.to}`, eq: t.method, sub: `K = ${f(t.K, 4)}, V = ${f(t.V)} m/s`, res: `h = ${f(t.h, 4)} m` });
    st.push({ label: `${r.name} — OD ${s.g.OD} × ${f(s.g.e, 1)}, ID ${f(s.g.ID, 1)} mm`, eq: "V = Q/A · Re = VD/ν · f (Swamee–Jain) · h = (f·L/D + ΣK)·V²/2g",
      sub: `V = ${f(s.V)} m/s · Re = ${s.Re.toExponential(3)} · f = ${f(s.f, 5)} · ΣK = ${f(s.sumK)}` + (s.fits.length ? ` (${s.fits.map(x => `${x.qty}×${x.code} ${f(x.K)}`).join(", ")})` : ""),
      res: `h_f = ${f(s.hf, 4)} m · h_m = ${f(s.hm, 4)} m · h = ${f(s.h, 4)} m` });
  });
  st.push({ label: "Total losses", res: `Σh = ${f(R.hTotal, 4)} m` });
  st.push({ head: grav() ? "Gravity" : "Required inlet" });
  if (S.end.type === "level") st.push({ label: "End grade line", eq: "HGL_end = downstream water level", res: `= ${f(R.HGLend)} m` });
  else st.push({ label: "End grade line", eq: "HGL_end = z_del + P_res/ρg", sub: `= ${f(blank(S.end.z) ? R.zE : +S.end.z)} + ${f(R.residual, 2)}×10⁵/(${f(rg, 1)})`, res: `= ${f(R.HGLend)} m` });
  if (grav()) {
    st.push({ label: "Start grade line", res: `HGL₀ = ${f(R.HGL0)} m` });
    st.push({ label: "Margin", eq: "margin = (HGL₀ − HGL_end) − Σh", sub: `= ${f(R.available)} − ${f(R.hTotal)}`, res: `= ${f(R.margin)} m` });
    st.push({ label: "Capacity", eq: "Σh(Q) = HGL₀ − HGL_end (bisection)", res: `Q = ${f(R.Qcap, 1)} m³/h` });
  } else {
    st.push({ label: "Required head at chainage 0", eq: "H_in = HGL_end + Σh", sub: `= ${f(R.HGLend)} + ${f(R.hTotal)}`, res: `= ${f(R.Hin)} m` });
    st.push({ label: "Required inlet pressure", eq: "P_in = ρg(H_in − z₀)", sub: `= ${f(rg, 1)} × (${f(R.Hin)} − ${f(R.z0)}) / 10⁵`, res: `= ${f(R.Pin)} bar g` });
    if (R.TDH != null) st.push({ label: "Pump TDH", eq: "TDH = H_in − z_suction water", sub: `= ${f(R.Hin)} − ${f(+S.start.level)}`, res: `= ${f(R.TDH)} m` });
  }
  st.push({ label: "Pressure along the line", eq: "p(x) = ρg(HGL(x) − z(x)); HGL(x) = HGL₀ − h(x)", res: `min ${f(R.pmin.p)} bar g @ ${f(R.pmin.x, 1)} m` });
  st.push({ label: "Static line (no flow)", eq: grav() ? "HGL_static = HGL₀" : "HGL_static = HGL_end", res: `= ${f(R.HGLstatic)} m` });
  const u = R.surge;
  st.push({ head: "Surge (Joukowsky screening, equations.md §5.2)" });
  st.push({ label: `Wave speed — ${u.gov.name}`, eq: "a = √(K/ρ)/√(1 + ψ(K/E)(D/e))", sub: `ψ = ${f(u.psi, 2)}, E = ${f(u.gov.E / 1e9, 2)} GPa, D/e = ${f(u.gov.ev.g.ID / u.gov.ev.g.e, 2)}`, res: `a = ${f(u.gov.a, 1)} m/s` });
  st.push({ label: "Governing surge", eq: "ΔP = ρ·a·V", sub: `= ${f(F.rho, 1)} × ${f(u.gov.a, 1)} × ${f(u.gov.ev.V)}`, res: `= ${f(u.dPgov)} bar` });
  st.push({ label: "Critical closure time", eq: "T_c = 2 Σ L_i/a_i", res: `= ${f(u.Tc, 2)} s` });
  return st;
}

/* ================= header actions ================= */
function renderActions() {
  if (!ACTIONS) return;
  const tagTxt = savedAt ? (dirty ? "Unsaved changes" : "Local draft") : "Not saved";
  ACTIONS.innerHTML = `<span class="tag ${savedAt && !dirty ? "tag-outline" : "tag-neutral"} top-tag">${tagTxt}</span>
    ${savedAt ? `<span class="dim">Saved ${esc(savedAt)} on this device</span>` : ""}
    <button class="btn btn-secondary" data-act="savedraft">Save on this device</button>
    <button class="btn btn-primary blueprint" data-act="send"${R && !R.errors ? "" : " disabled"} title="Copy this line into the Intake route as segments">${corners()}Send to Intake</button>`;
}
function saveDraft() {
  try {
    const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: t, state: S, fluid: RO.fluid.get() }));
    savedAt = t; dirty = false; renderActions();
    RO.ui.toast("Draft saved on this device", "ok");
  } catch (e) { RO.ui.toast("This browser does not allow saving drafts", "error"); }
}
function markDirty() { if (!dirty) { dirty = true; renderActions(); } }

function sendToIntake() {
  if (!R || R.errors) return;
  const side0 = grav() ? "gravity" : "discharge";
  RO.ui.modal({
    title: "Send to Intake",
    body: `<p>Copy <strong>${esc(S.name || "this line")}</strong> (${S.segments.length} segment${S.segments.length > 1 ? "s" : ""}, ${esc(ch(R.La))} along the pipe) into the Intake route.</p>
      <div class="pl-radio">
        <label><input type="radio" name="pl-target" value="discharge"${side0 === "discharge" ? " checked" : ""}> <span><strong>Discharge main</strong> — replaces the transfer main; pump-local piping (per pump) is kept</span></label>
        <label><input type="radio" name="pl-target" value="gravity"${side0 === "gravity" ? " checked" : ""}> <span><strong>Gravity line</strong> — replaces the sea line (sea → sump)</span></label>
      </div>
      <p class="dim">Segments keep their pipe, joint and fittings; the length is the length along the pipe and Δz the level change. The Intake route also keeps this profile for its profile view. Material, roughness and parallel lines are copied; Intake keeps its own flows and water levels.</p>`,
    actions: [
      { label: "Cancel" },
      { label: "Replace the Intake route", primary: true, onClick: (close, back) => {
        const side = back.querySelector('input[name="pl-target"]:checked').value;
        const def = RO.app.ensure("intake");
        if (!def || !def.receiveRoute) { RO.ui.toast("Intake is not available", "error"); close(); return; }
        def.receiveRoute(Object.assign(C.toIntakeRoute(S, R), { side }));
        close();
        location.hash = "#/intake/" + (side === "gravity" ? "gravity" : "sizing");
        RO.ui.toast(`Sent to the Intake ${side === "gravity" ? "gravity line" : "discharge main"}`, "ok");
      } }
    ]
  });
}

/* ================= profile import ================= */
function applyProfile(res, how) {
  if (!res.points.length) { RO.ui.toast(res.errors[0] || "No profile points found", "error", 6000); return false; }
  S.profile = res.points;
  // keep segment ends inside the new profile
  const xe = res.points[res.points.length - 1].x;
  S.segments = S.segments.filter((sg, i) => i === S.segments.length - 1 || (+sg.x1 > res.points[0].x && +sg.x1 < xe));
  markDirty(); renderPage();
  RO.ui.toast(`${res.points.length} profile points ${how}${res.errors.length ? ` · ${res.errors.length} row(s) skipped` : ""}`, res.errors.length ? "warn" : "ok", 5000);
  return true;
}
function pasteDialog() {
  RO.ui.modal({
    title: "Paste profile from Excel", wide: true,
    body: `<p class="dim">Copy the cells from Excel (with or without a header row) and paste them here. Columns without a header: chainage, ground level, cover, pipe level, label — in ${U.isImperial() ? "feet" : "metres"}. A header can name the columns in any order and give units, e.g. “Chainage (m)”, “Ground (ft)”.</p>
      <textarea class="input pl-paste" rows="12" placeholder="0\t4.0\n150\t7.5\n400\t14.0"></textarea>`,
    actions: [{ label: "Cancel" }, { label: "Replace profile", primary: true, onClick: (close, back) => {
      const txt = back.querySelector("textarea").value;
      const rows = txt.split(/\r?\n/).map(l => l.split(/\t|;|,/));
      if (applyProfile(C.parseProfileRows(rows, U.isImperial()), "pasted")) close();
    } }]
  });
}
async function importCsv(file) {
  const text = await file.text();
  applyProfile(C.parseProfileRows(RO.csv.parseRows(text), U.isImperial()), `imported from ${file.name}`);
}
function downloadTemplate() {
  RO.csv.download("pipeline_profile_template.csv", C.profileCsv([
    { x: 0, ground: 4.0, cover: null, z: null, label: "Pump station" }, { x: 150, ground: 7.5, cover: null, z: null, label: "" },
    { x: 400, ground: 14.0, cover: null, z: null, label: "Ridge" }, { x: 900, ground: 8.0, cover: 1.5, z: null, label: "Wadi crossing (extra cover)" },
    { x: 1200, ground: 13.5, cover: null, z: 12.0, label: "Tank (pipe level given)" }]));
}

/* ================= events ================= */
function refreshField(id) {
  const wrap = ROOT.querySelector(`[data-fwrap="${id}"]`);
  if (!wrap) return;
  const tmp = document.createElement("div"); tmp.innerHTML = fieldHtml(id); const nw = tmp.firstElementChild;
  wrap.className = nw.className; wrap.querySelector(".in-help").textContent = nw.querySelector(".in-help").textContent;
  const tagOld = wrap.querySelector(".rec-tag"), tagNew = nw.querySelector(".rec-tag");
  if (tagOld && !tagNew) tagOld.remove(); if (!tagOld && tagNew) wrap.querySelector(".in-wrap").appendChild(tagNew);
  wrap.querySelector("input").placeholder = nw.querySelector("input").placeholder;
}
function onInput(e) {
  const el = e.target;
  if (el.dataset.fid) {
    const d = DEFS[el.dataset.fid];
    let v = el.value.trim() === "" ? null : (d.q === "none" ? Number(el.value.replace(/,/g, "")) : U.parse(d.q, el.value));
    if (v !== null && d.int && isFinite(v)) v = Math.max(d.min ?? 0, Math.round(v));
    setP(d.path, v);
    refreshField(el.dataset.fid);
    markDirty(); recalc(); return;
  }
  if (el.hasAttribute("data-name")) { S.name = el.value; markDirty(); return; }
  if (el.dataset.fluid && el.tagName === "INPUT") {
    const k = el.dataset.fluid, v = k === "T_C" ? U.parse("temp", el.value) : parseFloat(el.value);
    if (v !== null && isFinite(v)) RO.fluid.set({ [k]: v }, "pipeline");
    return;
  }
  if (el.dataset.prof) {
    const [k, f] = el.dataset.prof.split(":"), p = S.profile[+k];
    if (f === "label") p.label = el.value;
    else if (f === "len") { const v = U.parse("len", el.value); if (v !== null && isFinite(v) && v > 0) C.setReachLength(S, +k, v); }
    else { const v = U.parse(f === "x" ? "len" : "elev", el.value); p[f] = v === null ? null : (isFinite(v) ? v : p[f]); }
    if (f === "x" || f === "len") { syncProfileInputs(); put("pipesum", pipeSummary(), true); }
    markDirty(); recalc(); return;
  }
  if (el.dataset.seg && el.tagName === "INPUT" && el.type !== "checkbox") {
    const [i, f] = el.dataset.seg.split(":"), sg = S.segments[+i];
    if (f === "name") sg.name = el.value;
    else { const q = { x1: "len", od_mm: "dia", e_mm: "wall" }[f]; const v = U.parse(q, el.value); if (v === null && f === "x1") sg.x1 = null; else if (v !== null && isFinite(v)) sg[f] = v; }
    markDirty(); recalc(); return;
  }
  if (el.dataset.fit) {
    const [i, j, f] = el.dataset.fit.split(":"), fr = S.segments[+i].fittings[+j];
    fr[f] = el.value.trim() === "" ? null : (f === "kv" ? U.parse("kv", el.value) : f === "x" ? U.parse("len", el.value) : parseFloat(el.value));
    markDirty(); recalc();
  }
}
function onChange(e) {
  const el = e.target;
  if (el.hasAttribute("data-mode")) { S.mode = el.value; if (grav() && S.end.type === "delivery" && blank(S.end.level)) S.end.level = S.end.z; markDirty(); setTab(tab, false); return; }
  if (el.hasAttribute("data-submerged")) { S.line.submerged = el.checked; markDirty(); recalc(); return; }
  if (el.dataset.fluid === "preset") {
    const p = RO.fluids.PRESETS[el.value];
    RO.fluid.set(Object.assign({ preset: el.value }, p && p.S != null ? { S_gkg: p.S } : {}), "pipeline");
    renderPage(); return;
  }
  if (el.dataset.sel) { setP(el.dataset.sel, el.value); markDirty(); renderPage(); return; }
  if (el.dataset.seg && (el.type === "checkbox" || el.tagName === "SELECT")) {
    const [i, f] = el.dataset.seg.split(":"), sg = S.segments[+i];
    if (el.type === "checkbox") sg[f] = el.checked; else sg[f] = f === "joint" ? el.value : +el.value;
    if (f === "dn") sg.od_mm = +el.value;
    if (f === "custom" && sg.custom) { const g = RO.route.geom(Object.assign({}, sg, { custom: false })); sg.od_mm = g.OD; sg.e_mm = g.e; }
    markDirty();
    if (f === "custom") renderPage(); else recalc();
    return;
  }
  if (el.dataset.actSelect === "fadd" && el.value) {
    S.segments[fitSel].fittings.push({ code: el.value, qty: 1, k: null, kv: null, x: null });
    markDirty(); renderPage(); return;
  }
  if (el.dataset.actFile === "pimport" && el.files && el.files[0]) { importCsv(el.files[0]); el.value = ""; }
}
function onClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b || (!ROOT.contains(b) && !ACTIONS.contains(b))) return;
  const a = b.dataset.act;
  if (a === "savedraft") { saveDraft(); return; }
  if (a === "send") { sendToIntake(); return; }
  if (a === "ppaste") { pasteDialog(); return; }
  if (a === "pimport") { ROOT.querySelector('[data-act-file="pimport"]').click(); return; }
  if (a === "ptemplate") { downloadTemplate(); return; }
  if (a === "gosegs") { setTab("segments"); return; }
  const P = S.profile;
  if (a === "padd") { const l = P[P.length - 1]; P.push({ x: l ? +l.x + 100 : 0, ground: l ? l.ground : 0, cover: null, z: null, label: "" }); }
  if (a === "pins") {
    const k = +b.dataset.k, p = P[k], q = P[k + 1];
    P.splice(k + 1, 0, q ? { x: (+p.x + +q.x) / 2, ground: blank(p.ground) || blank(q.ground) ? p.ground : (+p.ground + +q.ground) / 2, cover: null, z: null, label: "" }
                         : { x: +p.x + 100, ground: p.ground, cover: null, z: null, label: "" });
  }
  if (a === "pdel") { if (P.length <= 2) { RO.ui.toast("A profile needs at least two points", "warn"); return; } P.splice(+b.dataset.k, 1); }
  if (a === "sadd") {
    const ranges = C.segRanges(S), last = ranges[ranges.length - 1], prev = S.segments[S.segments.length - 1];
    prev.x1 = +((last.xa + last.xb) / 2).toFixed(1);
    const ns = C.newSegment(prev); ns.name = "Segment " + (S.segments.length + 1);
    S.segments.push(ns);
  }
  if (a === "sdel") { if (S.segments.length > 1) S.segments.splice(+b.dataset.i, 1); }
  if (a === "fitsel") fitSel = +b.dataset.i;
  if (a === "finc" || a === "fdec" || a === "fdel") {
    const fits = S.segments[fitSel].fittings, j = +b.dataset.j;
    if (a === "finc") fits[j].qty = (+fits[j].qty || 0) + 1;
    if (a === "fdec") fits[j].qty = Math.max(0, (+fits[j].qty || 0) - 1);
    if (a === "fdel") fits.splice(j, 1);
  }
  if (a === "addbend") { const bd = R.bends[+b.dataset.n]; S.segments[bd.seg].fittings.push({ code: bd.code, qty: 1, k: null, kv: null, x: bd.x }); }
  if (a === "useod") S.segments.forEach(sg => { if (!sg.custom) { sg.dn = +b.dataset.od; sg.od_mm = +b.dataset.od; } });
  markDirty(); renderPage();
}

/* ================= export / import / state ================= */
function summary() {
  if (!R || R.errors) return {};
  const o = { length_horizontal_m: +R.Lh.toFixed(2), length_along_m: +R.La.toFixed(2), losses_m: +R.hTotal.toFixed(3), min_pressure_bar: +R.pmin.p.toFixed(3), min_pressure_at_m: R.pmin.x,
              surge_dP_bar: +R.surge.dPgov.toFixed(3), air_valves_at_m: R.valves.highs.map(p => p.x), drains_at_m: R.valves.lows.map(p => p.x) };
  if (grav()) Object.assign(o, { available_head_m: +R.available.toFixed(3), margin_m: +R.margin.toFixed(3), capacity_m3h: +R.Qcap.toFixed(1) });
  else Object.assign(o, { required_inlet_pressure_bar: +R.Pin.toFixed(3), required_head_m: +R.Hin.toFixed(3), pump_TDH_m: R.TDH != null ? +R.TDH.toFixed(3) : null });
  return o;
}
const stamp = () => new Date().toISOString().slice(0, 10);
const fileName = ext => `pipeline_${(S.name || "line").replace(/[^\w-]+/g, "_").toLowerCase()}_${stamp()}.${ext}`;
function exportJson() {
  const act = RO.fittings.active();
  const doc = { app: "RO Workbench", module: "pipeline", format: 1, exported_at: new Date().toISOString(), units_shown: U.system(), fluid: RO.fluid.get(), state: S,
    fittings_list: act ? { name: act.name, version: act.version, origin: act.origin } : null, summary: summary(), note: "All state values are SI (m³/h, m, mm, bar, °C)." };
  RO.csv.download(fileName("json"), JSON.stringify(doc, null, 2), "application/json");
}
function exportStations() {
  if (!R || R.errors) { RO.ui.toast("Nothing to export yet", "warn"); return; }
  const rows = R.stations.map(s => [s.x, s.ground ?? "", s.z.toFixed(3), s.HGL.toFixed(3), s.EGL.toFixed(3), s.p.toFixed(3), s.pStatic.toFixed(3), s.peak.toFixed(3), s.min.toFixed(3), segName(s.seg), s.kind, s.label || "", s.fits ? s.fits.map(f => `${f.qty}x${f.code}`).join(" ") : ""]);
  RO.csv.download(fileName("csv").replace(".csv", "_pressures.csv"), RO.csv.stringify(["chainage_m", "ground_m", "pipe_m", "HGL_m", "EGL_m", "p_bar_g", "p_static_bar_g", "p_peak_bar_g", "p_min_bar_g", "segment", "kind", "label", "fittings"], rows));
}
function exportQty() {
  if (!R || R.errors) { RO.ui.toast("Nothing to export yet", "warn"); return; }
  const q = R.quantities;
  const rows = q.pipes.map(p => ["pipe", p.material, p.OD, p.sdr ?? "", p.e.toFixed(1), p.La.toFixed(2), p.Lh.toFixed(2), Object.keys(p.joints).join(" ")])
    .concat(q.fittings.map(f => ["fitting", f.code, f.OD, "", "", f.qty, "", f.bom ? "bom" : ""]));
  RO.csv.download(fileName("csv").replace(".csv", "_quantities.csv"), RO.csv.stringify(["type", "material_or_code", "OD_mm", "SDR", "e_mm", "length_along_m_or_qty", "length_horizontal_m", "joints_or_bom"], rows));
}
function importJson(doc) {
  if (!doc || doc.module !== "pipeline" || !doc.state) throw new Error("Not a pipeline export");
  setState({ state: doc.state, tab });
  if (doc.fluid) RO.fluid.set(doc.fluid, "import");
}
function getState() { return { state: JSON.parse(JSON.stringify(S)), tab }; }
function setState(st) {
  const d = C.defaultState(), s = st && st.state ? st.state : st;
  S = Object.assign(d, JSON.parse(JSON.stringify(s || {})));
  ["flow", "start", "end", "line", "surge"].forEach(k => { S[k] = Object.assign(d[k], s && s[k]); });
  S.overrides = S.overrides || {};
  fitSel = 0;
  if (st && st.tab) tab = st.tab;
  if (ROOT) { renderTabs(); renderPage(); }
}

/* ================= registration ================= */
RO.registerModule({
  id: "pipeline",
  title: "Pipeline design",
  pageTitle: () => "Pipeline " + (PAGES.find(p => p.id === tab) || PAGES[0]).label.toLowerCase(),
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta; TABS = ctx.tabs; ACTIONS = ctx.actions;
    ROOT.classList.remove("mod-layout");
    ROOT.addEventListener("input", onInput);
    ROOT.addEventListener("change", onChange);
    ROOT.addEventListener("click", onClick);
    ACTIONS.addEventListener("click", onClick);
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d && d.state) {
        setState({ state: d.state });
        savedAt = d.savedAt;
        setTimeout(() => RO.ui.toast(`Restored your pipeline draft saved ${d.savedAt} on this device`), 400);
      }
    } catch (e) { /* no draft */ }
    RO.fluid.subscribe((st, source) => { if (ROOT && RO.app.isActive("pipeline")) { if (source === "pipeline") recalc(); else renderPage(); } });
    RO.units.subscribe(() => { if (ROOT) renderPage(); });
    RO.values.subscribe(() => { if (ROOT) renderPage(); });
    RO.fittings.subscribe(() => { if (ROOT) renderPage(); });
    setTab(tab, true);
  },
  onShow() { renderPage(); },
  onRoute(sub) { if (sub && sub !== tab) setTab(sub, true); },
  reset() { savedAt = null; dirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } setState({ state: C.defaultState(), tab }); },
  getState, setState,
  exportMenu: () => [
    { label: "Calculation file (JSON)", hint: "All inputs, fluid and a results summary — re-import it later with Import", run: exportJson },
    { label: "Profile (CSV)", hint: "Chainage, ground, cover, pipe level, label — the import format", run: () => RO.csv.download(fileName("csv").replace(".csv", "_profile.csv"), C.profileCsv(S.profile)) },
    { label: "Pressures along the line (CSV)", hint: "Every point: HGL, EGL, steady / static / surge pressures", run: exportStations },
    { label: "Quantities (CSV)", hint: "Pipe lengths per size and fittings count — input to the bill of materials", run: exportQty },
    { label: "Print / PDF (A4)", hint: "Use the browser's print dialog → Save as PDF", run: () => window.print() }
  ],
  importJson
});
})(window.RO = window.RO || {});
