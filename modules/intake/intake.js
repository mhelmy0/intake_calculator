/* ============================================================
   Module: Intake (Design › Intake) — rebuilt on the Claude Design
   "RO Shell" Intake page: numbered blueprint sections on the left, a
   sticky Results column on the right (KPI strip, chart, result rows,
   OK / CHECK / NOTE checks). Recommended values: blank field = REC.
   Pages: Pump sizing · Gravity line · Pump selection · Surge & class · Calculation steps
   Calculations: intake_calc.js (SI). Display units: RO.units (SI / Imperial).
   ============================================================ */
(function (RO) {
"use strict";

const C = RO.intakeCalc;
const U = RO.units;
const { escHtml: esc } = RO.util;
const api = RO.api;
const DRAFT_KEY = "rocalc.intake.draft";

let ROOT = null, META = null, TABS = null, ACTIONS = null;
let S = C.defaultState();
let tab = "sizing";
let R = null, F = null;
let pumpCache = {};
let fitSel = { sizing: null, gravity: null };
let rankCache = null;
let dirty = false, savedAt = null;

const PAGES = [
  { id: "sizing", label: "Pump sizing", need: "pumps", meta: "Pressure drop and pump power, Darcy–Weisbach" },
  { id: "gravity", label: "Gravity line", need: "gravity", meta: "Head budget, submergence and sump, Darcy–Weisbach" },
  { id: "selection", label: "Pump selection", need: "pumps", meta: "Vendor pump curves against the system curve" },
  { id: "surge", label: "Surge & class", meta: "Joukowsky surge and PE pressure class per segment" },
  { id: "steps", label: "Calculation steps", meta: "Every formula with its substituted values (SI units)" }
];
const SIDE_LABEL = { gravity: "Gravity line · sea → sump", suction: "Suction · source → each pump", discharge: "Discharge · pumps → delivery" };

/* ================= helpers ================= */
const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const section = (num, title, body, extra = "") =>
  `<section class="blueprint in-sec">${corners()}<div class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2>${extra}</div>${body}</section>`;
const blank = v => v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));
function getP(p) { if (p.startsWith("ov:")) return S.overrides[p.slice(3)]; return p.split(".").reduce((a, k) => (a == null ? a : a[k]), S); }
function setP(p, v) {
  if (p.startsWith("ov:")) { S.overrides[p.slice(3)] = v; return; }
  const ks = p.split("."), last = ks.pop(); ks.reduce((a, k) => a[k], S)[last] = v;
}
const mats = () => RO.pipeclass.materials();
const val = k => RO.values.get(k);
const hasG = () => C.hasGravity(S), hasP = () => C.hasPumps(S);
const pageAllowed = id => { const p = PAGES.find(x => x.id === id); return p && (!p.need || (p.need === "gravity" ? hasG() : hasP())); };

/* ================= field definitions ================= */
const srcLabels = () => (S.arrangement === "pumps_only" ? ["Lowest tide (LAT)", "Highest tide (HAT)"] : ["Sump low level", "Sump high level"]);
const srcPaths = () => (S.arrangement === "pumps_only" ? ["levels.LAT", "levels.HAT"] : ["levels.sump_min", "levels.sump_max"]);

function fieldDefs() {
  const [lo, hi] = srcLabels(), [plo, phi] = srcPaths();
  const T = C.recOr(S.feed.T, "feed.temp_C");
  return {
    Qd:     { path: "flow.Q_design", q: "flow", label: "Design flow", req: true, hint: "Total intake flow to pretreatment" },
    Qmin:   { path: "flow.Q_min", q: "flow", label: "Minimum flow", hint: "Lowest operating flow — sediment check through one line", req: hasG() },
    T:      { path: "feed.T", q: "temp", label: "Feed temperature", rec: () => val("feed.temp_C"), why: "design seawater temperature" },
    tds:    { path: "feed.tds", q: "tds", label: "Feed TDS", rec: () => val("feed.tds_mgL"), why: "Arabian Gulf seawater" },
    eps:    { path: "line.eps_mm", q: "rough", label: "Absolute roughness", rec: () => (mats()[S.line.material] || {}).eps, why: "typical for the pipe material" },
    geps:   { path: "gline.eps_mm", q: "rough", label: "Absolute roughness", rec: () => (mats()[S.gline.material] || {}).eps, why: "typical for the pipe material" },
    glines: { path: "routes.gravity.nLines", q: "none", label: "Parallel lines", int: true, min: 1, req: true, hint: "Identical lines sharing the flow" },
    dlines: { path: "routes.discharge.nLines", q: "none", label: "Parallel discharge mains", int: true, min: 1, req: true, hint: "Common mains after the pump manifold" },
    srcLo:  { path: plo, q: "elev", label: lo, req: true, hint: S.arrangement === "pumps_only" ? "Worst suction case" : "Design low water level in the sump" },
    srcHi:  { path: phi, q: "elev", label: hi, req: true, hint: "Lowest static head — runout check" },
    zp:     { path: "station.z_pump", q: "elev", label: "Pump centreline elevation", req: true, hint: "Impeller eye; sets NPSH available" },
    zd:     { path: "station.z_delivery", q: "elev", label: "Delivery elevation", req: true, hint: "Inlet of the pretreatment / filters" },
    resid:  { path: "sizing.residual", q: "press", label: "Residual pressure", rec: () => val("delivery.residual_bar"), why: "pressure at the filter inlet" },
    margin: { path: "sizing.margin", q: "pct", label: "Head margin", rec: () => val("pump.head_margin_pct"), why: "design allowance" },
    peff:   { path: "sizing.eff_pump", q: "pct", label: "Pump efficiency", rec: () => val("pump.eff_pct"), why: "split-case pump at BEP (a selected pump's η overrides it)" },
    meff:   { path: "sizing.eff_motor", q: "pct", label: "Motor efficiency", rec: () => val("motor.eff_pct"), why: "IE3 motor" },
    nduty:  { path: "station.n_duty", q: "none", label: "Duty pumps", int: true, min: 1, req: true, hint: "Pumps running at design flow" },
    nsb:    { path: "station.n_standby", q: "none", label: "Standby pumps", int: true, min: 0, hint: "Installed spares" },
    psrc:   { path: "station.P_source", q: "press", label: "Source surface pressure", hint: "0 for an open sump or the sea" },
    LAT:    { path: "levels.LAT", q: "elev", label: "Lowest tide (LAT)", req: true, hint: "Chart datum / MSL — same datum for every level" },
    HAT:    { path: "levels.HAT", q: "elev", label: "Highest tide (HAT)", req: true, hint: "Reverse-flow check" },
    seabed: { path: "levels.seabed", q: "elev", label: "Seabed at intake", hint: "For reference / drawings" },
    crown:  { path: "levels.inlet_crown", q: "elev", label: "Inlet pipe crown", req: true, hint: "Top of the intake pipe at the inlet — vortex submergence check" },
    smin:   { path: "levels.sump_min", q: "elev", label: "Sump low level", req: true, hint: "Design level the gravity line must reach at LAT" },
    smax:   { path: "levels.sump_max", q: "elev", label: "Sump high level", req: hasP(), hint: "At most HAT" },
    ret:    { path: "station.retention_s", q: "time", label: "Sump retention time", hint: "Sump volume = Q × t" },
    psi:    { path: "surge.psi", q: "none", label: "Restraint factor ψ", rec: () => val("surge.psi_pe"), why: "PE anchored throughout (1 − μ²)" },
    ksurge: { path: "surge.k_surge", q: "none", label: "Surge allowance k", hint: "PMA = k × PFA; 1.0 checks against the plain PN" },
    fT:     { path: "surge.fT", q: "none", label: "Temperature derating f_T", rec: () => +RO.pipeclass.deratingPE(T).f.toFixed(3), why: `ISO 4427-1 at ${U.fmt("temp", T)} ${U.label("temp")}` },
    tclose: { path: "surge.t_close", q: "time", label: "Valve closure time", hint: "Optional — compared with 2ΣL/a" }
  };
}
function critDefs(keys) {
  const out = {};
  const qOf = unit => ({ "m/s": "vel", m: "head", "—": "none", "× BEP": "none" })[unit] || "none";
  keys.forEach(k => {
    const m = RO.values.meta(k) || {};
    out["cr_" + k] = { path: "ov:" + k, q: qOf(m.unit), label: m.label || k, rec: () => val(k), why: (m.source || "recommended").toLowerCase() };
  });
  return out;
}
const CRIT_SIZING = ["velocity.suction_min", "velocity.suction_max", "velocity.discharge_min", "velocity.discharge_max", "velocity.size_target", "pump.motor_margin"];
const CRIT_GRAVITY = ["intake.head_margin_m", "velocity.gravity_min", "velocity.gravity_max", "velocity.sediment_min", "submergence.hi_coeff"];
const CRIT_SELECTION = ["pump.por_min", "pump.por_max", "pump.npsh_margin_m", "pump.npsh_ratio", "pump.motor_margin"];
let DEFS = {};
let shownIds = new Set();   // fields rendered on the current page (for the REC count)

