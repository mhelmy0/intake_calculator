/* ============================================================
   Module: Pretreatment (Design › Pretreatment) — Pretreatment PRD v0.2,
   equations.md §11. Train builder (include / remove / order steps) and one
   page per unit: chemical dosing, DAF, sedimentation, media filters, bag
   filters, cartridge filters. Flow typed per unit. Equipment from
   Libraries › Equipment (vendor / consultant list, generic placeholders).
   ============================================================ */
(function (RO) {
"use strict";

const C = RO.pretreatCalc;
const U = RO.units;
const EQ = RO.equiplib;
const { escHtml: esc } = RO.util;
const DRAFT_KEY = "rocalc.pretreat.draft";

let ROOT = null, META = null, TABS = null, ACTIONS = null;
let S = C.defaultState();
let tab = "overview";
let R = null, F = null;
let dirty = false, savedAt = null;

const META_TXT = {
  overview: "Train: include, remove and order the pretreatment steps",
  dosing: "Dose → product flow, consumption, storage (site / SDS) and dosing pumps",
  daf: "Coagulation, flocculation and dissolved air flotation on the net flow",
  sedimentation: "Coagulation, flocculation and conventional or lamella settling",
  media: "Dual / tri-media filters: N−1 rates, L/dₑ bed depth, backwash",
  bag: "Bag filters from the equipment list",
  cartridge: "Cartridge filters from the equipment list",
  steps: "Every formula with its substituted values (SI units)"
};
const stepLabel = id => (C.STEPS.find(s => s.id === id) || { label: id }).label;
const pages = () => [{ id: "overview", label: "Overview" }].concat(S.train.filter(t => t.on).map(t => ({ id: t.id, label: stepLabel(t.id) })), [{ id: "steps", label: "Calculation steps" }]);

/* ================= helpers ================= */
const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const section = (num, title, body, extra = "") =>
  `<section class="blueprint in-sec">${corners()}<div class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2>${extra}</div>${body}</section>`;
const blank = C.blank;
const wu = (q, v, d) => U.withUnit(q, v, d);
const fx = (q, v, d) => U.fmt(q, v, d);
function getP(p) { return p.split(".").reduce((a, k) => (a == null ? a : a[k]), S); }
function setP(p, v) { const ks = p.split("."), last = ks.pop(); ks.reduce((a, k) => a[k], S)[last] = v; }
const kpiHtml = list => `<div class="kpis">${list.map(k => `<div class="kpi"><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v">${esc(k.value)}</div><div class="kpi-u">${esc(k.unit)}</div></div>`).join("")}</div>`;
const row = (label, value, unit, strong) => `<tr${strong ? ' class="strong"' : ""}><td>${esc(label)}</td><td class="r">${esc(value)}</td><td class="u">${esc(unit || "")}</td></tr>`;
function checksHtml(list) {
  return `<div class="res-checks">${list.map(c => {
    const tag = c.status === "pass" ? "OK" : c.status === "note" ? "NOTE" : "CHECK";
    const cls = c.status === "pass" ? "tag-accent" : c.status === "note" ? "tag-neutral" : c.status === "warn" ? "tag-outline" : "tag-solid";
    return `<div class="res-check"><span class="tag ${cls}">${tag}</span><span>${esc(c.text)}</span></div>`;
  }).join("")}</div>`;
}

/* Field: path in S, label, unit quantity (RO.units) or "none" with o.unit, recommended-value key (or function) */
function fld(path, label, q, recKey, o = {}) {
  const v = getP(path), isBlank = blank(v);
  const rec = recKey ? (typeof recKey === "function" ? recKey() : RO.values.get(recKey)) : null;
  const hasRec = rec !== null && rec !== undefined && isFinite(rec);
  const unit = q === "none" ? (o.unit || "") : U.label(q);
  const recTxt = hasRec ? (q === "none" ? String(+(+rec).toFixed(3)) : fx(q, rec, o.dp)) : "";
  const value = isBlank ? "" : (q === "none" ? String(v) : U.inputValue(q, v));
  const err = !isBlank && !isFinite(v) ? "Enter a valid number" : (o.req && isBlank && !hasRec ? "Required" : "");
  const src = hasRec && typeof recKey === "string" ? ((RO.values.meta(recKey) || {}).source || "") : (o.why || "");
  const help = err || (isBlank && hasRec ? `Blank uses ${recTxt}${unit ? " " + unit : ""}${src ? " — " + src : ""}.` : hasRec ? `Recommended ${recTxt}${unit ? " " + unit : ""}. Clear to use it.` : (o.hint || ""));
  const cls = err ? " is-err" : (isBlank && hasRec ? " is-rec" : "");
  const id = "pt_" + path.replace(/\./g, "_");
  return `<div class="field in-field${cls}" data-fwrap="${path}">
    <label for="${id}"><span>${esc(label)}</span><span class="unit">${esc(unit)}</span></label>
    <div class="in-wrap"><input class="input" id="${id}" inputmode="decimal" data-p="${path}" data-q="${q}"${o.int ? ' data-int="1"' : ""} value="${esc(value)}" placeholder="${isBlank && hasRec ? esc(recTxt) : ""}" aria-label="${esc(label)}">
      ${isBlank && hasRec ? '<span class="tag tag-accent rec-tag">REC</span>' : ""}</div>
    <div class="in-help">${esc(help)}</div></div>`;
}
const grid = html => `<div class="in-grid">${html}</div>`;
function sel(path, label, options, hint) {
  const v = getP(path);
  return `<div class="field in-field in-select"><label for="pts_${path.replace(/\./g, "_")}"><span>${esc(label)}</span></label>
    <select class="input" id="pts_${path.replace(/\./g, "_")}" data-sel="${path}">${options.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
    ${hint ? `<div class="in-help">${esc(hint)}</div>` : ""}</div>`;
}
const chk = (path, label) => `<label class="pl-check"><input type="checkbox" data-chk="${path}"${getP(path) ? " checked" : ""}><span>${label}</span></label>`;

/* Equipment picker: select from the list (+ custom), "+ Add to list" opens the Libraries editor */
function picker(path, category, label, allowCustom) {
  const cur = getP(path);
  const list = EQ.cached(category);
  const opts = list.map(e => `<option value="${esc(e.id)}"${cur && String(cur.id) === String(e.id) ? " selected" : ""}>${esc(e.vendor)} ${esc(e.model)} — ${esc(EQ.describe(e))}${e.origin === "generic" ? " (generic)" : e.status === "draft" ? " (draft)" : ""}</option>`).join("");
  const stale = cur && !list.some(e => String(e.id) === String(cur.id)) ? `<option value="${esc(cur.id)}" selected>${esc(cur.vendor)} ${esc(cur.model)} (saved copy)</option>` : "";
  return `<div class="field in-field in-select pt-picker"><label for="pk_${path.replace(/\./g, "_")}"><span>${esc(label)}</span></label>
    <div class="pt-pick-row"><select class="input" id="pk_${path.replace(/\./g, "_")}" data-pick="${path}" data-cat="${category}">
      ${allowCustom ? `<option value=""${!cur ? " selected" : ""}>Custom (typed below)</option>` : ""}${stale}${opts}</select>
      <button class="btn btn-secondary btn-sm" data-act="addequip" data-cat="${category}" data-path="${path}">+ Add to list</button></div>
    <div class="in-help">${cur ? esc(`${cur.vendor} ${cur.model} · ${EQ.describe({ category, specs: cur.specs })}`) : "Libraries › Equipment holds the vendor / consultant list"}${cur && cur.vendor === "Generic" ? " — generic placeholder, replace with vendor data" : ""}</div></div>`;
}

/* ================= page sections ================= */
function overviewLeft() {
  const rows = S.train.map((t, i) => `<tr class="${t.on ? "" : "pt-off"}">
      <td class="c"><input type="checkbox" data-train="${i}"${t.on ? " checked" : ""} aria-label="Include ${esc(stepLabel(t.id))}"></td>
      <td>${i + 1}. ${esc(stepLabel(t.id))}</td><td class="dim" data-out="ov:${t.id}">${t.on ? "" : "not included"}</td>
      <td class="r nowrap"><button class="icon-btn" data-act="tup" data-i="${i}" title="Move up">↑</button><button class="icon-btn" data-act="tdown" data-i="${i}" title="Move down">↓</button>
        ${t.on ? `<a class="icon-btn" href="#/pretreat/${t.id}">Open</a>` : ""}</td></tr>`).join("");
  return section("01", "Train", `<p class="dim">Tick the steps this plant uses and put them in flow order. Each included step gets its own page; flows are typed per unit.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th class="c">Include</th><th>Step</th><th>Summary</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

function coagSection(num, unit) {
  const p = unit + ".coag";
  return section(num, "Coagulation & flocculation", `
    ${chk(p + ".inline", "In-line coagulation (static mixer — no rapid-mix tank)")}
    ${grid((getP(p + ".inline") ? "" : fld(p + ".rapid_t", "Rapid mix time", "none", "pt.rapid_t_s", { unit: "s" }) + fld(p + ".rapid_G", "Rapid mix G", "none", "pt.rapid_G", { unit: "1/s" })) +
      fld(p + ".floc_t", "Flocculation time", "none", unit === "daf" ? "pt.floc_t_daf_min" : "pt.floc_t_sed_min", { unit: "min" }) +
      fld(p + ".floc_G", "Flocculation G", "none", "pt.floc_G", { unit: "1/s" }) +
      fld(p + ".stages", "Flocculation stages", "none", null, { int: true, hint: "Tanks in series" }) +
      fld(unit + ".dose_fecl3", "Coagulant dose (for sludge)", "none", null, { unit: "mg/L", hint: "As FeCl₃ — see Chemical dosing" }))}`);
}
function dafLeft() {
  return section("01", "Flow & units", grid(fld("daf.Q", "Net flow (to filters)", "flow", null, { req: true, hint: "Clarified water leaving the DAF" }) + fld("daf.N", "DAF units", "none", null, { int: true, hint: "Rate with one unit out is checked" }))) +
    coagSection("02", "daf") +
    section("03", "Flotation", grid(fld("daf.hlr", "Hydraulic loading rate (net)", "rate", "pt.daf_hlr") + fld("daf.recovery", "Recovery", "none", "pt.daf_recovery_pct", { unit: "%" }) +
      fld("daf.recycle", "Recycle ratio", "none", "pt.daf_recycle_pct", { unit: "%" }) + fld("daf.psat", "Saturator pressure", "press", "pt.daf_psat_bar") +
      fld("daf.sateff", "Saturator efficiency", "none", "pt.daf_sat_eff") + fld("daf.contact", "Contact zone time", "none", "pt.daf_contact_min", { unit: "min" }) +
      fld("daf.depth", "Separation depth", "elev", "pt.daf_depth_m") + fld("daf.lw", "Length : width", "none", "pt.daf_lw"))) +
    section("04", "Solids", grid(fld("daf.tss", "Feed TSS", "none", null, { unit: "mg/L" }) + fld("daf.removal", "TSS removal", "none", "pt.daf_tss_removal_pct", { unit: "%" })));
}
function sedLeft() {
  const lam = S.sedimentation.type !== "conventional";
  return section("01", "Flow & basins", grid(fld("sedimentation.Q", "Flow", "flow", null, { req: true }) + fld("sedimentation.N", "Basins", "none", null, { int: true }) +
      sel("sedimentation.type", "Type", [["lamella", "Lamella (plate) settler"], ["conventional", "Conventional rectangular"]]))) +
    coagSection("02", "sedimentation") +
    section("03", "Basin", grid((lam ? fld("sedimentation.rate", "Loading (basin plan area)", "rate", "pt.sed_lamella_rate") + fld("sedimentation.plate", "Plate angle", "none", "pt.sed_plate_deg", { unit: "°" })
      : fld("sedimentation.rate", "Surface overflow rate", "rate", "pt.sed_conv_rate") + fld("sedimentation.detention", "Detention time", "none", "pt.sed_detention_h", { unit: "h" })) +
      fld("sedimentation.lw", "Length : width", "none", "pt.sed_lw"))) +
    section("04", "Solids", grid(fld("sedimentation.tss", "Feed TSS", "none", null, { unit: "mg/L" }) + fld("sedimentation.removal", "TSS removal", "none", "pt.sed_tss_removal_pct", { unit: "%" })));
}
function mediaLeft() {
  const m = S.media, grav = m.type === "gravity";
  const ld = C.ldRatio(m);
  const layer = (k, name) => fld(`media.${k}.depth`, `${name} depth`, "elev", `pt.${k === "anth" ? "anth" : k}_depth_m`) + fld(`media.${k}.es`, `${name} effective size`, "none", `pt.${k === "anth" ? "anth" : k}_es_mm`, { unit: "mm" });
  return section("01", "Flow & type", grid(fld("media.Q", "Net filtrate flow", "flow", null, { req: true, hint: "To the cartridge filters / RO; backwash water is added" }) +
      sel("media.type", "Filter type", [["pressure", "Pressure filters"], ["gravity", "Gravity filters"]], "Voutchkov: pressure < 20,000 m³/d, gravity any size") +
      fld("media.N", "Number of filters", "none", null, { int: true, hint: "Blank = smallest N meeting the rates (N−1 rule)" }))) +
    section("02", "Filter size", grav ? grid(fld("media.cell_L", "Cell length", "elev", null, { req: true }) + fld("media.cell_W", "Cell width", "elev", null, { req: true }))
      : picker("media.vessel", "mmf_vessel", "Vessel (equipment list)", true) + (m.vessel ? "" : grid(fld("media.custom_d", "Custom vessel diameter", "elev", "pt.mmf_diameter_m")))) +
    section("03", "Filtration rates", grid(fld("media.rate_normal", "Normal rate (all in service)", "rate", "pt.mmf_rate_normal") + fld("media.rate_max", "Maximum rate with N−1", "rate", "pt.mmf_rate_max"))) +
    section("04", "Media — L/dₑ bed depth", `
      <div class="in-grid">${sel("media.media", "Bed", [["dual", "Dual media (anthracite + sand)"], ["tri", "Tri-media (+ garnet)"]])}</div>
      ${chk("media.fine", "Filtrate < 0.1 NTU (+15 % L/dₑ)")}
      ${grid(layer("anth", "Anthracite") + layer("sand", "Sand") + (m.media === "tri" ? layer("garnet", "Garnet") : ""))}
      <div class="in-suggest"><span class="dim">Σ L/dₑ = <strong data-out="ldsum">${Math.round(ld.sum)}</strong> against ${Math.round(ld.target)} (McGivney & Kawamura: 1,000 dual / 1,250 tri-media${m.fine ? ", × 1.15" : ""}).</span>
        ${ld.scale > 1.005 ? `<button class="btn btn-secondary btn-sm" data-act="ldscale">Deepen layers to L/dₑ ${Math.round(ld.target)}</button>` : ""}</div>`) +
    section("05", "Backwash", grid(fld("media.bw_rate", "Backwash water rate", "rate", "pt.bw_rate") + fld("media.bw_min", "Backwash duration", "none", "pt.bw_min", { unit: "min" }) +
      fld("media.air_rate", "Air scour rate", "arate", "pt.air_rate") + fld("media.air_min", "Air scour duration", "none", "pt.air_min", { unit: "min" }) +
      fld("media.rinse_min", "Rinse duration", "none", "pt.rinse_min", { unit: "min" }) + fld("media.run_h", "Filter run", "none", "pt.run_h", { unit: "h" }) +
      fld("media.loss_max", "Maximum water loss", "none", "pt.bw_loss_max_pct", { unit: "%" })));
}
function bagLeft() {
  return section("01", "Flow", grid(fld("bag.Q", "Flow", "flow", null, { req: true }) + fld("bag.standby", "Standby housings", "none", "pt.bag_standby", { int: true }) +
      fld("bag.months", "Change-out interval", "none", null, { unit: "months", hint: "Optional — gives bags per year" }) + fld("bag.change_bar", "Change-out ΔP", "press", "pt.bag_change_bar"))) +
    section("02", "Bag element", picker("bag.element", "bag_element", "Bag element (equipment list)", false)) +
    section("03", "Housing", picker("bag.housing", "bag_housing", "Bag filter housing (equipment list)", false));
}
function cartridgeLeft() {
  const el = S.cartridge.element && S.cartridge.element.specs;
  const q10rec = () => (el && el.q10_m3h ? el.q10_m3h : RO.values.get("pt.cf_q10"));
  return section("01", "Flow", grid(fld("cartridge.Q", "Flow", "flow", null, { req: true }) +
      (el && el.type === "high_flow" ? "" : fld("cartridge.q10", "Flow per 10-inch length", "flow", q10rec, { dp: 2, why: el && el.q10_m3h ? "element rating from the list" : "PRD v0.2 decision" })) +
      fld("cartridge.standby", "Standby housings", "none", "pt.cf_standby", { int: true }) + fld("cartridge.months", "Replacement interval", "none", "pt.cf_months", { unit: "months" }) +
      fld("cartridge.replace_bar", "Replacement ΔP", "press", "pt.cf_replace_bar"))) +
    section("02", "Element", picker("cartridge.element", "cartridge_element", "Cartridge element (equipment list)", false)) +
    section("03", "Housing", picker("cartridge.housing", "cartridge_housing", "Cartridge housing (equipment list)", true) +
      (S.cartridge.housing ? "" : grid(fld("cartridge.elements_custom", "Elements per housing", "none", "pt.cf_elements_housing", { int: true }))));
}
function dosingLeft() {
  const rows = S.dosing.rows.map((c, i) => {
    const num = (k, q, w) => `<td><input class="input ${w || "w-s"}" data-chem="${i}:${k}" data-q="${q}" value="${esc(blank(c[k]) ? "" : q === "none" ? c[k] : U.inputValue(q, c[k]))}"${k === "dose" && c.kind === "smbs" ? ` placeholder="${(RO.values.get("pt.smbs_ratio") * RO.values.get("pt.cl2_residual")).toFixed(2)}"` : ""}${k === "days" ? ' placeholder="site"' : ""}></td>`;
    return `<tr class="${c.on ? "" : "pt-off"}"><td class="c"><input type="checkbox" data-chemon="${i}"${c.on ? " checked" : ""} aria-label="Include ${esc(c.name)}"></td>
      <td><input class="input" data-chem="${i}:name" data-q="text" value="${esc(c.name)}"></td><td><input class="input" data-chem="${i}:point" data-q="text" value="${esc(c.point)}"></td>
      ${num("Q", "flow")}${num("dose", "none")}${num("dose_max", "none")}<td><input class="input w-s" data-chem="${i}:basis" data-q="text" value="${esc(c.basis)}"></td>
      ${num("strength_pct", "none")}${num("rho", "none")}${num("dilution_pct", "none")}${num("days", "none")}
      <td><input class="input" data-chem="${i}:sds" data-q="text" value="${esc(c.sds || "")}"></td>
      <td class="r"><button class="icon-btn del" data-act="chemdel" data-i="${i}" aria-label="Remove ${esc(c.name)}">×</button></td></tr>`;
  }).join("");
  return section("01", "Chemicals", `
    <div class="toolbar-row"><button class="btn btn-secondary btn-sm" data-act="chemadd">+ Chemical</button><span class="dim">Strength, density and storage from the supplier SDS and site requirements. SMBS blank dose = ${RO.values.get("pt.smbs_ratio")} × ${RO.values.get("pt.cl2_residual")} mg/L chlorine residual.</span></div>
    <div class="table-wrap"><table class="table seg-table pt-chem"><thead><tr><th class="c">On</th><th>Chemical</th><th>Dosing point</th><th>Flow ${U.label("flow")}</th><th>Dose mg/L</th><th>Max mg/L</th><th>Dose basis</th>
      <th>Strength %</th><th>Density kg/L</th><th>Dilute to %</th><th>Storage days</th><th>SDS / notes</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`) +
    section("02", "Results per chemical", `<div class="table-wrap" data-out="chemtable"></div>`);
}

/* ================= check texts ================= */
function checkText(unit, c) {
  const P = v => wu("press", v);
  switch (unit + ":" + c.key) {
    case "daf:hlr": return `Loading ${wu("rate", c.v)} ${c.status === "pass" ? "within" : "outside"} ${fx("rate", c.lo)}–${wu("rate", c.hi)} (conventional to high-rate DAF).`;
    case "daf:n1": return `Loading with one unit out ${wu("rate", c.v)} ${c.status === "pass" ? "≤" : ">"} ${wu("rate", c.hi)}.`;
    case "daf:floc": return `Flocculation ${c.v} min ${c.status === "pass" ? "within" : "outside"} ${c.lo}–${c.hi} min.`;
    case "daf:recovery": return `Float / drain loss ${wu("flow", c.loss)} (recovery ${(c.r * 100).toFixed(1)} %) — the inflow is net ÷ recovery.`;
    case "sedimentation:rate": return `${c.lamella ? "Lamella loading" : "Overflow rate"} ${wu("rate", c.v)} ${c.status === "pass" ? "within" : "outside"} ${fx("rate", c.lo)}–${wu("rate", c.hi)}.`;
    case "sedimentation:td": return `Detention ${c.v} h ${c.status === "pass" ? "within" : "outside"} ${c.lo}–${c.hi} h.`;
    case "sedimentation:plate": return `Plate angle ${c.v}° ${c.status === "pass" ? "within" : "outside"} 50–70° (self-cleaning).`;
    case "sedimentation:weir": return `Weir length at least ${U.fmt("len", c.v)} ${U.label("len")} for ${wu("wload", c.wmax)}.`;
    case "media:vN": return `Rate with all ${c.N} filters ${wu("rate", c.v)} ${c.status === "pass" ? "≤" : ">"} normal ${wu("rate", c.lim)}.`;
    case "media:vN1": return `Rate with ${c.N - 1} filters (one backwashing) ${wu("rate", c.v)} ${c.status === "pass" ? "≤" : ">"} maximum ${wu("rate", c.lim)}.`;
    case "media:vendor": return `N−1 rate ${c.status === "pass" ? "within" : "above"} the vendor's maximum ${wu("rate", c.lim)}.`;
    case "media:ld": return `Bed L/dₑ ${Math.round(c.v)} ${c.status === "pass" ? "≥" : "<"} ${Math.round(c.lim)} (${c.tri ? "tri-media" : "dual media"}${c.fine ? ", < 0.1 NTU" : ""}).`;
    case "media:loss": return `Backwash water loss ${c.v.toFixed(2)} % ${c.status === "pass" ? "≤" : ">"} ${c.lim} %.`;
    case "media:pressure": return `Pressure filters for ${wu("flow", c.v)} (${Math.round(c.v * 24).toLocaleString("en-GB")} m³/d) — Voutchkov uses pressure filters below 20,000 m³/d and gravity filters for larger plants.`;
    case "media:vN2": return `With two filters out (backwash + maintenance) the rate is ${wu("rate", c.v)} — for information.`;
    case "bag:load": case "cartridge:load": return `Flow per ${unit === "bag" ? "bag" : "element"} ${wu("flow", c.v, 2)} ${c.status === "pass" ? "≤" : ">"} rated ${wu("flow", c.lim, 2)}.`;
    case "bag:hmax": case "cartridge:hmax": return `Flow per housing ${wu("flow", c.v)} ${c.status === "pass" ? "≤" : ">"} housing maximum ${wu("flow", c.lim)}.`;
    case "bag:micron": return `Bag rating ${c.bag} µm is not coarser than the cartridge rating ${c.cf} µm — the bags would take the cartridges' job.`;
    case "cartridge:len": return `Housing is for ${c.h}" elements, the element is ${c.e}".`;
    case "cartridge:months": return `Replacement every ${c.v} months ${c.status === "pass" ? "meets" : "exceeds"} the FilmTec guidance of at least every 3 months.`;
    case "cartridge:micron": return `Rating ${c.v} µm ${c.status === "pass" ? "≤" : ">"} 10 µm (FilmTec minimum; 5 µm absolute recommended).`;
    default: return c.key;
  }
}
const unitChecks = (unit, r) => (r && !r.error ? r.checks.map(c => ({ status: c.status, text: checkText(unit, c) })) : [{ status: "fail", text: r ? r.error : "Not computed" }]);

/* ================= results column ================= */
function resultsHtml() {
  const head = (t, x) => `<div class="res-head"><h2>${esc(t)}</h2><span class="dim">${esc(x || "")}</span></div>`;
  if (tab === "overview") {
    const all = [];
    S.train.filter(t => t.on && t.id !== "dosing").forEach(t => { const r = R[t.id]; if (r) unitChecks(t.id, r).forEach(c => all.push(Object.assign({}, c, { text: `${stepLabel(t.id)}: ${c.text}` }))); });
    const nCheck = all.filter(c => c.status === "fail" || c.status === "warn").length;
    const chem = R.dosing ? R.dosing.rows.filter(x => !x.off && !x.error) : [];
    return head("Results", "per unit, flows typed per unit") + kpiHtml([
      { label: "Steps", value: String(S.train.filter(t => t.on).length), unit: "included" },
      { label: "Checks", value: String(nCheck), unit: "to review" },
      { label: "Chemicals", value: String(chem.length), unit: "dosed" }]) + checksHtml(all.filter(c => c.status !== "pass").concat(all.filter(c => c.status === "pass")));
  }
  const r = R[tab];
  if (tab === "dosing") {
    const rows = r.rows.filter(x => !x.off);
    return head("Results", "average dose") + kpiHtml([
      { label: "Chemicals", value: String(rows.length), unit: "included" },
      { label: "Storage set", value: `${rows.filter(x => x.days != null).length} / ${rows.length}`, unit: "site days entered" },
      { label: "Product", value: U.fmt("kgd", rows.reduce((a, x) => a + (x.perDay || 0), 0), 0), unit: U.label("kgd") + " total" }]) +
      checksHtml([].concat(...rows.map(x => x.error ? [{ status: "fail", text: x.error }] : x.checks.map(c => ({ status: c.status, text: c.key === "days" ? `${x.c.name}: enter the storage days (site requirement / SDS).`
        : c.key === "smbs" ? `${x.c.name}: dose ${c.dose.toFixed(2)} mg/L ${c.status === "pass" ? "≥" : "<"} ${c.need.toFixed(2)} mg/L (3 × chlorine residual).`
        : `${x.c.name}: pump minimum ${wu("lph", c.min, 2)} at ${c.td} : 1 turndown ${c.status === "pass" ? "≤" : ">"} average ${wu("lph", c.avg, 2)}.` })))));
  }
  if (!r || r.error) return head("Results") + checksHtml(unitChecks(tab, r));
  if (tab === "daf") return head("Results", `${r.N} unit${r.N > 1 ? "s" : ""}`) + kpiHtml([
      { label: "Area per unit", value: U.fmt("area", r.A, 1), unit: U.label("area") }, { label: "Unit L × W", value: `${fx("elev", r.L, 1)} × ${fx("elev", r.W, 1)}`, unit: U.label("elev") },
      { label: "Air dose", value: r.air.toFixed(1), unit: "g/m³" }]) +
    `<table class="table res-table"><tbody>${row("Inflow (net ÷ recovery)", fx("flow", r.Qin), U.label("flow"))}${row("Float / drain loss", fx("flow", r.loss), U.label("flow"))}
      ${row("Recycle flow", fx("flow", r.Qr), U.label("flow"))}${row("Rapid mix volume" + (r.coag.inline ? " (in-line)" : ""), fx("vol", r.coag.Vr, 1), U.label("vol"))}
      ${row("Flocculation volume (total)", fx("vol", r.coag.Vf), U.label("vol"))}${row("Mixer power (rapid + floc)", fx("power", r.coag.Pr + r.coag.Pf, 2), U.label("power"))}
      ${row("Contact zone volume per unit", fx("vol", r.Vc, 1), U.label("vol"))}${row("Separation volume per unit", fx("vol", r.Vs), U.label("vol"))}
      ${row("Rate with one unit out", r.rateN1 != null ? fx("rate", r.rateN1) : "—", U.label("rate"))}
      ${row("Float solids", fx("kgd", r.sludge), U.label("kgd"), true)}${row(`Float volume at ${RO.values.get("pt.sludge_solids_pct")} % solids`, fx("vol", r.sludgeVol, 1), U.label("vol") + "/d")}</tbody></table>` + checksHtml(unitChecks("daf", r));
  if (tab === "sedimentation") return head("Results", r.lamella ? "lamella" : "conventional") + kpiHtml([
      { label: "Area", value: U.fmt("area", r.A, 0), unit: U.label("area") + " total" }, { label: "Basin L × W", value: `${fx("elev", r.L, 1)} × ${fx("elev", r.W, 1)}`, unit: `${U.label("elev")} × ${r.N}` },
      { label: r.lamella ? "Plate angle" : "Depth", value: r.lamella ? `${r.plate}°` : fx("elev", r.depth, 1), unit: r.lamella ? "" : U.label("elev") }]) +
    `<table class="table res-table"><tbody>${row("Area per basin", fx("area", r.Ab, 1), U.label("area"))}${r.V ? row("Basin volume (total)", fx("vol", r.V), U.label("vol")) : ""}
      ${row("Flocculation volume", fx("vol", r.coag.Vf), U.label("vol"))}${row("Mixer power", fx("power", r.coag.Pr + r.coag.Pf, 2), U.label("power"))}
      ${row("Minimum weir length", fx("len", r.weirMin), U.label("len"))}${row("Sludge solids", fx("kgd", r.sludge), U.label("kgd"), true)}${row("Sludge volume", fx("vol", r.sludgeVol, 1), U.label("vol") + "/d")}</tbody></table>` + checksHtml(unitChecks("sedimentation", r));
  if (tab === "media") return head("Results", r.fa.label) + kpiHtml([
      { label: "Filters", value: String(r.N), unit: `${fx("area", r.A, 2)} ${U.label("area")} each` }, { label: "Rate N−1", value: fx("rate", r.vN1), unit: U.label("rate") + ` · N ${fx("rate", r.vN)}` },
      { label: "Water loss", value: r.lossPct.toFixed(2), unit: "% backwash + rinse" }]) +
    `<table class="table res-table"><tbody>${row("Gross feed (net + backwash water)", fx("flow", r.Qg), U.label("flow"))}${row("Total filter area", fx("area", r.Atot, 1), U.label("area"))}
      ${row("EBCT", r.ebct.toFixed(1), "min")}${row("Backwash pump", fx("flow", r.Qbw), U.label("flow"))}${row("Air blower", fx("aflow", r.Qair), U.label("aflow"))}
      ${row("Water per wash (backwash + rinse)", fx("vol", r.Vbw, 1), U.label("vol"))}${row("Backwash water per day", fx("vol", r.Vday), U.label("vol"))}
      ${row("Backwash tank (one wash)", fx("vol", r.Vbw, 1), U.label("vol"), true)}
      ${r.layers.map(l => row(`${{ anth: "Anthracite", sand: "Sand", garnet: "Garnet" }[l.key]} ${fx("elev", l.depth)} ${U.label("elev")}, ES ${l.es} mm`, `${fx("vol", l.V, 1)} ${U.label("vol")} · ${l.t.toFixed(1)} t`, "")).join("")}</tbody></table>` +
    checksHtml(unitChecks("media", r));
  if (tab === "bag") return head("Results", `${r.micron} µm`) + kpiHtml([
      { label: "Bags", value: String(r.n), unit: `required · ${r.installed} installed` }, { label: "Housings", value: `${r.nh} + ${r.sb}`, unit: `duty + standby × ${r.k} bags` },
      { label: "Per bag", value: fx("flow", r.q, 1), unit: U.label("flow") }]) +
    `<table class="table res-table"><tbody>${row("Rated flow per bag", fx("flow", r.qb, 1), U.label("flow"))}${row("Bags per year", r.perYear != null ? Math.ceil(r.perYear).toLocaleString("en-GB") : "enter the interval", "")}${row("Change-out ΔP", fx("press", r.change), U.label("press"))}</tbody></table>` + checksHtml(unitChecks("bag", r));
  if (tab === "cartridge") return head("Results", `${r.micron} µm · ${r.len}"`) + kpiHtml([
      { label: "Elements", value: r.n.toLocaleString("en-GB"), unit: `required · ${r.installed.toLocaleString("en-GB")} installed` }, { label: "Housings", value: `${r.nh} + ${r.sb}`, unit: `duty + standby × ${r.k}` },
      { label: "Per element", value: fx("flow", r.q, 2), unit: U.label("flow") }]) +
    `<table class="table res-table"><tbody>${row(r.high ? "Rated flow per element" : `Rated flow (${fx("flow", r.q10, 2)} per 10" × ${r.len / 10})`, fx("flow", r.qe, 2), U.label("flow"))}
      ${row(`Elements per year (replaced every ${r.months} months)`, Math.ceil(r.perYear).toLocaleString("en-GB"), "")}${row("Replacement ΔP", fx("press", r.replace), U.label("press"))}</tbody></table>` + checksHtml(unitChecks("cartridge", r));
  return "";
}

function chemTable() {
  const rows = R.dosing.rows.filter(x => !x.off);
  return `<table class="table"><thead><tr><th>Chemical</th><th class="r">Dose avg / max</th><th class="r">Active</th><th class="r">Product</th><th class="r">Dosed stream</th><th class="r">Pump capacity</th><th class="r">Per day</th><th class="r">Per month</th><th class="r">Storage</th></tr></thead><tbody>` +
    rows.map(x => x.error ? `<tr><td>${esc(x.c.name)}</td><td colspan="8" class="dim">${esc(x.error)}</td></tr>` :
      `<tr><td>${esc(x.c.name)} <span class="dim">${esc(x.c.basis)}</span></td><td class="r">${x.dose.toFixed(2)} / ${x.doseMax.toFixed(2)} mg/L</td><td class="r">${wu("kgh", x.ma)}</td>
      <td class="r">${wu("lph", x.Vp, 2)}</td><td class="r">${x.dil ? wu("lph", x.Vs, 1) + ` at ${x.c.dilution_pct} %` : "neat"}</td><td class="r">${wu("lph", x.cap, 1)} · ${x.pumps}</td>
      <td class="r">${wu("kgd", x.perDay)}</td><td class="r">${fx("vol", x.perMonth, 2)} ${U.label("vol")}</td><td class="r">${x.storage != null ? `${fx("vol", x.storage, 1)} ${U.label("vol")} (${x.days} d)` : '<span class="dim">site days?</span>'}</td></tr>`).join("") +
    `</tbody></table><p class="dim">Product = active ÷ strength; storage at the average dose. Pump capacity = ${RO.values.get("pt.dose_pump_margin")} × the maximum dose at the typed flow; duty + standby pumps per row.</p>`;
}

function overviewSummary() {
  S.train.forEach(t => {
    if (!t.on) return;
    const r = R[t.id];
    let s = "";
    if (t.id === "dosing") s = `${r.rows.filter(x => !x.off).length} chemicals`;
    else if (!r || r.error) s = r ? r.error : "";
    else if (t.id === "daf") s = `${wu("flow", r.Q)} net · ${r.N} × ${fx("area", r.A, 0)} ${U.label("area")} · ${wu("rate", r.hlr)}`;
    else if (t.id === "sedimentation") s = `${wu("flow", r.Q)} · ${r.N} × ${fx("elev", r.L, 1)} × ${fx("elev", r.W, 1)} ${U.label("elev")} ${r.lamella ? "lamella" : "conventional"}`;
    else if (t.id === "media") s = `${wu("flow", r.Qn)} net · ${r.N} filters (${r.fa.label}) · N−1 ${wu("rate", r.vN1)}`;
    else if (t.id === "bag") s = `${wu("flow", r.Q)} · ${r.nh} + ${r.sb} housings × ${r.k} bags`;
    else if (t.id === "cartridge") s = `${wu("flow", r.Q)} · ${r.nh} + ${r.sb} housings × ${r.k} elements (${r.micron} µm)`;
    const el = ROOT.querySelector(`[data-out="ov:${t.id}"]`);
    if (el) el.textContent = s;
  });
}

function stepsList() {
  const st = [], f = (v, d = 3) => (isFinite(v) ? (+v).toFixed(d) : "—");
  if (R.daf && !R.daf.error) { const r = R.daf; st.push({ head: "DAF (equations.md §11.1–11.2)" });
    st.push({ label: "Inflow", eq: "Q_in = Q_net / r", sub: `= ${f(r.Q, 1)} / ${f(r.r, 3)}`, res: `= ${f(r.Qin, 1)} m³/h` });
    st.push({ label: "Area per unit", eq: "A = (Q_net / N) / HLR", sub: `= (${f(r.Q, 1)} / ${r.N}) / ${f(r.hlr, 1)}`, res: `= ${f(r.A, 2)} m² (${f(r.L, 2)} × ${f(r.W, 2)} m)` });
    st.push({ label: "Flocculation", eq: "V = Q t · P = G² μ V", sub: `V = ${f(r.Qin, 1)} × ${r.coag.ft} / 60`, res: `V = ${f(r.coag.Vf, 1)} m³ · P = ${f(r.coag.Pf, 3)} kW` });
    st.push({ label: "Air dose", eq: "R s_a (f P_abs / P_atm − 1) / (1 + R)", sub: `${f(r.R, 3)} × ${RO.values.get("pt.air_sol_mgL")} × (${r.f} × ${f(r.psat + 1.01325, 3)} / 1.01325 − 1) / ${f(1 + r.R, 3)}`, res: `= ${f(r.air, 2)} g/m³` });
    st.push({ label: "Float solids", eq: "Q_in · 24 · (TSS · η + 0.659 · FeCl₃) / 1000", res: `= ${f(r.sludge, 1)} kg/d` }); }
  if (R.sedimentation && !R.sedimentation.error) { const r = R.sedimentation; st.push({ head: "Sedimentation (§11.3)" });
    st.push({ label: "Area", eq: "A = Q / SOR", sub: `= ${f(r.Q, 1)} / ${f(r.rate, 2)}`, res: `= ${f(r.A, 1)} m²; per basin ${f(r.Ab, 1)} m² (${f(r.L, 2)} × ${f(r.W, 2)} m)` });
    if (!r.lamella) st.push({ label: "Depth", eq: "h = SOR · t_d", sub: `= ${f(r.rate, 2)} × ${r.td}`, res: `= ${f(r.depth, 2)} m` });
    st.push({ label: "Weir", eq: "L_weir ≥ Q · 24 / WLR_max", res: `= ${f(r.weirMin, 1)} m` }); }
  if (R.media && !R.media.error) { const r = R.media; st.push({ head: "Media filters (§11.4)" });
    st.push({ label: "Filter area", eq: "A_f = π D² / 4 (or vendor / cell area)", res: `A_f = ${f(r.A, 3)} m² (${r.fa.label})` });
    st.push({ label: "Water per wash", eq: "V_bw = A_f (v_bw t_bw + v_n t_rinse) / 60", sub: `= ${f(r.A, 3)} × (${r.bw} × ${r.bwt} + ${r.vn} × ${r.rt}) / 60`, res: `= ${f(r.Vbw, 2)} m³` });
    st.push({ label: "Gross flow", eq: "Q_g = Q_net + N V_bw (24 / T_run) / 24", sub: `= ${f(r.Qn, 1)} + ${r.N} × ${f(r.Vbw, 2)} / ${r.run}`, res: `= ${f(r.Qg, 1)} m³/h (loss ${f(r.lossPct, 2)} %)` });
    st.push({ label: "Rates", eq: "v = Q_g / (n A_f)", res: `N = ${r.N}: ${f(r.vN, 2)} · N−1: ${f(r.vN1, 2)} m/h` });
    st.push({ label: "Bed depth (L/dₑ)", eq: "Σ L_i / d_e,i ≥ target", sub: r.layers.map(l => `${f(l.depth * 1000, 0)}/${l.es}`).join(" + "), res: `= ${f(r.ld.sum, 0)} vs ${f(r.ld.target, 0)}` }); }
  if (R.bag && !R.bag.error) { const r = R.bag; st.push({ head: "Bag filters (§11.4A)" });
    st.push({ label: "Bags and housings", eq: "n = ⌈Q / q_bag⌉ · n_h = ⌈n / k⌉", sub: `n = ⌈${f(r.Q, 1)} / ${r.qb}⌉ = ${r.n}; n_h = ⌈${r.n} / ${r.k}⌉`, res: `${r.nh} + ${r.sb} housings, ${f(r.q, 2)} m³/h per bag` }); }
  if (R.cartridge && !R.cartridge.error) { const r = R.cartridge; st.push({ head: "Cartridge filters (§11.5)" });
    st.push({ label: "Elements and housings", eq: "n = ⌈Q / (q₁₀ · L/10)⌉ · n_h = ⌈n / k⌉", sub: `n = ⌈${f(r.Q, 1)} / ${f(r.qe, 3)}⌉ = ${r.n}; n_h = ⌈${r.n} / ${r.k}⌉`, res: `${r.nh} + ${r.sb} housings, ${f(r.q, 3)} m³/h per element` }); }
  if (R.dosing) { st.push({ head: "Chemical dosing (§11.6)" });
    R.dosing.rows.filter(x => !x.off && !x.error).forEach(x => st.push({ label: x.c.name, eq: "ṁ_a = Q d / 1000 · V_p = ṁ_a / (w ρ)", sub: `${f(+x.c.Q, 1)} × ${f(x.dose, 2)} / 1000; w ${x.c.strength_pct} %, ρ ${x.c.rho}`, res: `${f(x.ma, 3)} kg/h active · ${f(x.Vp, 2)} L/h product` })); }
  return st;
}

/* ================= render ================= */
function renderPage() {
  if (!pages().some(p => p.id === tab)) tab = "overview";
  let left = "", right = `<aside class="in-right"><section class="blueprint in-sec in-results">${corners()}<div data-out="results"></div></section></aside>`;
  if (tab === "overview") left = overviewLeft();
  if (tab === "dosing") { left = dosingLeft(); }
  if (tab === "daf") left = dafLeft();
  if (tab === "sedimentation") left = sedLeft();
  if (tab === "media") left = mediaLeft();
  if (tab === "bag") left = bagLeft();
  if (tab === "cartridge") left = cartridgeLeft();
  if (tab === "steps") { left = section("01", "Calculation steps", `<div class="steps" id="pt-steps"></div>`); right = ""; }
  ROOT.innerHTML = `<div class="in-page"><div class="in-cols${right ? "" : " single"}${tab === "dosing" ? " pt-wide" : ""}"><div class="in-left">${left}</div>${right}</div></div>`;
  recalc();
}
function recalc() {
  F = RO.fluid.props();
  R = C.compute(S, F.error ? null : F);
  const box = ROOT.querySelector('[data-out="results"]');
  if (box) box.innerHTML = resultsHtml();
  if (tab === "overview") overviewSummary();
  if (tab === "dosing") { const el = ROOT.querySelector('[data-out="chemtable"]'); if (el) el.innerHTML = chemTable(); }
  if (tab === "media" && R.media) { const el = ROOT.querySelector('[data-out="ldsum"]'); if (el) el.textContent = Math.round(C.ldRatio(S.media).sum); }
  if (tab === "steps") RO.util.renderSteps("pt-steps", stepsList());
  renderActions();
}
function renderTabs() {
  TABS.innerHTML = pages().map(p => `<button class="tab${p.id === tab ? " active" : ""}" data-tab="${p.id}">${p.label}</button>`).join("");
  TABS.querySelectorAll("button.tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
}
function setTab(t, fromRoute) {
  tab = pages().some(p => p.id === t) ? t : "overview";
  renderTabs();
  if (!fromRoute && RO.app.isActive("pretreat")) history.replaceState(null, "", "#/pretreat/" + tab);
  META.textContent = "Standalone · " + META_TXT[tab];
  renderPage();
  RO.app.refresh();
}

/* ================= actions ================= */
function renderActions() {
  if (!ACTIONS) return;
  const tagTxt = savedAt ? (dirty ? "Unsaved changes" : "Local draft") : "Not saved";
  ACTIONS.innerHTML = `<span class="tag ${savedAt && !dirty ? "tag-outline" : "tag-neutral"} top-tag">${tagTxt}</span>
    ${savedAt ? `<span class="dim">Saved ${esc(savedAt)} on this device</span>` : ""}
    <button class="btn btn-secondary" data-act="savedraft">Save on this device</button>`;
}
function saveDraft() {
  try {
    const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: t, state: S }));
    savedAt = t; dirty = false; renderActions(); RO.ui.toast("Draft saved on this device", "ok");
  } catch (e) { RO.ui.toast("This browser does not allow saving drafts", "error"); }
}
const markDirty = () => { if (!dirty) { dirty = true; renderActions(); } };

function refreshField(path) {
  const wrap = ROOT.querySelector(`[data-fwrap="${path}"]`);
  if (!wrap) return;
  const inp = wrap.querySelector("input");
  const tmp = document.createElement("div");
  // rebuild with the same label/options by re-rendering the page section is heavy; update REC state in place
  const isBlank = blank(getP(path));
  const recTag = wrap.querySelector(".rec-tag");
  if (!isBlank && recTag) { recTag.remove(); wrap.classList.remove("is-rec"); wrap.querySelector(".in-help").textContent = inp.placeholder ? `Recommended ${inp.placeholder}. Clear to use it.` : wrap.querySelector(".in-help").textContent; }
  if (isBlank && !recTag && inp.placeholder) { tmp.innerHTML = '<span class="tag tag-accent rec-tag">REC</span>'; wrap.querySelector(".in-wrap").appendChild(tmp.firstChild); wrap.classList.add("is-rec"); wrap.querySelector(".in-help").textContent = `Blank uses ${inp.placeholder}.`; }
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.p) {
    const q = el.dataset.q;
    let v = el.value.trim() === "" ? null : (q === "none" ? Number(el.value.replace(/,/g, "")) : U.parse(q, el.value));
    if (v !== null && el.dataset.int && isFinite(v)) v = Math.max(0, Math.round(v));
    setP(el.dataset.p, v);
    refreshField(el.dataset.p);
    markDirty(); recalc(); return;
  }
  if (el.dataset.chem) {
    const [i, k] = el.dataset.chem.split(":"), c = S.dosing.rows[+i], q = el.dataset.q;
    if (q === "text") c[k] = el.value;
    else { const v = el.value.trim() === "" ? null : (q === "none" ? Number(el.value.replace(/,/g, "")) : U.parse(q, el.value)); c[k] = v === null || isFinite(v) ? v : c[k]; }
    markDirty(); recalc();
  }
}
function onChange(e) {
  const el = e.target;
  if (el.dataset.train !== undefined) { S.train[+el.dataset.train].on = el.checked; markDirty(); renderTabs(); renderPage(); return; }
  if (el.dataset.chemon !== undefined) { S.dosing.rows[+el.dataset.chemon].on = el.checked; markDirty(); renderPage(); return; }
  if (el.dataset.chk) { setP(el.dataset.chk, el.checked); markDirty(); renderPage(); return; }
  if (el.dataset.sel) { setP(el.dataset.sel, el.value); markDirty(); renderPage(); return; }
  if (el.dataset.pick) { setP(el.dataset.pick, el.value ? C.snap(el.value) || getP(el.dataset.pick) : null); markDirty(); renderPage(); }
}
function onClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b || (!ROOT.contains(b) && !ACTIONS.contains(b))) return;
  const a = b.dataset.act;
  if (a === "savedraft") { saveDraft(); return; }
  if (a === "addequip") {
    if (!RO.equipEditor) { RO.ui.toast("Open Libraries › Equipment to add entries", "warn"); return; }
    const path = b.dataset.path;
    RO.equipEditor.open({ category: b.dataset.cat }, saved => { EQ.list().then(() => { setP(path, { id: saved.id, vendor: saved.vendor, model: saved.model, specs: Object.assign({}, saved.specs) }); markDirty(); renderPage(); }); });
    return;
  }
  if (a === "tup" || a === "tdown") { const i = +b.dataset.i, j = a === "tup" ? i - 1 : i + 1; if (j >= 0 && j < S.train.length) [S.train[i], S.train[j]] = [S.train[j], S.train[i]]; markDirty(); renderTabs(); renderPage(); return; }
  if (a === "ldscale") {
    const ld = C.ldRatio(S.media);
    ld.layers.forEach(l => { S.media[l.key] = Object.assign({}, S.media[l.key], { depth: +(l.depth * ld.scale).toFixed(3) }); });
    markDirty(); renderPage(); return;
  }
  if (a === "chemadd") { S.dosing.rows.push(C.chem({ name: "New chemical", point: "", sds: "" })); markDirty(); renderPage(); return; }
  if (a === "chemdel") { S.dosing.rows.splice(+b.dataset.i, 1); markDirty(); renderPage(); }
}

/* ================= state / export ================= */
function getState() { return { state: JSON.parse(JSON.stringify(S)), tab }; }
function setState(st) {
  const d = C.defaultState(), s = st && st.state ? st.state : st || {};
  S = Object.assign(d, JSON.parse(JSON.stringify(s)));
  ["daf", "sedimentation", "media", "bag", "cartridge"].forEach(k => { S[k] = Object.assign(d[k], s[k] || {}); });
  if (!s.dosing) S.dosing = d.dosing;
  if (st && st.tab) tab = st.tab;
  if (ROOT) { renderTabs(); renderPage(); }
}
function equipmentCsv() {
  const rows = [];
  const add = (unit, item, qty, detail) => rows.push([unit, item, qty, detail]);
  if (R.daf && !R.daf.error) { const r = R.daf; add("DAF", `DAF unit ${fx("elev", r.L, 1)} × ${fx("elev", r.W, 1)} m, ${r.depth} m deep`, r.N, `${r.hlr} m/h net`); add("DAF", "Recycle pump", r.N, `${(r.Qr / r.N).toFixed(1)} m³/h each at ${r.psat} bar g`); }
  if (R.sedimentation && !R.sedimentation.error) { const r = R.sedimentation; add("Sedimentation", `${r.lamella ? "Lamella" : "Conventional"} basin ${r.L.toFixed(1)} × ${r.W.toFixed(1)} m`, r.N, `${r.rate} m/h`); }
  if (R.media && !R.media.error) { const r = R.media; add("Media filters", `Filter ${r.fa.label}`, r.N, `${r.A.toFixed(2)} m² each`); add("Media filters", "Backwash pump", 1, `${r.Qbw.toFixed(0)} m³/h`); add("Media filters", "Air blower", 1, `${r.Qair.toFixed(0)} Nm³/h`); add("Media filters", "Backwash tank", 1, `${r.Vbw.toFixed(1)} m³`);
    r.layers.forEach(l => add("Media filters", `${{ anth: "Anthracite", sand: "Sand", garnet: "Garnet" }[l.key]} ES ${l.es} mm`, `${l.V.toFixed(1)} m³`, `${l.t.toFixed(1)} t`)); }
  if (R.bag && !R.bag.error) { const r = R.bag, u = S.bag; add("Bag filters", `Housing ${u.housing.vendor} ${u.housing.model}`, r.nh + r.sb, `${r.nh} duty + ${r.sb} standby`); add("Bag filters", `Bag ${u.element.vendor} ${u.element.model}`, r.installed, r.perYear ? `${Math.ceil(r.perYear)} per year` : ""); }
  if (R.cartridge && !R.cartridge.error) { const r = R.cartridge, u = S.cartridge; add("Cartridge filters", `Housing ${u.housing ? u.housing.vendor + " " + u.housing.model : `custom ${r.k} elements`}`, r.nh + r.sb, `${r.nh} duty + ${r.sb} standby`); add("Cartridge filters", `Element ${u.element.vendor} ${u.element.model}`, r.installed, `${Math.ceil(r.perYear)} per year`); }
  if (R.dosing) R.dosing.rows.filter(x => !x.off && !x.error).forEach(x => { add("Dosing", `${x.c.name} dosing pump`, x.c.duty + x.c.standby, `${x.cap.toFixed(1)} L/h (${x.pumps})`); if (x.storage != null) add("Dosing", `${x.c.name} storage tank`, 1, `${x.storage.toFixed(1)} m³ (${x.days} d)`); });
  RO.csv.download(`pretreatment_equipment_${new Date().toISOString().slice(0, 10)}.csv`, RO.csv.stringify(["unit", "item", "quantity", "detail"], rows));
}

RO.registerModule({
  id: "pretreat",
  title: "Pretreatment",
  pageTitle: () => (tab === "overview" ? "Pretreatment" : tab === "steps" ? "Pretreatment calculation steps" : stepLabel(tab)),
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta; TABS = ctx.tabs; ACTIONS = ctx.actions;
    ROOT.classList.remove("mod-layout"); ROOT.classList.add("mod-scroll");
    ROOT.addEventListener("input", onInput); ROOT.addEventListener("change", onChange); ROOT.addEventListener("click", onClick);
    ACTIONS.addEventListener("click", onClick);
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); if (d && d.state) { setState({ state: d.state }); savedAt = d.savedAt; } } catch (e) { /* no draft */ }
    RO.units.subscribe(() => { if (ROOT) renderPage(); });
    RO.values.subscribe(() => { if (ROOT) renderPage(); });
    RO.fluid.subscribe(() => { if (ROOT && RO.app.isActive("pretreat")) recalc(); });
    EQ.subscribe(() => { EQ.list().then(() => { if (ROOT && RO.app.isActive("pretreat")) renderPage(); }); });
    EQ.list().then(() => { if (ROOT) renderPage(); });
    setTab(tab, true);
  },
  onShow() { renderPage(); },
  onRoute(sub) { if (sub && sub !== tab) setTab(sub, true); },
  reset() { savedAt = null; dirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } setState({ state: C.defaultState(), tab: "overview" }); },
  getState, setState,
  exportMenu: () => [
    { label: "Calculation file (JSON)", hint: "The whole train with every unit — re-import it later with Import", run: () => RO.csv.download(`pretreatment_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "RO Workbench", module: "pretreat", format: 1, exported_at: new Date().toISOString(), state: S, note: "SI: m³/h, m, m/h, mg/L, bar" }, null, 2), "application/json") },
    { label: "Equipment list (CSV)", hint: "Units, filters, housings, elements, pumps, blowers, tanks and media quantities", run: equipmentCsv },
    { label: "Print / PDF (A4)", hint: "Use the browser's print dialog → Save as PDF", run: () => window.print() }
  ],
  importJson(doc) { if (!doc || doc.module !== "pretreat" || !doc.state) throw new Error("Not a pretreatment export"); setState({ state: doc.state, tab }); markDirty(); }
});
})(window.RO = window.RO || {});
