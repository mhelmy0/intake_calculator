/* ============================================================
   Fittings library + K rules (equations.md §4, §5.1).
   The active list = recommended list from the server, or the bundled seed
   offline. A guest may load a CSV for the session only (not saved).
   ============================================================ */
(function (RO) {
"use strict";

const EPS_STEEL = 0.045e-3;   // m — Crane f_T is defined for clean commercial steel
const NUM = ["n_ld", "k", "kv", "k1", "ki", "kd", "dn_min_mm", "dn_max_mm"];

/** Normalize a CSV / API row to the internal item shape. */
function normalize(r) {
  const pick = (...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k]; return null; };
  const it = {
    code: String(pick("code") || "").trim(),
    name: String(pick("name") || ""),
    category: String(pick("category") || "special"),
    basis: String(pick("basis") || "K"),
    n_ld: pick("n_ld", "n_LD"), k: pick("k", "K"), kv: pick("kv", "Kv"),
    k1: pick("k1", "K1"), ki: pick("ki", "Ki"), kd: pick("kd", "Kd"),
    velocity_ref: pick("velocity_ref") || "segment",
    dn_min_mm: pick("dn_min_mm"), dn_max_mm: pick("dn_max_mm"),
    bom: !(String(pick("bom")).toLowerCase() === "no" || pick("bom") === false),
    connection: pick("connection") || "none",
    status: pick("status") || "to_confirm",
    source: pick("source") || "", notes: pick("notes") || ""
  };
  NUM.forEach(k => { it[k] = it[k] === null ? null : Number(it[k]); });
  return it;
}

let active = null;
const subs = new Set();

function setActive(meta, rows) {
  const items = rows.map(normalize);
  const byCode = Object.create(null);
  items.forEach(it => { byCode[it.code.toUpperCase()] = it; });
  active = Object.assign({ items, byCode }, meta);
  subs.forEach(fn => fn(active));
  return active;
}

async function loadRecommended() {
  if (RO.api && RO.api.state.online) {
    try {
      const j = await RO.api.get("/fittings/recommended");
      return setActive({ name: j.version.list_name, version: j.version.version, versionId: j.version.id, origin: "server" }, j.items);
    } catch (e) { /* fall back to bundled */ }
  }
  const s = RO.FITTINGS_SEED;
  return setActive({ name: s.name, version: s.version, versionId: null, origin: "bundled" }, s.rows);
}

async function loadVersion(versionId) {
  const j = await RO.api.get("/fittings/versions/" + versionId);
  return setActive({ name: j.version.list_name, version: j.version.version, versionId: j.version.id, origin: "server" }, j.items);
}

/** Session-only list from a CSV the user loaded (guests; nothing saved). */
function loadSessionCsv(name, csvText) {
  return setActive({ name: name + " (session only)", version: 0, versionId: null, origin: "session" }, RO.csv.parseObjects(csvText));
}

const family = code => String(code).toUpperCase().replace(/-[^-]*$/, "");
const inRange = (it, od) => (it.dn_min_mm === null || od >= it.dn_min_mm) && (it.dn_max_mm === null || od <= it.dn_max_mm);

/** Item for a code at a pipe size; size-ranged rows switch within their code family. */
function resolve(code, od_mm) {
  if (!active) return { item: null, note: "No fittings list loaded" };
  const it = active.byCode[String(code).toUpperCase()];
  if (!it) return { item: null, note: `Code ${code} not in list "${active.name}"` };
  if (inRange(it, od_mm)) return { item: it, note: "" };
  const fam = family(it.code);
  const alt = active.items.find(x => family(x.code) === fam && x.code !== it.code && inRange(x, od_mm));
  if (alt) return { item: alt, note: `${it.code} → ${alt.code} for OD ${od_mm}` };
  return { item: it, note: `${it.code} size range ${it.dn_min_mm ?? ""}–${it.dn_max_mm ?? ""} mm does not cover OD ${od_mm}` };
}

/** Crane fully-turbulent friction factor for a pipe of inner diameter D (m). */
function fT(D) {
  const l = Math.log10(EPS_STEEL / (3.7 * D));
  return 0.25 / (l * l);
}

/**
 * Loss coefficient of an item. opts: { kv } overrides the item's Kv.
 * Returns { K, method, warn }. K = null when not computable here (basis "formula").
 */
function kOf(item, D, Re, opts = {}) {
  switch (item.basis) {
    case "n":  { const f = fT(D); return { K: item.n_ld * f, method: `n·f_T = ${item.n_ld} × ${f.toFixed(4)}` }; }
    case "K":  return { K: item.k, method: "fixed K" };
    case "kv": {
      const kv = opts.kv || item.kv;
      if (!(kv > 0)) return { K: 0, method: "Kv", warn: `${item.code}: no Kv entered — K taken as 0` };
      return { K: 1.599e9 * Math.pow(D, 4) / (kv * kv), method: `1.599e9·D⁴/Kv², Kv = ${kv}` };
    }
    case "3k": {
      const Din = D / 0.0254;
      return { K: item.k1 / Math.max(Re, 1) + item.ki * (1 + item.kd / Math.pow(Din, 0.3)), method: "Darby 3-K" };
    }
    default:   return { K: null, method: "formula (transition)" };
  }
}

RO.fittings = {
  normalize, loadRecommended, loadVersion, loadSessionCsv, resolve, kOf, fT, family,
  active: () => active,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
};
})(window.RO = window.RO || {});