function fieldHtml(id) {
  const d = DEFS[id];
  shownIds.add(id);
  const v = getP(d.path), isBlank = blank(v);
  const rec = d.rec ? d.rec() : null, hasRec = rec !== null && rec !== undefined;
  const recTxt = hasRec ? U.fmt(d.q, rec, d.q === "none" ? undefined : undefined) : "";
  const value = isBlank ? "" : (d.q === "none" || d.int ? String(v) : U.inputValue(d.q, v));
  const bad = !isBlank && (!isFinite(v) || (d.min !== undefined && v < d.min));
  const err = bad ? "Enter a valid number" : (d.req && isBlank ? "Required" : "");
  const unit = U.label(d.q);
  const help = err || (isBlank && hasRec ? `Blank uses ${recTxt}${unit ? " " + unit : ""}, ${d.why}.` : hasRec ? `Recommended ${recTxt}${unit ? " " + unit : ""}. Clear to use it.` : (d.hint || ""));
  const cls = err ? " is-err" : (isBlank && hasRec ? " is-rec" : "");
  return `<div class="field in-field${cls}" data-fwrap="${id}">
    <label for="f_${id}"><span>${esc(d.label)}</span><span class="unit">${esc(unit)}</span></label>
    <div class="in-wrap"><input class="input" id="f_${id}" inputmode="decimal" data-fid="${id}" value="${esc(value)}" placeholder="${isBlank && hasRec ? esc(recTxt) : ""}" aria-label="${esc(d.label)}">
      ${isBlank && hasRec ? '<span class="tag tag-accent rec-tag">REC</span>' : ""}</div>
    <div class="in-help">${esc(help)}</div></div>`;
}
const grid = ids => `<div class="in-grid">${ids.map(fieldHtml).join("")}</div>`;

function selectHtml(id, label, path, options, hint) {
  const v = getP(path);
  return `<div class="field in-field in-select"><label for="s_${id}"><span>${esc(label)}</span></label>
    <select class="input" id="s_${id}" data-sel="${path}">${options.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
    ${hint ? `<div class="in-help">${esc(hint)}</div>` : ""}</div>`;
}

/* ================= sections ================= */
function secBasis(num) {
  return section(num, "Design basis", `
    ${selectHtml("arr", "Intake arrangement", "arrangement", [["gravity_pumps", "Gravity line to sump + pump station"], ["pumps_only", "Pumps at sea (no gravity line)"], ["gravity_only", "Gravity line only"]])}
    ${grid(["Qd", "Qmin", "T", "tds"])}
    <div class="in-note" data-out="fluidnote"></div>`);
}

function odOptions(sel) {
  return RO.pipes.ISO_OD_LIST.map(d => `<option value="${d}"${d === +sel ? " selected" : ""}>${U.isImperial() ? `${d} mm (${(d / 25.4).toFixed(1)} in)` : d}</option>`).join("");
}

function segTable(side) {
  const sd = S.routes[side];
  const isPE = !!(mats()[side === "gravity" ? S.gline.material : S.line.material] || {}).grade;
  const rows = sd.segments.map((sg, i) => {
    const pipe = sg.custom || !isPE
      ? `<input class="input w-s" data-seg="${side}:${i}:od_mm" value="${esc(U.inputValue("dia", sg.od_mm))}" title="OD (${U.label("dia")})"> × <input class="input w-s" data-seg="${side}:${i}:e_mm" value="${esc(U.inputValue("wall", sg.e_mm))}" title="Wall (${U.label("wall")})">`
      : `<select class="input w-od" data-seg="${side}:${i}:dn" title="Outer diameter">${odOptions(sg.dn)}</select>
         <select class="input w-sdr" data-seg="${side}:${i}:sdr" title="SDR">${RO.pipes.SDR_SERIES.map(s => `<option value="${s}"${s === +sg.sdr ? " selected" : ""}>SDR ${s}</option>`).join("")}</select>`;
    return `<tr data-row="${side}:${i}">
      <td><input class="input" data-seg="${side}:${i}:name" value="${esc(sg.name)}"></td>
      <td class="pipe">${pipe}${isPE ? `<label class="mini"><input type="checkbox" data-seg="${side}:${i}:custom"${sg.custom ? " checked" : ""}> custom</label>` : ""}
        <button class="rec-od" data-act="recod" data-side="${side}" data-i="${i}" data-out="${side}:${i}:rec" hidden></button></td>
      <td><input class="input w-s" data-seg="${side}:${i}:L_m" value="${esc(U.inputValue("len", sg.L_m))}"></td>
      <td><input class="input w-s" data-seg="${side}:${i}:dz_m" value="${esc(U.inputValue("elev", sg.dz_m))}"></td>
      ${side === "discharge" ? `<td class="c"><input type="checkbox" data-seg="${side}:${i}:perPump"${sg.perPump ? " checked" : ""} title="Pump-local piping: carries Q ÷ duty pumps"></td>` : ""}
      <td class="r" data-out="${side}:${i}:V">—</td><td class="r" data-out="${side}:${i}:h">—</td>
      <td class="r nowrap"><button class="icon-btn" data-act="up" data-side="${side}" data-i="${i}" title="Move up">↑</button><button class="icon-btn" data-act="down" data-side="${side}" data-i="${i}" title="Move down">↓</button><button class="icon-btn del" data-act="del" data-side="${side}" data-i="${i}" title="Remove" aria-label="Remove ${esc(sg.name)}">×</button></td>
    </tr>`;
  }).join("");
  return `<div class="seg-side">
    <div class="seg-side-head"><h3>${SIDE_LABEL[side]}</h3><span class="dim" data-out="${side}:total"></span>
      <button class="btn btn-secondary btn-sm" data-act="addseg" data-side="${side}">+ Segment</button></div>
    ${sd.segments.length ? `<div class="table-wrap"><table class="table seg-table"><thead><tr><th>Segment</th><th>Pipe (OD · SDR)</th><th>Length ${U.label("len")}</th><th>Δz ${U.label("elev")}</th>
      ${side === "discharge" ? "<th>Per pump</th>" : ""}<th class="r">V ${U.label("vel")}</th><th class="r">h ${U.label("head")}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="dim">${side === "suction" ? "No suction piping (typical for submersible pumps)." : "No segments yet."}</p>`}
    ${profileView(side)}
  </div>`;
}

/* Profile view for a route received from Tools › Pipeline design (display only). */
function profileView(side) {
  const pr = S.routes[side].profile;
  if (!pr || !pr.pts || pr.pts.length < 2) return "";
  const X = v => U.toDisp("len", v), Y = v => U.toDisp("elev", v);
  const series = [];
  const g = pr.pts.filter(p => p[2] !== null && p[2] !== undefined).map(p => [X(p[0]), Y(p[2])]);
  if (g.length > 1) series.push({ pts: g, kind: "ground" });
  series.push({ pts: pr.pts.map(p => [X(p[0]), Y(p[1])]), kind: "pipe" });
  const ys = [].concat(...series.map(s => s.pts.map(q => q[1]))), lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.1 || 1;
  const chart = RO.svgchart.lines({ w: 620, h: 170, xmin: X(pr.pts[0][0]), xmax: X(pr.pts[pr.pts.length - 1][0]), ymin: lo - pad, ymax: hi + pad, series,
    marks: (pr.bounds || []).map(x => ({ x: X(x), y: Y(pr.pts.reduce((a, q) => (Math.abs(q[0] - x) < Math.abs(a[0] - x) ? q : a))[1]), shape: "dot" })),
    label: "Route profile", xTitle: `Chainage (${U.label("len")})`, yTitle: `Level (${U.label("elev")})` });
  return `<figure class="in-profile">${chart}<figcaption class="legend-row"><span><i class="lg ground"></i>Ground</span><span><i class="lg pipe"></i>Pipe</span>
    <span class="dim">Profile of “${esc(pr.name || "pipeline")}” from Tools › Pipeline design — edit it there and send again.</span>
    <button class="btn btn-secondary btn-sm" data-act="rmprof" data-side="${side}">Remove profile</button></figcaption></figure>`;
}

function secLine(num) {
  const matOpts = Object.entries(mats()).map(([k, m]) => [k, m.label]);
  return section(num, "Intake line", `
    <div class="in-grid">
      ${selectHtml("mat", "Pipe material", "line.material", matOpts)}
      ${fieldHtml("eps")}
      ${selectHtml("tr", "Diameter changes", "routes.discharge.transition", [["gradual", "Gradual reducer / expander"], ["sudden", "Sudden (Borda–Carnot)"], ["none", "Ignore"]])}
      ${fieldHtml("dlines")}
    </div>
    ${segTable("suction")}${segTable("discharge")}`);
}

function secGravityLine(num) {
  const matOpts = Object.entries(mats()).map(([k, m]) => [k, m.label]);
  return section(num, "Gravity line", `
    <div class="in-grid">
      ${selectHtml("gmat", "Pipe material", "gline.material", matOpts)}
      ${fieldHtml("geps")}
      ${selectHtml("gtr", "Diameter changes", "routes.gravity.transition", [["gradual", "Gradual reducer / expander"], ["sudden", "Sudden (Borda–Carnot)"], ["none", "Ignore"]])}
      ${fieldHtml("glines")}
    </div>
    ${segTable("gravity")}
    <div class="in-suggest" data-out="gsuggest"></div>`);
}

function secPump(num) {
  return section(num, "Pump and delivery", grid(["srcLo", "srcHi", "zp", "zd", "resid", "margin", "peff", "meff", "nduty", "nsb", "psrc"]));
}
function secLevels(num) {
  return section(num, "Water levels & sump", grid(["LAT", "HAT", "seabed", "crown", "smin", ...(hasP() ? ["smax"] : []), "ret"]));
}

