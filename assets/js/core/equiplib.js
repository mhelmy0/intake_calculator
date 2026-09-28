/* ============================================================
   Pretreatment equipment list (Pretreatment PRD v0.2 §1A):
   MMF vessels, bag filter elements / housings, cartridge elements / housings.
   Sources, merged: bundled GENERIC entries (always available, flagged —
   replace with vendor data) · server entries (approved + own drafts) ·
   session-only entries (guests / offline, sessionStorage).
   All specs are SI (m, m², mm, bar, m³/h, m/h).
   ============================================================ */
(function (RO) {
"use strict";

/* field: [key, label, unit quantity (RO.units) | null, kind: "n" number · "i" integer · options[] select, required] */
const CATS = {
  mmf_vessel: { label: "MMF vessel", plural: "MMF vessels", fields: [
    ["orientation", "Orientation", null, ["vertical", "horizontal"], true],
    ["diameter_m", "Diameter", "elev", "n", true],
    ["shell_length_m", "Shell length (horizontal)", "elev", "n", false],
    ["area_m2", "Filtration area (blank = π D²/4 for vertical)", "area", "n", false],
    ["design_pressure_bar", "Design pressure", "press", "n", false],
    ["max_rate_m_h", "Vendor max. filtration rate", "rate", "n", false]] },
  bag_element: { label: "Bag filter element", plural: "Bag filter elements", fields: [
    ["size", "Bag size", null, ["#1", "#2", "#3", "#4", "custom"], false],
    ["micron", "Rating (µm)", null, "n", true],
    ["flow_m3h", "Rated flow per bag", "flow", "n", true],
    ["length_mm", "Length", "dia", "n", false]] },
  bag_housing: { label: "Bag filter housing", plural: "Bag filter housings", fields: [
    ["bags", "Bags per housing", null, "i", true],
    ["size", "Bag size", null, ["#1", "#2", "#3", "#4", "custom"], false],
    ["max_flow_m3h", "Max. flow", "flow", "n", false],
    ["design_pressure_bar", "Design pressure", "press", "n", false]] },
  cartridge_element: { label: "Cartridge element", plural: "Cartridge elements", fields: [
    ["type", "Type", null, ["standard", "high_flow"], true],
    ["length_in", "Length (inch)", null, "n", true],
    ["od_mm", "Outside diameter", "dia", "n", false],
    ["micron", "Rating (µm abs.)", null, "n", true],
    ["q10_m3h", "Rated flow per 10 inch", "flow", "n", false],
    ["flow_m3h", "Rated flow per element (high-flow)", "flow", "n", false]] },
  cartridge_housing: { label: "Cartridge housing", plural: "Cartridge housings", fields: [
    ["elements", "Max. elements", null, "i", true],
    ["length_in", "Element length (inch)", null, "n", false],
    ["max_flow_m3h", "Max. flow", "flow", "n", false],
    ["design_pressure_bar", "Design pressure", "press", "n", false]] }
};

const G = (id, category, model, specs, notes) => ({ id, category, vendor: "Generic", model, specs, notes: notes || "Generic entry — replace with vendor / consultant data", status: "generic", origin: "generic" });
const GENERIC = [
  G("g1", "mmf_vessel", "Vertical Ø2.0 m", { orientation: "vertical", diameter_m: 2.0, design_pressure_bar: 6 }),
  G("g2", "mmf_vessel", "Vertical Ø2.5 m", { orientation: "vertical", diameter_m: 2.5, design_pressure_bar: 6 }),
  G("g3", "mmf_vessel", "Vertical Ø3.0 m", { orientation: "vertical", diameter_m: 3.0, design_pressure_bar: 6 }),
  G("g4", "mmf_vessel", "Vertical Ø3.6 m", { orientation: "vertical", diameter_m: 3.6, design_pressure_bar: 6 }),
  G("g5", "mmf_vessel", "Horizontal Ø3.0 × 12 m", { orientation: "horizontal", diameter_m: 3.0, shell_length_m: 12, area_m2: 30, design_pressure_bar: 6 }, "Generic — horizontal bed area depends on the bed level; use the vendor figure"),
  G("g6", "bag_element", "#1 10 µm", { size: "#1", micron: 10, flow_m3h: 10, length_mm: 410 }),
  G("g7", "bag_element", "#2 10 µm", { size: "#2", micron: 10, flow_m3h: 20, length_mm: 810 }),
  G("g8", "bag_element", "#2 25 µm", { size: "#2", micron: 25, flow_m3h: 30, length_mm: 810 }),
  G("g9", "bag_housing", "Single #2", { bags: 1, size: "#2", design_pressure_bar: 10 }),
  G("g10", "bag_housing", "Multi-bag 4 × #2", { bags: 4, size: "#2", design_pressure_bar: 10 }),
  G("g11", "bag_housing", "Multi-bag 8 × #2", { bags: 8, size: "#2", design_pressure_bar: 10 }),
  G("g12", "cartridge_element", "Standard 40\" 5 µm", { type: "standard", length_in: 40, od_mm: 63, micron: 5, q10_m3h: 0.8 }, "Generic — 0.8 m³/h per 10\" (PRD v0.2 decision); replace with vendor data"),
  G("g13", "cartridge_element", "High-flow 40\" 5 µm", { type: "high_flow", length_in: 40, od_mm: 152, micron: 5, flow_m3h: 30 }),
  G("g14", "cartridge_housing", "50 × 40\"", { elements: 50, length_in: 40, design_pressure_bar: 10 }),
  G("g15", "cartridge_housing", "100 × 40\"", { elements: 100, length_in: 40, design_pressure_bar: 10 }),
  G("g16", "cartridge_housing", "150 × 40\"", { elements: 150, length_in: 40, design_pressure_bar: 10 }),
  G("g17", "cartridge_housing", "7 × high-flow 40\"", { elements: 7, length_in: 40, design_pressure_bar: 10 })
];

const KEY = "rocalc.sessionEquipment";
const subs = new Set();
let cache = null, memory = null;
function readSession() { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
function writeSession(list) { try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* memory only */ } memory = list; }
const sessionList = () => memory || (memory = readSession());
function emit() { cache = null; subs.forEach(fn => fn()); }

/** All visible entries (optionally of one category), generic first. */
async function list(category) {
  if (!cache) {
    let server = [];
    if (RO.api.state.online) {
      try { server = (await RO.api.get("/equipment")).equipment.map(e => Object.assign(e, { origin: "server" })); }
      catch (e) { if (RO.ui) RO.ui.apiError(e, "Equipment list"); }
    }
    const sess = sessionList().map(e => Object.assign({}, e, { origin: "session", status: "session" }));
    cache = GENERIC.map(e => Object.assign({}, e)).concat(server, sess);
  }
  return category ? cache.filter(e => e.category === category) : cache;
}
/** Synchronous view of the last list (generic entries when not loaded yet). */
const cached = category => (cache || GENERIC).filter(e => !category || e.category === category);
function find(id) { return (cache || GENERIC).find(e => String(e.id) === String(id)) || null; }

function saveSession(e) {
  const l = sessionList().slice();
  if (!e.id) e.id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const i = l.findIndex(x => x.id === e.id);
  if (i >= 0) l[i] = e; else l.push(e);
  writeSession(l); emit();
  return e;
}
function deleteSession(id) { writeSession(sessionList().filter(x => x.id !== id)); emit(); }

/** Validate one record against CATS (mirrors api/routes/equipment.php). Returns an error string or null. */
function validate(rec) {
  const c = CATS[rec.category];
  if (!c) return "Unknown category";
  if (!rec.vendor || !rec.model) return "Vendor and model are required";
  for (const [k, label, , kind, req] of c.fields) {
    const v = rec.specs[k];
    if ((v === undefined || v === null || v === "") && req) return `${label} is required`;
    if (v !== undefined && v !== null && v !== "" && Array.isArray(kind) && !kind.includes(v)) return `${label}: invalid value`;
    if (v !== undefined && v !== null && v !== "" && !Array.isArray(kind) && !(isFinite(v) && +v > 0)) return `${label}: enter a positive number`;
  }
  if (rec.category === "cartridge_element" && rec.specs.q10_m3h == null && rec.specs.flow_m3h == null) return "Enter the rated flow per 10 inch or per element";
  return null;
}

/* ---------- CSV (SI): category, vendor, model, datasheet_ref, notes, then spec columns ---------- */
const SPEC_KEYS = [...new Set([].concat(...Object.values(CATS).map(c => c.fields.map(f => f[0]))))];
const CSV_HEAD = ["category", "vendor", "model", "datasheet_ref", "notes"].concat(SPEC_KEYS);
function templateCsv() {
  const rows = GENERIC.map(e => [e.category, "Vendor name", e.model, "datasheet ref", ""].concat(SPEC_KEYS.map(k => e.specs[k] ?? "")));
  return RO.csv.stringify(CSV_HEAD, rows);
}
/** Parse CSV text into records (+ row errors). */
function parseCsv(text) {
  const out = [], errors = [];
  RO.csv.parseObjects(text).forEach((o, i) => {
    const cat = CATS[o.category];
    const rec = { category: o.category, vendor: o.vendor, model: o.model, datasheet_ref: o.datasheet_ref || "", notes: o.notes || "", specs: {} };
    if (cat) cat.fields.forEach(([k, , , kind]) => { const v = (o[k] ?? "").trim(); if (v !== "") rec.specs[k] = Array.isArray(kind) ? v : +v; });
    const err = validate(rec);
    if (err) errors.push(`Row ${i + 2}: ${err}`); else out.push(rec);
  });
  return { records: out, errors };
}

/** Short description of an entry's key data for pickers. */
function describe(e) {
  const s = e.specs || {}, U = RO.units;
  switch (e.category) {
    case "mmf_vessel": return `${s.orientation} Ø${U.fmt("elev", s.diameter_m)} ${U.label("elev")}${s.area_m2 ? ` · ${U.fmt("area", s.area_m2, 1)} ${U.label("area")}` : ""}`;
    case "bag_element": return `${s.size || ""} ${s.micron} µm · ${U.fmt("flow", s.flow_m3h, 1)} ${U.label("flow")}/bag`;
    case "bag_housing": return `${s.bags} bag${s.bags > 1 ? "s" : ""} ${s.size || ""}`;
    case "cartridge_element": return `${s.length_in}" ${s.micron} µm · ${s.q10_m3h != null ? `${U.fmt("flow", s.q10_m3h, 2)} ${U.label("flow")} per 10"` : `${U.fmt("flow", s.flow_m3h, 1)} ${U.label("flow")}/element`}`;
    case "cartridge_housing": return `${s.elements} elements${s.length_in ? ` × ${s.length_in}"` : ""}`;
    default: return "";
  }
}

RO.equiplib = {
  CATS, GENERIC, list, cached, find, saveSession, deleteSession, sessionList, validate, templateCsv, parseCsv, describe, CSV_HEAD,
  invalidate: emit, subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
};
})(window.RO = window.RO || {});
