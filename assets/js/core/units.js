/* ============================================================
   Display units (SI / Imperial). All calculations stay in SI; screens
   convert on display and parse inputs back to SI through RO.units.
   Preference persists with the shell prefs (localStorage "roshell.prefs").
   ============================================================ */
(function (RO) {
"use strict";

/* q: [SI label, Imperial label, factor SI→Imperial (or "T"), SI decimals, Imperial decimals] */
const DEFS = {
  flow:  ["m³/h", "gpm", 4.402868, 0, 0],
  len:   ["m", "ft", 3.28084, 1, 0],        // pipe / route lengths
  head:  ["m", "ft", 3.28084, 2, 1],        // heads, losses, NPSH
  elev:  ["m", "ft", 3.28084, 2, 2],        // levels & elevations
  dia:   ["mm", "in", 1 / 25.4, 1, 2],
  wall:  ["mm", "in", 1 / 25.4, 1, 3],
  rough: ["mm", "in", 1 / 25.4, 4, 6],
  press: ["bar", "psi", 14.50377, 2, 1],
  vel:   ["m/s", "ft/s", 3.28084, 2, 2],
  power: ["kW", "hp", 1.341022, 1, 1],
  temp:  ["°C", "°F", "T", 1, 1],
  dens:  ["kg/m³", "lb/ft³", 0.0624280, 1, 2],
  area:  ["m²", "ft²", 10.76391, 4, 3],
  vol:   ["m³", "ft³", 35.31467, 1, 0],
  speed: ["m/s", "ft/s", 3.28084, 1, 0],    // sound / wave speed
  kpa:   ["kPa", "psi", 0.1450377, 3, 3],
  gpa:   ["GPa", "ksi", 145.0377, 3, 1],
  kv:    ["Kv (m³/h)", "Cv (gpm)", 1.156, 0, 0],
  hkm:   ["m/km", "ft/1000 ft", 1, 2, 2],  // gradient — dimensionless ratio, same number
  mass:  ["kg", "lb", 2.204623, 0, 0],
  rate:  ["m/h", "gpm/ft²", 0.4088, 1, 2],      // filtration / surface loading rate
  arate: ["Nm³/m²·h", "scfm/ft²", 0.05468, 0, 2], // air scour rate
  aflow: ["Nm³/h", "scfm", 0.5886, 0, 0],        // air flow
  lph:   ["L/h", "gal/h", 0.264172, 1, 1],       // chemical product flow
  kgh:   ["kg/h", "lb/h", 2.204623, 2, 2],
  kgd:   ["kg/d", "lb/d", 2.204623, 1, 1],
  wload: ["m³/m·d", "gpd/ft", 80.52, 0, 0],      // weir loading
  fpm:   ["N/m", "lbf/ft", 0.0685218, 1, 2],   // force per metre of pipe
  pct:   ["%", "%", 1, 0, 0],
  tds:   ["mg/L", "mg/L", 1, 0, 0],
  time:  ["s", "s", 1, 2, 2],
  none:  ["", "", 1, 3, 3]
};

let sys = "si";
try { const p = JSON.parse(localStorage.getItem("roshell.prefs") || "{}"); if (p.units === "imp") sys = "imp"; } catch (e) { /* default SI */ }
const subs = new Set();

function set(s) {
  sys = s === "imp" ? "imp" : "si";
  try { const p = JSON.parse(localStorage.getItem("roshell.prefs") || "{}"); p.units = sys; localStorage.setItem("roshell.prefs", JSON.stringify(p)); } catch (e) { /* not persisted */ }
  subs.forEach(fn => fn(sys));
}

const def = q => DEFS[q] || DEFS.none;
const label = q => def(q)[sys === "si" ? 0 : 1];
const dp = q => def(q)[sys === "si" ? 3 : 4];

/** SI value → display value in the current system. */
function toDisp(q, v) {
  if (v === null || v === undefined || !isFinite(v)) return v;
  const d = def(q);
  if (sys === "si") return v;
  return d[2] === "T" ? v * 9 / 5 + 32 : v * d[2];
}
/** Display value in the current system → SI. */
function toSI(q, v) {
  if (v === null || v === undefined || !isFinite(v)) return v;
  const d = def(q);
  if (sys === "si") return v;
  return d[2] === "T" ? (v - 32) * 5 / 9 : v / d[2];
}
/** Formatted display string of an SI value (thousands separators, fixed decimals). */
function fmt(q, v, decimals) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const d = decimals === undefined ? dp(q) : decimals;
  return Number(toDisp(q, v)).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
}
/** "value unit" */
const withUnit = (q, v, decimals) => fmt(q, v, decimals) + (label(q) ? " " + label(q) : "");
/** Plain number for an <input value> (no separators), rounded sensibly. */
function inputValue(q, v) {
  if (v === null || v === undefined || !isFinite(v)) return "";
  // Display precision + 1 decimal; untouched fields keep their exact SI value (only edited fields are re-parsed).
  const x = toDisp(q, v);
  return String(+x.toFixed(dp(q) + 1));
}
/** Parse user text in the current system → SI (null if blank, NaN if invalid). */
function parse(q, text) {
  const t = String(text ?? "").trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return isFinite(n) ? toSI(q, n) : NaN;
}

/** Unit label markup that follows the unit system: <span data-ul="flow">m³/h</span> + applyLabels(root). */
const ul = q => `<span data-ul="${q}">${label(q)}</span>`;
function applyLabels(root) { (root || document).querySelectorAll("[data-ul]").forEach(el => { el.textContent = label(el.dataset.ul); }); }

RO.units = {
  DEFS, set, label, dp, toDisp, toSI, fmt, withUnit, inputValue, parse, ul, applyLabels,
  system: () => sys,
  isImperial: () => sys === "imp",
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
};
})(window.RO = window.RO || {});