function fitTargets(page) {
  const sides = page === "gravity" ? ["gravity"] : ["suction", "discharge"];
  const out = [];
  sides.forEach(sd => S.routes[sd].segments.forEach((sg, i) => out.push({ key: `${sd}:${i}`, side: sd, i, label: (sides.length > 1 ? (sd === "suction" ? "Suction · " : "Discharge · ") : "") + sg.name })));
  return out;
}
function libOptions() {
  const act = RO.fittings.active();
  if (!act) return "";
  const groups = {};
  act.items.filter(it => it.basis !== "formula").forEach(it => (groups[it.category] = groups[it.category] || []).push(it));
  return Object.keys(groups).map(g => `<optgroup label="${esc(g)}">${groups[g].map(it => `<option value="${esc(it.code)}">${esc(it.name)}</option>`).join("")}</optgroup>`).join("");
}
function secFittings(num, page) {
  const targets = fitTargets(page);
  if (!targets.length) return section(num, "Fittings", `<p class="dim">Add a segment first.</p>`);
  if (!targets.some(t => t.key === fitSel[page])) fitSel[page] = targets[targets.length - 1].key;
  const t = targets.find(x => x.key === fitSel[page]);
  const sg = S.routes[t.side].segments[t.i];
  const act = RO.fittings.active();
  const rows = sg.fittings.map((f, j) => {
    const item = RO.fittings.resolve(f.code, sg.dn).item;
    const isKv = item && item.basis === "kv";
    return `<tr><td>${esc(item ? item.name : f.code)}${item && item.status === "placeholder" ? ' <span class="tag placeholder">placeholder</span>' : ""}</td>
      <td class="r kcell">${isKv
        ? `<input class="input w-k" data-fit="${t.key}:${j}:kv" value="${esc(blank(f.kv) ? "" : U.inputValue("kv", f.kv))}" placeholder="${U.label("kv")}" title="Manufacturer ${U.label("kv")}">`
        : `<input class="input w-k" data-fit="${t.key}:${j}:k" value="${esc(blank(f.k) ? "" : f.k)}" placeholder="list" title="Blank = K from the list; type to override" data-out="${t.key}:f${j}:kph">`}</td>
      <td class="c"><span class="stepper"><button data-act="fdec" data-key="${t.key}" data-j="${j}" aria-label="Fewer">−</button><span>${f.qty}</span><button data-act="finc" data-key="${t.key}" data-j="${j}" aria-label="More">+</button></span></td>
      <td class="r" data-out="${t.key}:f${j}:Kq">—</td>
      <td class="r"><button class="icon-btn del" data-act="fdel" data-key="${t.key}" data-j="${j}" aria-label="Remove ${esc(item ? item.name : f.code)}">×</button></td></tr>`;
  }).join("");
  return section(num, "Fittings", `
    <div class="seg-pick" role="tablist">${targets.map(x => `<button class="seg-pick-btn${x.key === t.key ? " on" : ""}" data-act="fitsel" data-page="${page}" data-key="${x.key}">${esc(x.label)}</button>`).join("")}</div>
    <table class="table fit-table"><thead><tr><th>Fitting</th><th class="r">K</th><th class="c" style="width:130px">Qty</th><th class="r">K × qty</th><th style="width:40px"></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="dim">No fittings on this segment.</td></tr>`}
      <tr class="total"><td>Total ΣK</td><td></td><td></td><td class="r" data-out="${t.key}:sumK">—</td><td></td></tr></tbody></table>
    <div class="field in-field" style="margin-top:14px;max-width:360px"><label>Add from library</label>
      <select class="input" data-act-select="fadd" data-key="${t.key}"><option value="">Choose a fitting…</option>${libOptions()}</select></div>`,
    `<span class="sec-aside">K values from ${esc(act ? act.name + " v" + act.version : "—")}</span>`);
}

function secCriteria(num, keys) {
  Object.assign(DEFS, critDefs(keys));
  return section(num, "Design criteria", `<p class="dim">Limits used by the checks. Blank uses the recommended value from the library; typed values are flagged “(user)”.</p>${grid(keys.map(k => "cr_" + k))}`);
}

function secPump1(num) {
  return section(num, "Pump", `
    <div class="toolbar-row"><select class="input grow" data-act-select="pickpump" id="p-pick"></select>
      <button class="btn btn-secondary btn-sm" data-act="newpump">+ Pump</button>
      <button class="btn btn-secondary btn-sm" data-act="examplepump">Example pump</button></div>
    <div data-out="pumpinfo"></div>`);
}
function secSearch(num) {
  return section(num, "Search the pump library", `
    <div class="toolbar-row"><button class="btn btn-secondary btn-sm" data-act="rank">Search library</button><span class="dim" data-out="rankhint">Smallest number of duty pumps meeting the design flow, then lowest power.</span></div>
    <div class="table-wrap" data-out="ranktable"></div>`);
}
function secSurgeSettings(num) {
  return section(num, "Line & settings", `
    ${selectHtml("sside", "Line to check", "surge.side", [...(hasP() ? [["discharge", "Discharge (pumped)"]] : []), ...(hasG() ? [["gravity", "Gravity line"]] : [])])}
    ${grid(["psi", "ksurge", "fT", "tclose"])}`);
}

/* ================= page render ================= */
function renderPage() {
  if (!pageAllowed(tab)) tab = hasP() ? "sizing" : "gravity";
  DEFS = fieldDefs();
  shownIds = new Set();
  let left = "", right = `<aside class="in-right"><section class="blueprint in-sec in-results">${corners()}<div data-out="results"></div></section></aside>`;
  if (tab === "sizing") left = secBasis("01") + secLine("02") + secPump("03") + secFittings("04", "sizing") + secCriteria("05", CRIT_SIZING);
  if (tab === "gravity") left = secBasis("01") + secLevels("02") + secGravityLine("03") + secFittings("04", "gravity") + secCriteria("05", CRIT_GRAVITY);
  if (tab === "selection") left = secPump1("01") + section("02", "Duty & standby", grid(["nduty", "nsb"])) + secSearch("03") + secCriteria("04", CRIT_SELECTION);
  if (tab === "surge") left = secSurgeSettings("01") + section("02", "Segments", `<div class="table-wrap" data-out="surgetable"></div>`);
  if (tab === "steps") { left = section("01", "Calculation steps", `<div class="steps" data-out="steps"></div>`); right = ""; }
  ROOT.innerHTML = `<div class="in-page"><div class="in-cols${right ? "" : " single"}"><div class="in-left">${left}</div>${right}</div></div>`;
  if (tab === "selection") renderPumpPicker();
  recalc();
}

function renderTabs() {
  TABS.innerHTML = PAGES.filter(p => pageAllowed(p.id)).map(p => `<button class="tab${p.id === tab ? " active" : ""}" data-tab="${p.id}">${p.label}</button>`).join("");
  TABS.querySelectorAll("button.tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
}
function setTab(t, fromRoute) {
  tab = pageAllowed(t) ? t : (hasP() ? "sizing" : "gravity");
  renderTabs();
  if (!fromRoute && RO.app.isActive("intake")) history.replaceState(null, "", "#/intake/" + tab);
  const p = PAGES.find(x => x.id === tab);
  META.textContent = `Standalone · ${p.meta}`;
  renderPage();
  RO.app.refresh();
}

/* ================= recalc & results ================= */
function missing() {
  const req = [["flow.Q_design", "design flow"]];
  if (hasG()) req.push(["flow.Q_min", "minimum flow"], ["levels.LAT", "LAT"], ["levels.HAT", "HAT"], ["levels.sump_min", "sump low level"], ["levels.inlet_crown", "inlet crown"]);
  if (hasP()) req.push([srcPaths()[0], srcLabels()[0].toLowerCase()], [srcPaths()[1], srcLabels()[1].toLowerCase()], ["station.z_pump", "pump elevation"], ["station.z_delivery", "delivery elevation"], ["station.n_duty", "duty pumps"]);
  return req.filter(([p]) => blank(getP(p)) || !isFinite(getP(p))).map(r => r[1]);
}

function recalc() {
  if (!ROOT) return;
  F = RO.fluid.props();
  const miss = missing();
  const pump = S.selection.pumpId ? pumpCache[S.selection.pumpId] : null;
  R = miss.length || F.error ? null : C.compute(S, F, pump);
  put("fluidnote", F.error ? F.error : `Fluid: ρ ${U.fmt("dens", F.rho)} ${U.label("dens")} · ν ${(F.nu * 1e6).toFixed(3)} cSt · K ${U.fmt("gpa", F.K / 1e9)} ${U.label("gpa")} (Sharqawy 2010) — shared with every calculator.`);
  updateRouteOuts();
  const box = ROOT.querySelector('[data-out="results"]');
  if (box) box.innerHTML = !R ? `<div class="res-head"><h2>Results</h2></div><p class="dim">Enter ${esc((miss.length ? miss : [F.error || "valid values"]).join(", "))} to calculate.</p>` : resultsHtml();
  if (tab === "surge") put("surgetable", R ? surgeTableHtml() : "", true);
  if (tab === "steps") { const el = ROOT.querySelector('[data-out="steps"]'); if (el) { if (R) RO.util.renderSteps(el.id || (el.id = "in-steps"), stepsList()); else el.innerHTML = `<p class="dim">Enter ${esc(miss.join(", "))} to calculate.</p>`; } }
  if (tab === "selection") renderPumpInfo();
  if (tab === "gravity") renderSuggestion();
  renderActions();
}
function put(key, html, isHtml) { const el = ROOT.querySelector(`[data-out="${key}"]`); if (el) { if (isHtml) el.innerHTML = html; else el.textContent = html; } }

function updateRouteOuts() {
  if (!R) return;
  const ev = { gravity: R.gravity && R.gravity.ev, suction: R.station && R.station.evS, discharge: R.station && R.station.evD };
  const target = C.recOr(S.overrides["velocity.size_target"], "velocity.size_target");
  Object.keys(ev).forEach(side => {
    const e = ev[side];
    if (!e || !e.segs) return;
    e.segs.forEach((s, i) => {
      put(`${side}:${i}:V`, s.error ? "err" : U.fmt("vel", s.V));
      put(`${side}:${i}:h`, s.error ? "" : U.fmt("head", s.h));
      put(`${side}:${i}:sumK`, s.error ? "" : s.sumK.toFixed(2));
      if (!s.error) {
        s.fits.forEach(fx => put(`${side}:${i}:f${fx.j}:Kq`, (fx.K * fx.qty).toFixed(2)));
        const kin = ROOT.querySelectorAll(`[data-out^="${side}:${i}:f"][data-out$=":kph"]`);
        kin.forEach(el => { const j = +el.dataset.out.split(":")[2].slice(1); const fx = s.fits.find(x => x.j === j); if (fx && !fx.overridden) el.placeholder = fx.K.toFixed(3); });
        const rb = ROOT.querySelector(`[data-out="${side}:${i}:rec"]`);
        if (rb) {
          const rec = side === "gravity" ? null : C.recOD(R.S.routes[side].segments[i], s.Q, target);
          rb.hidden = !rec || rec === +S.routes[side].segments[i].dn;
          if (rec) { rb.textContent = `REC ${rec}`; rb.dataset.od = rec; rb.title = `Recommended OD ${rec} mm — smallest size with V ≤ ${U.fmt("vel", target)} ${U.label("vel")}`; }
        }
      }
    });
    if (e.segs.length) put(`${side}:total`, `${U.fmt("flow", e.Qline * 3600)} ${U.label("flow")} per line · ${U.fmt("len", e.L)} ${U.label("len")} · ${U.fmt("head", e.h)} ${U.label("head")} losses`);
  });
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
/* checks from intake_calc ({name, desc, val, status}) → sentence form */
const toText = cs => cs.map(c => ({ status: c.status, text: `${c.name}: ${c.val}${c.desc ? " (" + c.desc + ")" : ""}.` }));

function resultsHtml() {
  if (tab === "sizing") return sizingResults();
  if (tab === "gravity") return gravityResults();
  if (tab === "selection") return selectionResults();
  if (tab === "surge") return surgeResults();
  return "";
}

function recCount() {
  let n = 0;
  shownIds.forEach(id => { const d = DEFS[id]; if (d && d.rec && blank(getP(d.path))) n++; });
  return n ? `${n} recommended value${n > 1 ? "s" : ""} in use` : "All values entered";
}

function curvePts(fn, xmax, n = 40) { const out = []; for (let i = 0; i <= n; i++) { const q = xmax * i / n; out.push([U.toDisp("flow", q), U.toDisp("head", fn(q))]); } return out; }

function sizingResults() {
  const st = R.station, sz = R.sizing;
  if (!st || st.errors) return `<div class="res-head"><h2>Results</h2></div>${checksHtml((st ? st.errors : ["Pump station not applicable"]).map(e => ({ status: "fail", text: e })))}`;
  const imp = U.isImperial();
  const motorTxt = sz.motor ? (imp ? (sz.motor * 1.341022).toFixed(0) : String(sz.motor)) : "—";
  const Qd = S.flow.Q_design, sel = R.selection && R.selection.pf ? R.selection : null;
  const xmax = Math.max(Qd * 1.5, sel ? sel.pf.Qmax * sel.n : 0);
  const series = [{ pts: curvePts(st.sysH(st.lv.min), xmax), kind: "sys" }, { pts: curvePts(st.sysH(st.lv.max), xmax), kind: "sys2" }];
  let pumpLabel = "Indicative pump curve";
  if (sel) { series.push({ pts: curvePts(q => sel.pf.head(q / sel.n), sel.pf.Qmax * sel.n), kind: "pumpN" }); pumpLabel = `${sel.pump.vendor} ${sel.pump.model} × ${sel.n}`; }
  else { const H0 = sz.H * 1.32, kp = (H0 - sz.H) / (Qd * Qd); series.push({ pts: curvePts(q => H0 - kp * q * q, xmax), kind: "pump" }); }
  const ymax = Math.max(...series.map(s => Math.max(...s.pts.map(p => p[1])))) * 1.08;
  const chart = RO.svgchart.lines({ w: 520, h: 240, xmax: U.toDisp("flow", xmax), ymin: 0, ymax, series,
    points: [{ x: U.toDisp("flow", Qd), y: U.toDisp("head", sz.H), label: `Duty ${U.fmt("flow", Qd)} ${U.label("flow")} · ${U.fmt("head", sz.H)} ${U.label("head")}` }], label: "System curve and pump curve" });
  const checks = [];
  const smin = C.crit(R.S, "velocity.suction_min"), smax = C.crit(R.S, "velocity.suction_max"), dmin = C.crit(R.S, "velocity.discharge_min"), dmax = C.crit(R.S, "velocity.discharge_max");
  st.evS.segs.forEach(s => { const ok = s.V >= smin && s.V <= smax; checks.push({ status: ok ? "pass" : (s.V > smax ? "fail" : "warn"), text: `Suction velocity ${U.fmt("vel", s.V)} ${U.label("vel")} in ${s.seg.name} is ${ok ? "within" : "outside"} ${U.fmt("vel", smin)}–${U.fmt("vel", smax)} ${U.label("vel")}.` }); });
  st.evD.segs.forEach(s => { const ok = s.V >= dmin && s.V <= dmax; checks.push({ status: ok ? "pass" : (s.V > dmax ? "fail" : "warn"), text: `Line velocity ${U.fmt("vel", s.V)} ${U.label("vel")} in ${s.seg.name} is ${ok ? "within" : "outside"} ${U.fmt("vel", dmin)}–${U.fmt("vel", dmax)} ${U.label("vel")}.` }); });
  if (sz.motor) checks.push({ status: sz.load <= 1 / sz.motorMargin ? "pass" : "fail", text: `Motor loaded to ${(sz.load * 100).toFixed(0)} % of nameplate at duty (limit ${(100 / sz.motorMargin).toFixed(0)} %).` });
  checks.push({ status: st.NPSHa > 0 ? "note" : "fail", text: `NPSH available ${U.fmt("head", st.NPSHa)} ${U.label("head")} at the sump low level — compare with the pump's NPSHr on Pump selection.` });
  checks.push({ status: st.minP >= 0 ? "pass" : "warn", text: `Lowest pressure along the discharge ${U.fmt("head", st.minP)} ${U.label("head")} ${st.minP >= 0 ? "stays above atmospheric" : "is sub-atmospheric"}.` });
  checks.push({ status: "note", text: `Fluid density ${U.fmt("dens", F.rho)} ${U.label("dens")} from temperature and TDS.` });
  [...new Set(st.warnings)].forEach(w => checks.push({ status: "note", text: w }));
  return `<div class="res-head"><h2>Results</h2><span class="dim">${esc(recCount())}</span></div>
    ${kpiHtml([
      { label: "Total head", value: U.fmt("head", sz.H), unit: U.label("head") + " TDH" },
      { label: "Motor input", value: U.fmt("power", sz.Pin), unit: U.label("power") + " electrical" + (sz.n > 1 ? `, ${sz.n} pumps` : "") },
      { label: "Motor size", value: (sz.n > 1 ? sz.n + " × " : "") + motorTxt, unit: (imp ? "hp" : "kW") + " standard frame" }])}
    <figure class="res-chart">${chart}<figcaption class="legend-row"><span><i class="lg sys"></i>System curve</span><span><i class="lg sys2"></i>At high level</span><span><i class="lg ${sel ? "pumpN" : "pump"}"></i>${esc(pumpLabel)}</span><span>Head (${U.label("head")}) against flow (${U.label("flow")})</span></figcaption></figure>
    <table class="table res-table"><tbody>
      ${rowQ("Line velocity — " + sz.main.seg.name, "vel", sz.main.V)}
      ${row("Reynolds number", Math.round(sz.main.Re).toLocaleString("en-GB"), "")}
      ${row("Friction factor (Swamee–Jain)", sz.main.f.toFixed(4), "")}
      ${rowQ("Friction loss", "head", sz.hf)}
      ${rowQ("Fittings loss, ΣK " + sz.sumK.toFixed(2), "head", sz.hm)}
      ${rowQ("Static head", "head", sz.Hs)}
      ${rowQ("Residual pressure as head", "head", sz.hp)}
      ${rowQ("Head margin", "head", sz.hmar)}
      ${rowQ("Total dynamic head", "head", sz.H, true)}
      ${rowQ("Pump discharge pressure", "press", st.P_dis)}
      ${rowQ("NPSH available", "head", st.NPSHa)}
      ${rowQ("Hydraulic power", "power", sz.Ph)}
      ${rowQ("Shaft power" + (sz.effFromPump ? " (selected pump η)" : ""), "power", sz.Ps)}
      ${rowQ("Motor input power", "power", sz.Pin, true)}
    </tbody></table>
    ${checksHtml(checks)}`;
}

function gravityResults() {
  const g = R.gravity;
  if (!g || g.errors) return `<div class="res-head"><h2>Results</h2></div>${checksHtml((g ? g.errors : ["Gravity line not applicable"]).map(e => ({ status: "fail", text: e })))}`;
  const top = Math.max(g.H_avail_min, g.hf + g.hm, 0.3) * 1.2;
  const d = v => U.toDisp("head", v);
  const segs = [{ v0: 0, v1: d(g.hf), kind: "loss", text: U.fmt("head", g.hf) }, { v0: d(g.hf), v1: d(g.hf + g.hm), kind: "loss2", text: U.fmt("head", g.hm) }];
  if (g.margin_LAT >= 0) segs.push({ v0: d(g.hf + g.hm), v1: d(g.H_avail_min), kind: "ok", text: U.fmt("head", g.margin_LAT) });
  else segs.push({ v0: d(g.H_avail_min), v1: d(g.hf + g.hm), kind: "short", text: U.fmt("head", g.margin_LAT) });
  const chart = RO.svgchart.bars({ w: 520, h: 240, ymin: 0, ymax: d(top), label: "Head budget at LAT",
    bars: [{ label: "Available @ LAT", segs: [{ v0: 0, v1: d(Math.max(g.H_avail_min, 0)), kind: "base", text: U.fmt("head", g.H_avail_min) }] }, { label: "Losses + margin", segs }] });
  return `<div class="res-head"><h2>Results</h2><span class="dim">${esc(recCount())}</span></div>
    ${kpiHtml([
      { label: "Margin @ LAT", value: U.fmt("head", g.margin_LAT), unit: U.label("head") },
      { label: "Required head", value: U.fmt("head", g.H_required), unit: U.label("head") + " losses" },
      { label: "Min submergence", value: U.fmt("head", g.S_min), unit: U.label("head") + " (HI 9.8)" }])}
    <figure class="res-chart">${chart}<figcaption class="legend-row"><span><i class="lg base"></i>Available</span><span><i class="lg loss"></i>Friction</span><span><i class="lg loss2"></i>Fittings</span><span><i class="lg ok"></i>Margin</span><span>Head (${U.label("head")})</span></figcaption></figure>
    <table class="table res-table"><tbody>
      ${rowQ("Available head @ LAT", "head", g.H_avail_min)}
      ${rowQ("Available head @ HAT", "head", g.H_avail_max)}
      ${rowQ("Friction loss", "head", g.hf)}
      ${rowQ("Fittings + transitions", "head", g.hm)}
      ${rowQ("Required head", "head", g.H_required, true)}
      ${rowQ("Margin @ LAT", "head", g.margin_LAT, true)}
      ${rowQ("Margin @ HAT", "head", g.margin_HAT)}
      ${rowQ("Flow per line", "flow", g.ev.Qline * 3600)}
      ${rowQ("Velocity — " + g.main.seg.name, "vel", g.main.V)}
      ${rowQ("Velocity @ Q_min, one line", "vel", g.V_qmin)}
      ${row("Froude number at inlet", g.Fr.toFixed(3), "")}
      ${rowQ("Sump volume", "vol", g.V_sump)}
      ${row("Sump length × width × depth", `${U.fmt("elev", g.sump_length)} × ${U.fmt("elev", g.sump_width)} × ${U.fmt("elev", g.sump_depth)}`, U.label("elev"))}
      ${rowQ("Sediment critical velocity", "vel", g.V_sc)}
    </tbody></table>
    ${checksHtml(toText(g.checks).concat([...new Set(g.warnings)].map(w => ({ status: "note", text: w }))))}`;
}

function selectionResults() {
  const sel = R.selection, st = R.station;
  if (!st || st.errors) return `<div class="res-head"><h2>Results</h2></div><p class="dim">Complete Pump sizing first.</p>`;
  if (!sel) return `<div class="res-head"><h2>Results</h2></div><p class="dim">Select a pump from the library, add one, or load the example pump.</p>`;
  if (sel.error) return `<div class="res-head"><h2>Results</h2></div>${checksHtml([{ status: "fail", text: sel.error }])}`;
  const a = sel.opMin, b = sel.opMax, c = sel.opN1;
  const xmax = Math.max(S.flow.Q_design * 1.5, sel.pf.Qmax * sel.n * 1.05);
  const series = [{ pts: curvePts(st.sysH(st.lv.min), xmax), kind: "sys" }, { pts: curvePts(st.sysH(st.lv.max), xmax), kind: "sys2" },
    { pts: curvePts(sel.pf.head, sel.pf.Qmax), kind: "pump" }, { pts: curvePts(q => sel.pf.head(q / sel.n), sel.pf.Qmax * sel.n), kind: "pumpN" }];
  const ymax = Math.max(...series.map(s => Math.max(...s.pts.map(p => p[1])))) * 1.08;
  const pts = [a, b].filter(Boolean).map((o, i) => ({ x: U.toDisp("flow", o.Q), y: U.toDisp("head", o.H), label: i ? "" : `${U.fmt("flow", o.Q)} ${U.label("flow")} · ${U.fmt("head", o.H)} ${U.label("head")}` }));
  const chart = RO.svgchart.lines({ w: 520, h: 240, xmax: U.toDisp("flow", xmax), ymax, series, points: pts, label: "Pump against system" });
  return `<div class="res-head"><h2>Results</h2><span class="dim">${esc(sel.pump.vendor + " " + sel.pump.model)}</span></div>
    ${kpiHtml([
      { label: "Flow @ low level", value: a ? U.fmt("flow", a.Q) : "—", unit: U.label("flow") + ` with ${sel.n} duty` },
      { label: "Head", value: a ? U.fmt("head", a.H) : "—", unit: U.label("head") },
      { label: "Power per pump", value: a && a.P_shaft != null ? U.fmt("power", a.P_shaft) : "—", unit: U.label("power") + " shaft" }])}
    <figure class="res-chart">${chart}<figcaption class="legend-row"><span><i class="lg sys"></i>System (low level)</span><span><i class="lg sys2"></i>System (high level)</span><span><i class="lg pump"></i>1 pump</span><span><i class="lg pumpN"></i>${sel.n} pumps</span></figcaption></figure>
    <table class="table res-table"><tbody>
      ${a ? rowQ("Flow per pump @ low level", "flow", a.Q1) : ""}
      ${a && a.eff != null ? row("Efficiency", a.eff.toFixed(1), "%") : ""}
      ${a && a.npshr != null ? row("NPSH available / required", `${U.fmt("head", a.NPSHa)} / ${U.fmt("head", a.npshr)}`, U.label("head")) : ""}
      ${b ? rowQ("Flow @ high level", "flow", b.Q) : row("Flow @ high level", "beyond curve", "")}
      ${b ? rowQ("Flow per pump @ high level", "flow", b.Q1) : ""}
      ${c ? rowQ(`Flow with ${c.n} pump${c.n > 1 ? "s" : ""}`, "flow", c.Q) : ""}
      ${sel.pf.bep ? rowQ("BEP flow (" + sel.pf.bepSource + ")", "flow", sel.pf.bep) : ""}
      ${row("Curve fit residual", U.fmt("head", sel.pf.H.maxResid), U.label("head"))}
    </tbody></table>
    ${checksHtml(toText(sel.checks).concat([...new Set(sel.warnings)].map(w => ({ status: "note", text: w }))))}`;
}

function surgeResults() {
  const u = R.surge;
  if (!u || u.errors) return `<div class="res-head"><h2>Results</h2></div>${checksHtml(((u && u.errors) || ["Nothing to check"]).map(e => ({ status: "fail", text: e })))}`;
  return `<div class="res-head"><h2>Results</h2><span class="dim">${u.sideKey === "gravity" ? "Gravity line" : "Discharge line"}${R.selection && R.selection.pf ? " · incl. pump shut-off" : ""}</span></div>
    ${kpiHtml([
      { label: "Governing surge", value: U.fmt("press", u.dPgov), unit: U.label("press") + " ΔP" },
      { label: "Wave speed", value: u.gov ? U.fmt("speed", u.gov.a) : "—", unit: U.label("speed") + (u.gov ? " · " + u.gov.s.seg.name : "") },
      { label: "Critical time", value: u.Tc.toFixed(2), unit: "s, 2ΣL/a" }])}
    ${checksHtml(toText(u.checks))}`;
}

function surgeTableHtml() {
  const u = R.surge;
  if (!u || u.errors) return `<p class="dim">${esc(((u && u.errors) || []).join(" "))}</p>`;
  return `<table class="table"><thead><tr><th>Segment</th><th class="r">OD × e</th><th class="r">Class</th><th class="r">PFA / PMA</th><th class="r">a</th><th class="r">V</th><th class="r">ΔP</th><th class="r">Steady</th><th class="r">Shut-off</th><th class="r">Peak</th><th class="r">Min</th></tr></thead><tbody>` +
    u.rows.map(r => `<tr${r === u.gov ? ' class="hl"' : ""}><td>${esc(r.s.seg.name)}</td>
      <td class="r">${U.fmt("dia", r.s.g.OD, U.isImperial() ? 2 : 0)} × ${U.fmt("wall", r.s.g.e)}</td>
      <td class="r">${r.cls ? (r.cls.rated ? `SDR ${r.cls.rated} · PN ${r.cls.PN_rated}` : "none") : "non-PE"}</td>
      <td class="r">${r.cls && r.cls.PFA != null ? `${U.fmt("press", r.cls.PFA)} / ${U.fmt("press", r.cls.PMA)}` : "—"}</td>
      <td class="r">${U.fmt("speed", r.a)}</td><td class="r">${U.fmt("vel", r.s.V)}</td><td class="r">${U.fmt("press", r.dP)}</td>
      <td class="r">${U.fmt("press", r.P_steady)}</td><td class="r">${r.P_shut != null ? U.fmt("press", r.P_shut) : "—"}</td>
      <td class="r">${U.fmt("press", r.peak)}</td><td class="r">${U.fmt("press", r.min)}</td></tr>`).join("") +
    `</tbody></table><p class="dim">Pressures in ${U.label("press")} g, speeds in ${U.label("speed")}, velocity in ${U.label("vel")}, sizes in ${U.label("dia")}.</p>`;
}

function stepsList() {
  const st = [], G = RO.hyd.G, f = (v, d = 3) => (isFinite(v) ? (+v).toFixed(d) : "—");
  st.push({ head: `Fluid: ${F.label}${F.S != null ? " " + F.S + " g/kg" : ""} @ ${F.T} °C` });
  st.push({ label: "Fluid properties", res: `ρ = ${f(F.rho, 2)} kg/m³ · ν = ${F.nu.toExponential(3)} m²/s · K = ${f(F.K / 1e9, 3)} GPa · Pv = ${f(F.Pv / 1000, 3)} kPa`, note: F.source });
  const sideSteps = (title, ev) => {
    if (!ev || ev.empty || ev.errors.length) return;
    st.push({ head: title });
    ev.segs.forEach((s, i) => {
      const t = ev.trans.find(tt => tt.index === i);
      if (t) st.push({ label: `${t.label}: ${t.from} → ${t.to}`, eq: t.method, sub: `K = ${f(t.K, 4)}, V = ${f(t.V)} m/s`, res: `h = ${f(t.h, 4)} m` });
      st.push({ label: `${s.seg.name} — OD ${s.g.OD} × ${f(s.g.e, 1)}, ID ${f(s.g.ID, 1)} mm, L ${s.seg.L_m} m`,
        eq: "V = Q/A · Re = VD/ν · f (Swamee–Jain) · h = (f·L/D + ΣK)·V²/2g",
        sub: `Q = ${f(s.Q * 3600, 1)} m³/h → V = ${f(s.V)} m/s · Re = ${s.Re.toExponential(3)} · f = ${f(s.f, 5)} · ΣK = ${f(s.sumK)}` + (s.fits.length ? ` (${s.fits.map(x => `${x.qty}×${x.code} ${f(x.K)}`).join(", ")})` : ""),
        res: `h_f = ${f(s.hf, 4)} m · h_m = ${f(s.hm, 4)} m · h = ${f(s.h, 4)} m` });
    });
    st.push({ label: "Side total", res: `Σh = ${f(ev.h, 4)} m over ${f(ev.L, 0)} m` });
  };
  const g = R.gravity;
  if (g && !g.errors) {
    sideSteps("Gravity line @ design flow", g.ev);
    st.push({ label: "Available head @ LAT", eq: "H_avail = LAT − sump level", sub: `= ${S.levels.LAT} − (${S.levels.sump_min})`, res: `= ${f(g.H_avail_min)} m` });
    st.push({ label: "Margin @ LAT", eq: "margin = H_avail − Σh", sub: `= ${f(g.H_avail_min)} − ${f(g.H_required)}`, res: `= ${f(g.margin_LAT)} m` });
    st.push({ label: "Submergence (ANSI/HI 9.8)", eq: `S = D(1 + ${g.c}·Fr), Fr = V/√(gD)`, sub: `Fr = ${f(g.first.V)}/√(${G}×${f(g.first.g.D, 4)}) = ${f(g.Fr)}`, res: `S = ${f(g.S_min)} m; crown + S = ${f(S.levels.inlet_crown + g.S_min)} m vs LAT ${S.levels.LAT} m` });
  }
  const s = R.station, sz = R.sizing;
  if (s && !s.errors) {
    sideSteps(`Suction (per pump, ${s.n} lines) @ design flow`, s.evS);
    sideSteps("Discharge @ design flow", s.evD);
    st.push({ head: "Pump duty" });
    st.push({ label: "Static head (low source level)", eq: "H_st = z_del − z_src + (P_del − P_src)/(ρg)", sub: `= ${S.station.z_delivery} − (${s.lv.min}) + ${f(s.H_press)}`, res: `= ${f(s.H_st_min)} m` });
    st.push({ label: "Total dynamic head", eq: "TDH = H_st + Σh_suction + Σh_discharge", sub: `= ${f(s.H_st_min)} + ${f(s.evS.h)} + ${f(s.evD.h)}`, res: `= ${f(s.TDH_min)} m` });
    st.push({ label: "Design head with margin", eq: "H = TDH × (1 + margin)", sub: `= ${f(sz.Hbase)} × (1 + ${f(sz.margin, 2)})`, res: `= ${f(sz.H)} m` });
    st.push({ label: "Powers", eq: "P_h = ρgQH · P_s = P_h/η_p · P_in = P_s/η_m", sub: `P_h = ${f(F.rho, 1)}×${G}×${f(sz.Q, 4)}×${f(sz.H)}/1000 = ${f(sz.Ph, 2)} kW; η_p = ${f(sz.ep, 3)}, η_m = ${f(sz.em, 3)}`, res: `P_s = ${f(sz.Ps, 2)} kW · P_in = ${f(sz.Pin, 2)} kW` });
    st.push({ label: "Motor per duty pump", eq: "smallest IEC rating ≥ margin × P_s/n", sub: `${f(sz.motorMargin, 2)} × ${f(sz.Ps1, 2)} = ${f(sz.motorMargin * sz.Ps1, 2)} kW`, res: `${sz.motor ?? "—"} kW, load ${sz.load ? f(sz.load * 100, 0) : "—"} %` });
    st.push({ label: "Pump discharge pressure", eq: "P_dis = P_del + ρg(z_del − z_pump + Σh_discharge)", res: `= ${f(s.P_dis)} bar g` });
    st.push({ label: "NPSH available", eq: "NPSHa = (P_atm + P_src)/ρg + (z_src,min − z_pump) − Σh_suction − P_v/ρg", res: `= ${f(s.NPSHa)} m` });
  }
  const sel = R.selection;
  if (sel && sel.pf) {
    st.push({ head: `Pump: ${sel.pump.vendor} ${sel.pump.model}` });
    st.push({ label: "Curve fit", eq: `H(Q) = polynomial degree ${sel.pf.H.deg} (least squares)`, sub: `max residual ${f(sel.pf.H.maxResid)} m, R² = ${f(sel.pf.H.r2, 5)}`, res: `BEP ${sel.pf.bep ? f(sel.pf.bep, 0) + " m³/h (" + sel.pf.bepSource + ")" : "unknown"}` });
    if (sel.opMin) st.push({ label: `Operating point, ${sel.n} duty, low level`, eq: "H₁(Q/n) = H_sys(Q) (bisection)", res: `Q = ${f(sel.opMin.Q, 1)} m³/h · H = ${f(sel.opMin.H, 2)} m` });
  }
  const u = R.surge;
  if (u && !u.errors && u.gov) {
    st.push({ head: "Surge (Joukowsky screening, equations.md §5.2)" });
    st.push({ label: `Wave speed — ${u.gov.s.seg.name}`, eq: "a = √(K/ρ)/√(1 + ψ(K/E)(D/e))", sub: `ψ = ${f(u.psi, 2)}, E = ${f(u.gov.E / 1e9, 2)} GPa, D/e = ${f(u.gov.s.g.ID / u.gov.s.g.e, 2)}`, res: `a = ${f(u.gov.a, 1)} m/s` });
    st.push({ label: "Governing surge", eq: "ΔP = ρ·a·ΔV", sub: `= ${f(F.rho, 1)} × ${f(u.gov.a, 1)} × ${f(u.gov.s.V)}`, res: `= ${f(u.dPgov)} bar` });
    st.push({ label: "Critical closure time", eq: "T_c = 2 Σ L_i/a_i", res: `= ${f(u.Tc, 2)} s` });
  }
  return st;
}

function renderSuggestion() {
  const sg = R && R.suggestion;
  const el = ROOT.querySelector('[data-out="gsuggest"]');
  if (!el) return;
  if (!sg || !R.gravity || R.gravity.errors) { el.innerHTML = ""; return; }
  const seg = S.routes.gravity.segments[sg.index];
  el.innerHTML = sg.dn
    ? (sg.dn === +seg.dn ? `<span class="dim">✓ ${esc(seg.name)}: OD ${sg.dn} is the smallest catalogue size meeting the margin and velocity limits.</span>`
       : `<span class="dim">Recommended for <strong>${esc(seg.name)}</strong>: OD ${sg.dn} (V ${U.fmt("vel", sg.V)} ${U.label("vel")}, margin ${U.fmt("head", sg.margin)} ${U.label("head")}).</span> <button class="btn btn-secondary btn-sm" data-act="applyg" data-i="${sg.index}" data-od="${sg.dn}">Use OD ${sg.dn}</button>`)
    : `<span class="dim">Pipe sizing: ${esc(sg.note || "")}</span>`;
}

/* ================= pump selection helpers ================= */
async function loadPump(id) {
  if (!id) return null;
  if (pumpCache[id]) return pumpCache[id];
  try { pumpCache[id] = await RO.pumplib.get(id); } catch (e) { RO.ui.apiError(e, "Pump"); return null; }
  return pumpCache[id];
}
async function renderPumpPicker() {
  const sel = ROOT.querySelector("#p-pick");
  if (!sel) return;
  const list = await RO.pumplib.list();
  sel.innerHTML = `<option value="">— select a pump (${list.length} available) —</option>` + list.map(p =>
    `<option value="${p.id}"${String(p.id) === String(S.selection.pumpId) ? " selected" : ""}>${esc(p.vendor)} ${esc(p.model)} · ${esc(p.status)}</option>`).join("");
}
function renderPumpInfo() {
  const p = S.selection.pumpId ? pumpCache[S.selection.pumpId] : null;
  put("pumpinfo", p ? `<table class="table"><tbody>
      ${row("Vendor / model", `${p.vendor} ${p.model}`, "")}${row("Type", p.pump_type, "")}${p.speed_rpm ? row("Speed", p.speed_rpm, "rpm") : ""}
      ${p.motor_kw ? rowQ("Motor rating", "power", p.motor_kw) : ""}${row("Curve points", (p.points || []).length, "")}${row("Status", p.status || p.origin || (String(p.id).startsWith("s") ? "session only" : "—"), "")}</tbody></table>`
    : `<p class="dim">No pump selected. Pumps come from Libraries › Pumps; guests can add one for this session.</p>`, true);
}

/* ================= header actions (design: status · save · submit) ================= */
function renderActions() {
  if (!ACTIONS) return;
  const tagTxt = savedAt ? (dirty ? "Unsaved changes" : "Local draft") : "Not saved";
  ACTIONS.innerHTML = `<span class="tag ${savedAt && !dirty ? "tag-outline" : "tag-neutral"} top-tag">${tagTxt}</span>
    ${savedAt ? `<span class="dim">Saved ${esc(savedAt)} on this device</span>` : ""}
    <button class="btn btn-secondary" data-act="savedraft">Save on this device</button>
    <button class="btn btn-primary blueprint" disabled title="Approvals arrive with project profiles (Admin › Projects, on the roadmap)">${corners()}Submit for approval</button>`;
}
function saveDraft() {
  try {
    const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: t, state: S, fluid: RO.fluid.get(), pumpId: S.selection.pumpId, pump: S.selection.pumpId ? pumpCache[S.selection.pumpId] || null : null }));
    savedAt = t; dirty = false; renderActions();
    RO.ui.toast("Draft saved on this device", "ok");
  } catch (e) { RO.ui.toast("This browser does not allow saving drafts", "error"); }
}
function markDirty() { if (!dirty) { dirty = true; renderActions(); } }

/* ================= events ================= */
function onInput(e) {
  const el = e.target;
  if (el.dataset.fid) {
    const d = DEFS[el.dataset.fid];
    let v = el.value.trim() === "" ? null : (d.q === "none" ? Number(el.value.replace(/,/g, "")) : U.parse(d.q, el.value));
    if (v !== null && d.int && isFinite(v)) v = Math.max(d.min ?? 0, Math.round(v));
    setP(d.path, v);
    if (d.path === "feed.T" || d.path === "feed.tds") RO.fluid.set(C.feedFluid(S), "intake");
    const wrap = ROOT.querySelector(`[data-fwrap="${el.dataset.fid}"]`);
    if (wrap) { const tmp = document.createElement("div"); tmp.innerHTML = fieldHtml(el.dataset.fid); const nw = tmp.firstElementChild;
      wrap.className = nw.className; wrap.querySelector(".in-help").textContent = nw.querySelector(".in-help").textContent;
      const tagOld = wrap.querySelector(".rec-tag"), tagNew = nw.querySelector(".rec-tag");
      if (tagOld && !tagNew) tagOld.remove(); if (!tagOld && tagNew) wrap.querySelector(".in-wrap").appendChild(tagNew);
      el.placeholder = nw.querySelector("input").placeholder; }
    rankCache = null; markDirty(); recalc();
    if (["station.n_duty"].includes(d.path)) { /* suction flows depend on n */ }
    return;
  }
  if (el.dataset.seg && el.type !== "checkbox" && el.tagName !== "SELECT") {
    const [side, i, f] = el.dataset.seg.split(":");
    const sg = S.routes[side].segments[+i];
    if (f === "name") sg.name = el.value;
    else { const q = { L_m: "len", dz_m: "elev", od_mm: "dia", e_mm: "wall" }[f]; const v = U.parse(q, el.value); if (v !== null && isFinite(v)) sg[f] = v; }
    markDirty(); recalc(); return;
  }
  if (el.dataset.fit) {
    const [side, i, j, f] = el.dataset.fit.split(":");
    const fr = S.routes[side].segments[+i].fittings[+j];
    fr[f] = el.value.trim() === "" ? null : (f === "kv" ? U.parse("kv", el.value) : parseFloat(el.value));
    markDirty(); recalc();
  }
}

function onChange(e) {
  const el = e.target;
  if (el.dataset.sel) {
    setP(el.dataset.sel, el.value);
    if (el.dataset.sel === "routes.discharge.transition") S.routes.suction.transition = el.value;
    if (el.dataset.sel === "arrangement" && !hasP()) S.surge.side = "gravity";
    if (el.dataset.sel === "arrangement" && !hasG() && S.surge.side === "gravity") S.surge.side = "discharge";
    markDirty(); rankCache = null;
    if (el.dataset.sel === "arrangement") { setTab(tab, false); return; }
    renderPage(); return;
  }
  if (el.dataset.seg && (el.type === "checkbox" || el.tagName === "SELECT")) {
    const [side, i, f] = el.dataset.seg.split(":");
    const sg = S.routes[side].segments[+i];
    if (el.type === "checkbox") sg[f] = el.checked; else sg[f] = +el.value;
    if (f === "custom" && sg.custom) { const g = RO.route.geom(Object.assign({}, sg, { custom: false })); sg.od_mm = g.OD; sg.e_mm = g.e; }
    markDirty(); rankCache = null;
    if (f === "custom") renderPage(); else recalc();
    return;
  }
  if (el.dataset.actSelect === "fadd" && el.value) {
    const [side, i] = el.dataset.key.split(":");
    S.routes[side].segments[+i].fittings.push({ code: el.value, qty: 1, k: null, kv: null });
    markDirty(); renderPage(); return;
  }
  if (el.dataset.actSelect === "pickpump") {
    S.selection.pumpId = el.value || null;
    (S.selection.pumpId ? loadPump(S.selection.pumpId) : Promise.resolve()).then(() => { markDirty(); recalc(); });
  }
}

function onClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b || !ROOT.contains(b) && !ACTIONS.contains(b)) return;
  const a = b.dataset.act;
  const seg = (side, i) => S.routes[side].segments[+i];
  if (a === "savedraft") { saveDraft(); return; }
  if (a === "addseg") {
    const side = b.dataset.side, segs = S.routes[side].segments, prev = segs[segs.length - 1];
    segs.push(RO.route.newSegment(prev ? { name: "Segment " + (segs.length + 1), dn: prev.dn, sdr: prev.sdr, joint: prev.joint, L_m: 50, fittings: [] }
      : { name: side === "suction" ? "Suction pipe" : "Segment 1", L_m: side === "suction" ? 5 : 100, perPump: side === "suction" }));
  }
  if (a === "del") S.routes[b.dataset.side].segments.splice(+b.dataset.i, 1);
  if (a === "up" || a === "down") {
    const segs = S.routes[b.dataset.side].segments, i = +b.dataset.i, j = a === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < segs.length) [segs[i], segs[j]] = [segs[j], segs[i]];
  }
  if (a === "rmprof") delete S.routes[b.dataset.side].profile;
  if (a === "recod") seg(b.dataset.side, b.dataset.i).dn = +b.dataset.od;
  if (a === "applyg") seg("gravity", b.dataset.i).dn = +b.dataset.od;
  if (a === "fitsel") fitSel[b.dataset.page] = b.dataset.key;
  if (a === "finc" || a === "fdec" || a === "fdel") {
    const [side, i] = b.dataset.key.split(":"), fits = seg(side, i).fittings, j = +b.dataset.j;
    if (a === "finc") fits[j].qty = (+fits[j].qty || 0) + 1;
    if (a === "fdec") fits[j].qty = Math.max(0, (+fits[j].qty || 0) - 1);
    if (a === "fdel") fits.splice(j, 1);
  }
  if (a === "newpump") { RO.pumpEditor.open(null, () => { RO.pumplib.invalidate(); renderPumpPicker(); }); return; }
  if (a === "examplepump") { examplePump(); return; }
  if (a === "rank") { rankLibrary(); return; }
  if (a === "usepump") { const r = rankCache[+b.dataset.i]; S.selection.pumpId = r.pump.id; S.station.n_duty = r.n; }
  markDirty(); rankCache = a === "usepump" ? rankCache : null;
  renderPage();
}

function examplePump() {
  const st = R && R.station;
  if (!st || st.errors) { RO.ui.toast("Complete Pump sizing first", "warn"); return; }
  // Illustrative pump generated for the current duty (session only): rated at Q/n, 5 % above TDH, shut-off 1.3 × rated head.
  const Qr = S.flow.Q_design / st.n, Hr = st.TDH_min * 1.05, H0 = 1.3 * Hr, b = (H0 - Hr) / (Qr * Qr);
  const P = F.rho * RO.hyd.G * (Qr / 3600) * Hr / 0.8 / 1000;
  const p = RO.pumplib.saveSession({
    vendor: "Example", model: `Generated for ${U.fmt("flow", Qr)} ${U.label("flow")} @ ${U.fmt("head", Hr)} ${U.label("head")} (illustrative)`, pump_type: S.station.pump_type,
    speed_rpm: 1480, motor_kw: C.MOTORS.find(m => m >= P * 1.3) || Math.ceil(P * 1.3),
    points: [0, 0.35, 0.7, 1.0, 1.2, 1.35].map(x => { const q = x * Qr; return { q_m3h: +q.toFixed(1), h_m: +(H0 - b * q * q).toFixed(2), eff_pct: +Math.max(0, 80 - 80 * Math.pow(x - 1, 2)).toFixed(1), npshr_m: +(2 + 3 * x * x).toFixed(2) }; }),
    notes: "Illustrative example generated from the current duty point — not vendor data."
  });
  S.selection.pumpId = p.id; pumpCache[p.id] = p;
  markDirty(); renderPage();
  RO.ui.toast("Example pump added for this session", "ok");
}

async function rankLibrary() {
  const list = await RO.pumplib.list();
  put("rankhint", `Checking ${list.length} pumps…`);
  const full = [];
  for (const p of list.slice(0, 40)) { const x = await loadPump(p.id); if (x) full.push(x); }
  rankCache = C.rankPumps(C.effective(S), F, full);
  put("rankhint", `${rankCache.length} of ${full.length} pumps can meet ${U.fmt("flow", S.flow.Q_design)} ${U.label("flow")} with 6 duty pumps or fewer.`);
  put("ranktable", rankCache.length ? `<table class="table"><thead><tr><th>Pump</th><th class="r">Duty</th><th class="r">Flow @ low level</th><th class="r">Total power</th><th>Checks</th><th></th></tr></thead><tbody>` +
    rankCache.map((r, i) => `<tr><td>${esc(r.pump.vendor)} ${esc(r.pump.model)}</td><td class="r">${r.n}</td><td class="r">${U.fmt("flow", r.Q)} ${U.label("flow")}</td><td class="r">${U.fmt("power", r.P)} ${U.label("power")}</td>
      <td>${r.fails ? `<span class="tag tag-solid">${r.fails} check${r.fails > 1 ? "s" : ""}</span>` : ""} ${r.warns ? `<span class="tag tag-outline">${r.warns} marginal</span>` : ""} ${!r.fails && !r.warns ? '<span class="tag tag-accent">OK</span>' : ""}</td>
      <td class="r"><button class="btn btn-secondary btn-sm" data-act="usepump" data-i="${i}">Use</button></td></tr>`).join("") + "</tbody></table>" : "", true);
}

/* ================= export / import / state ================= */
function summary() {
  const out = {};
  if (!R) return out;
  if (R.gravity && !R.gravity.errors) Object.assign(out, { gravity_margin_LAT_m: +R.gravity.margin_LAT.toFixed(3), gravity_losses_m: +R.gravity.H_required.toFixed(3) });
  if (R.station && !R.station.errors) Object.assign(out, { TDH_m: +R.station.TDH_min.toFixed(3), P_discharge_bar: +R.station.P_dis.toFixed(3), NPSHa_m: +R.station.NPSHa.toFixed(3) });
  if (R.sizing) Object.assign(out, { design_head_m: +R.sizing.H.toFixed(3), motor_input_kW: +R.sizing.Pin.toFixed(2), motor_per_pump_kW: R.sizing.motor });
  if (R.selection && R.selection.opMin) Object.assign(out, { pump_Q_op_m3h: +R.selection.opMin.Q.toFixed(1), pump_H_op_m: +R.selection.opMin.H.toFixed(2) });
  if (R.surge && !R.surge.errors) Object.assign(out, { surge_dP_bar: +R.surge.dPgov.toFixed(3), surge_Tc_s: +R.surge.Tc.toFixed(2) });
  return out;
}
function exportJson() {
  const act = RO.fittings.active();
  const doc = { app: "RO Workbench", module: "intake", format: 2, exported_at: new Date().toISOString(), units_shown: U.system(),
    fluid: RO.fluid.get(), state: S, fittings_list: act ? { name: act.name, version: act.version, origin: act.origin } : null,
    pump: S.selection.pumpId ? pumpCache[S.selection.pumpId] || null : null, summary: summary(), note: "All state values are SI (m³/h, m, mm, bar, °C)." };
  RO.csv.download(`intake_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(doc, null, 2), "application/json");
}
function exportCsv() {
  if (!R) { RO.ui.toast("Nothing to export yet", "warn"); return; }
  const rows = [];
  const add = (side, ev) => ev && !ev.empty && ev.segs.forEach(s => !s.error && rows.push([side, s.seg.name, s.seg.material, s.g.OD, s.g.e.toFixed(1), s.g.ID.toFixed(1), s.seg.L_m, s.seg.dz_m,
    s.seg.joint, (s.Q * 3600).toFixed(1), s.V.toFixed(3), s.Re.toFixed(0), s.f.toFixed(5), s.hf.toFixed(4), s.sumK.toFixed(3), s.hm.toFixed(4), s.h.toFixed(4), s.fits.map(fx => `${fx.qty}x${fx.code}`).join(" ")]));
  add("gravity", R.gravity && R.gravity.ev); add("suction", R.station && R.station.evS); add("discharge", R.station && R.station.evD);
  const head = ["side", "segment", "material", "OD_mm", "e_mm", "ID_mm", "L_m", "dz_m", "joint", "Q_m3h", "V_m_s", "Re", "f", "hf_m", "sumK", "hm_m", "h_m", "fittings"];
  const sum = summary();
  RO.csv.download(`intake_segments_${new Date().toISOString().slice(0, 10)}.csv`, RO.csv.stringify(head, rows.concat([[]], Object.keys(sum).map(k => ["summary", k, sum[k]]))));
}
function importJson(doc) {
  if (!doc || doc.module !== "intake" || !doc.state) throw new Error("Not an intake export");
  setState({ state: doc.state, tab });
  if (doc.fluid) RO.fluid.set(doc.fluid, "import");
  if (doc.pump && doc.state.selection && doc.state.selection.pumpId) {
    const id = doc.state.selection.pumpId;
    if (String(id).startsWith("s") || !api.state.online) { const p = RO.pumplib.saveSession(Object.assign({}, doc.pump, { id: String(id).startsWith("s") ? id : undefined })); S.selection.pumpId = p.id; pumpCache[p.id] = p; }
  }
  renderPage();
}
function getState() { return { state: JSON.parse(JSON.stringify(S)), tab }; }
function setState(st) {
  const d = C.defaultState(), s = st && st.state ? st.state : st;
  S = Object.assign(d, JSON.parse(JSON.stringify(s || {})));
  ["flow", "levels", "station", "surge", "selection", "feed", "line", "gline", "sizing"].forEach(k => { S[k] = Object.assign(d[k] || {}, s && s[k]); });
  S.overrides = S.overrides || {};
  rankCache = null;
  RO.fluid.set(C.feedFluid(S), "intake");
  if (st && st.tab) tab = st.tab;
  if (ROOT) { renderTabs(); renderPage(); }
}

/* ================= registration ================= */
RO.registerModule({
  id: "intake",
  title: "Intake",
  pageTitle: () => "Intake " + (PAGES.find(p => p.id === tab) || PAGES[0]).label.toLowerCase(),
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
        if (d.pump && d.pumpId) { pumpCache[d.pumpId] = d.pump; if (String(d.pumpId).startsWith("s") && !RO.pumplib.sessionList().some(p => p.id === d.pumpId)) RO.pumplib.saveSession(d.pump); }
        savedAt = d.savedAt;
        setTimeout(() => RO.ui.toast(`Restored your draft saved ${d.savedAt} on this device`), 400);
      } else RO.fluid.set(C.feedFluid(S), "intake");
    } catch (e) { RO.fluid.set(C.feedFluid(S), "intake"); }
    RO.fluid.subscribe((st, source) => {
      if (source !== "intake" && source !== "import" && st.preset !== "custom") { S.feed.T = st.T_C; S.feed.tds = Math.round(st.S_gkg * RO.fluids.densitySW(st.T_C, st.S_gkg).rho); }
      if (ROOT && RO.app.isActive("intake")) recalc();
    });
    RO.units.subscribe(() => { if (ROOT) renderPage(); });
    RO.values.subscribe(() => { if (ROOT) renderPage(); });
    RO.fittings.subscribe(() => { if (ROOT) renderPage(); });
    RO.pumplib.subscribe(() => { if (tab === "selection") renderPumpPicker(); });
    if (S.selection.pumpId) loadPump(S.selection.pumpId).then(() => recalc());
    setTab(tab, true);
  },
  onShow() { renderPage(); },
  onRoute(sub) { if (sub && sub !== tab) setTab(sub, true); },
  reset() { savedAt = null; dirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } setState({ state: C.defaultState(), tab }); },
  getState, setState,
  /** Route from Tools › Pipeline design (PRD §8A.3 "Send to Intake"): replaces the gravity line, or the discharge main keeping pump-local piping. */
  receiveRoute(p) {
    const side = p.side === "gravity" ? "gravity" : "discharge";
    if (side === "gravity" && !hasG()) S.arrangement = "gravity_pumps";
    if (side === "discharge" && !hasP()) S.arrangement = "gravity_pumps";
    const r = S.routes[side];
    const keep = side === "discharge" ? r.segments.filter(sg => sg.perPump) : [];
    r.segments = keep.concat(JSON.parse(JSON.stringify(p.segments)));
    r.nLines = p.nLines || 1;
    r.transition = p.transition || r.transition;
    if (side === "discharge") S.routes.suction.transition = r.transition;
    r.profile = p.profile;
    const line = side === "gravity" ? S.gline : S.line;
    line.material = p.material; line.eps_mm = p.eps_mm ?? null;
    rankCache = null; dirty = true;
    if (ROOT) { renderTabs(); renderPage(); }
  },
  exportMenu: () => [
    { label: "Calculation file (JSON)", hint: "All inputs, fluid, selected pump and a results summary — re-import it later with Import", run: exportJson },
    { label: "Segment table (CSV)", hint: "Per-segment hydraulics for Excel", run: exportCsv },
    { label: "Print / PDF (A4)", hint: "Use the browser's print dialog → Save as PDF", run: () => window.print() }
  ],
  importJson
});
})(window.RO = window.RO || {});
