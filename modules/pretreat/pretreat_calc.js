/* ============================================================
   Pretreatment — calculation layer (no DOM). Pretreatment PRD v0.2,
   equations.md §11. Every unit takes its own flow (m³/h, typed per unit).
   Blank inputs (null) use the recommended value (RO.values "pt.*").
   Equipment (MMF vessels, bags, cartridges) is copied into the state from
   the equipment list as { id, vendor, model, specs } so drafts stay portable.
   ============================================================ */
(function (RO) {
"use strict";

const blank = v => v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));
const rec = (v, key) => (blank(v) ? RO.values.get(key) : +v);
const FE_OH3_PER_FECL3 = 106.87 / 162.2;                       // 0.659, stoichiometric (equations.md §11.1)
const PATM_BAR = 1.01325;

const STEPS = [
  { id: "dosing", label: "Chemical dosing" },
  { id: "daf", label: "DAF" },
  { id: "sedimentation", label: "Sedimentation" },
  { id: "media", label: "Media filters" },
  { id: "bag", label: "Bag filters" },
  { id: "cartridge", label: "Cartridge filters" }
];

const snap = id => { const e = RO.equiplib ? RO.equiplib.find(id) : null; return e ? { id: e.id, vendor: e.vendor, model: e.model, specs: Object.assign({}, e.specs) } : null; };
const coagDefault = t => ({ inline: false, rapid_t: null, rapid_G: null, floc_t: null, floc_G: null, stages: t === "daf" ? 2 : 3 });

function chem(o) {
  return Object.assign({ on: true, name: "Chemical", point: "", Q: 4200, dose: 1, dose_max: null, basis: "as product", strength_pct: 100, rho: 1.0,
    dilution_pct: null, sol_rho: 1.0, days: null, margin: null, duty: 1, standby: 1, kind: "generic", sds: "" }, o);
}
function defaultState() {
  return {
    train: [{ id: "dosing", on: true }, { id: "daf", on: true }, { id: "sedimentation", on: false }, { id: "media", on: true }, { id: "bag", on: false }, { id: "cartridge", on: true }],
    daf: { Q: 4100, N: 2, hlr: null, recovery: null, recycle: null, psat: null, sateff: null, contact: null, depth: null, lw: null, tss: 20, removal: null, dose_fecl3: 5, coag: coagDefault("daf") },
    sedimentation: { Q: 4100, N: 2, type: "lamella", rate: null, detention: null, plate: null, lw: null, tss: 20, removal: null, dose_fecl3: 5, coag: coagDefault("sed") },
    media: { Q: 4000, type: "pressure", vessel: snap("g3"), custom_d: null, cell_L: 10, cell_W: 5, N: null, rate_normal: null, rate_max: null, media: "dual", fine: false,
             anth: { depth: null, es: null }, sand: { depth: null, es: null }, garnet: { depth: null, es: null },
             bw_rate: null, bw_min: null, air_rate: null, air_min: null, rinse_min: null, run_h: null, loss_max: null },
    bag: { Q: 3900, element: snap("g7"), housing: snap("g11"), standby: null, months: null, change_bar: null },
    cartridge: { Q: 3900, element: snap("g12"), housing: snap("g16"), q10: null, elements_custom: null, standby: null, months: null, replace_bar: null },
    dosing: { rows: [
      chem({ name: "Sodium hypochlorite", point: "Intake (chlorination)", Q: 8200, dose: 1.0, dose_max: 2.0, basis: "as Cl₂", strength_pct: 12.5, rho: 1.20, sds: "12.5 % as Cl₂ — check supplier SDS" }),
      chem({ name: "Ferric chloride", point: "Before DAF", Q: 4100, dose: 5, dose_max: 10, basis: "as FeCl₃", strength_pct: 40, rho: 1.42, sds: "40 % w/w — check supplier SDS" }),
      chem({ name: "Polymer (flocculant)", point: "Flocculation", Q: 4100, dose: 0.3, dose_max: 0.6, basis: "as product", strength_pct: 100, rho: 0.8, dilution_pct: 0.2, sol_rho: 1.0, sds: "powder, made up to 0.2 %" }),
      chem({ on: false, name: "Sulfuric acid", point: "Before filters", Q: 4000, dose: 10, dose_max: 20, basis: "as H₂SO₄", strength_pct: 98, rho: 1.84, sds: "98 %" }),
      chem({ name: "Sodium metabisulfite", point: "Before cartridge filters", Q: 3900, dose: null, dose_max: null, basis: "as SMBS", strength_pct: 100, rho: 1.2, dilution_pct: 10, sol_rho: 1.05, kind: "smbs", sds: "powder, made up to 10 %" }),
      chem({ name: "Antiscalant", point: "Before cartridge filters", Q: 3900, dose: 2, dose_max: 3, basis: "as product", strength_pct: 100, rho: 1.15, sds: "neat — per vendor projection" })
    ] }
  };
}

/* ---------- coagulation / flocculation (§11.1) ---------- */
function coag(Q, c, F, kind) {
  const mu = F && F.mu ? F.mu : 1.0e-3;
  const rt = rec(c.rapid_t, "pt.rapid_t_s"), rG = rec(c.rapid_G, "pt.rapid_G");
  const ft = rec(c.floc_t, kind === "daf" ? "pt.floc_t_daf_min" : "pt.floc_t_sed_min"), fG = rec(c.floc_G, "pt.floc_G");
  const Vr = c.inline ? 0 : Q / 3600 * rt, Vf = Q / 60 * ft;
  return { rt, rG, ft, fG, Vr, Vf, Pr: rG * rG * mu * Vr / 1000, Pf: fG * fG * mu * Vf / 1000, inline: !!c.inline, stages: Math.max(1, Math.round(+c.stages || 1)) };
}
const sludge = (Qin, tss, removal, dose) => Qin * 24 * (tss * removal + FE_OH3_PER_FECL3 * (dose || 0)) / 1000;   // kg/d

/* ---------- DAF (§11.2) ---------- */
function daf(u, F) {
  const Q = +u.Q, N = Math.max(1, Math.round(+u.N || 1));
  if (!(Q > 0)) return { error: "Enter the DAF net flow" };
  const hlr = rec(u.hlr, "pt.daf_hlr"), r = rec(u.recovery, "pt.daf_recovery_pct") / 100, R = rec(u.recycle, "pt.daf_recycle_pct") / 100;
  const psat = rec(u.psat, "pt.daf_psat_bar"), f = rec(u.sateff, "pt.daf_sat_eff"), tc = rec(u.contact, "pt.daf_contact_min");
  const depth = rec(u.depth, "pt.daf_depth_m"), lw = rec(u.lw, "pt.daf_lw"), sa = RO.values.get("pt.air_sol_mgL");
  const removal = rec(u.removal, "pt.daf_tss_removal_pct") / 100;
  const Qin = Q / r, Qr = R * Q;
  const A = Q / N / hlr, W = Math.sqrt(A / lw), L = lw * W;
  const rateN1 = N > 1 ? Q / ((N - 1) * A) : null;
  const Vc = Q * (1 + R) * tc / 60 / N, Vs = A * depth;
  const air = R * sa * (f * (psat + PATM_BAR) / PATM_BAR - 1) / (1 + R);
  const cg = coag(Qin, u.coag || {}, F, "daf");
  const sl = sludge(Qin, +u.tss || 0, removal, +u.dose_fecl3 || 0);
  const sol = RO.values.get("pt.sludge_solids_pct") / 100;
  const checks = [];
  checks.push({ key: "hlr", status: hlr >= 5 && hlr <= 40 ? "pass" : "warn", v: hlr, lo: 5, hi: 40 });
  if (rateN1 != null) checks.push({ key: "n1", status: rateN1 <= 40 ? "pass" : "warn", v: rateN1, hi: 40 });
  checks.push({ key: "floc", status: cg.ft >= 5 && cg.ft <= 20 ? "pass" : "warn", v: cg.ft, lo: 5, hi: 20 });
  checks.push({ key: "recovery", status: "note", loss: Qin - Q, r });
  return { Q, N, hlr, r, R, Qin, loss: Qin - Q, Qr, A, W, L, rateN1, depth, Vc, Vs, air, psat, f, tc, coag: cg, sludge: sl, sludgeVol: sl / (sol * 1000), checks };
}

/* ---------- sedimentation (§11.3) ---------- */
function sedimentation(u, F) {
  const Q = +u.Q, N = Math.max(1, Math.round(+u.N || 1));
  if (!(Q > 0)) return { error: "Enter the sedimentation flow" };
  const lamella = u.type !== "conventional";
  const rate = lamella ? rec(u.rate, "pt.sed_lamella_rate") : rec(u.rate, "pt.sed_conv_rate");
  const td = rec(u.detention, "pt.sed_detention_h"), lw = rec(u.lw, "pt.sed_lw"), plate = rec(u.plate, "pt.sed_plate_deg");
  const wmax = RO.values.get("pt.sed_weir_max"), removal = rec(u.removal, "pt.sed_tss_removal_pct") / 100;
  const A = Q / rate, Ab = A / N, W = Math.sqrt(Ab / lw), L = lw * W;
  const depth = lamella ? null : rate * td, V = lamella ? null : A * depth;
  const weirMin = Q * 24 / wmax;
  const cg = coag(Q, u.coag || {}, F, "sed");
  const sl = sludge(Q, +u.tss || 0, removal, +u.dose_fecl3 || 0), sol = RO.values.get("pt.sludge_solids_pct") / 100;
  const checks = [];
  if (lamella) checks.push({ key: "rate", status: rate >= 10 && rate <= 25 ? "pass" : "warn", v: rate, lo: 10, hi: 25, lamella });
  else {
    checks.push({ key: "rate", status: rate >= 0.8 && rate <= 1.7 ? "pass" : "warn", v: rate, lo: 0.8, hi: 1.7, lamella });
    checks.push({ key: "td", status: td >= 1 && td <= 4 ? "pass" : "warn", v: td, lo: 1, hi: 4 });
  }
  if (lamella) checks.push({ key: "plate", status: plate >= 50 && plate <= 70 ? "pass" : "warn", v: plate });
  checks.push({ key: "weir", status: "note", v: weirMin, wmax });
  return { Q, N, lamella, rate, td, lw, plate, A, Ab, W, L, depth, V, weirMin, wmax, coag: cg, sludge: sl, sludgeVol: sl / (sol * 1000), checks };
}

/* ---------- media filters (§11.4) ---------- */
function filterArea(u) {
  if (u.type === "gravity") return { A: (+u.cell_L || 0) * (+u.cell_W || 0), label: `cell ${u.cell_L} × ${u.cell_W} m` };
  const v = u.vessel && u.vessel.specs;
  if (v) {
    if (v.area_m2) return { A: +v.area_m2, label: `${u.vessel.vendor} ${u.vessel.model}`, vendorMax: v.max_rate_m_h || null, D: v.diameter_m };
    if (v.orientation === "horizontal") return { A: NaN, label: `${u.vessel.vendor} ${u.vessel.model}`, error: "Horizontal vessel: enter its filtration area in the equipment list" };
    return { A: Math.PI * v.diameter_m ** 2 / 4, label: `${u.vessel.vendor} ${u.vessel.model}`, vendorMax: v.max_rate_m_h || null, D: v.diameter_m };
  }
  const D = rec(u.custom_d, "pt.mmf_diameter_m");
  return { A: Math.PI * D * D / 4, label: `custom Ø${D} m`, D };
}
function mediaLayers(u) {
  const L = (k, dk, ek, bk) => ({ key: k, depth: rec((u[k] || {}).depth, dk), es: rec((u[k] || {}).es, ek), bulk: RO.values.get(bk) });
  const layers = [L("anth", "pt.anth_depth_m", "pt.anth_es_mm", "pt.anth_bulk"), L("sand", "pt.sand_depth_m", "pt.sand_es_mm", "pt.sand_bulk")];
  if (u.media === "tri") layers.push(L("garnet", "pt.garnet_depth_m", "pt.garnet_es_mm", "pt.garnet_bulk"));
  return layers;
}
/** L/dₑ rule (McGivney & Kawamura): Σ depth(mm)/ES(mm) against 1000 (dual) or 1250 (tri), × 1.15 for < 0.1 NTU. */
function ldRatio(u) {
  const layers = mediaLayers(u);
  const sum = layers.reduce((a, l) => a + l.depth * 1000 / l.es, 0);
  const target = (u.media === "tri" ? RO.values.get("pt.mmf_ld_tri") : RO.values.get("pt.mmf_ld_dual")) * (u.fine ? RO.values.get("pt.mmf_ld_fine") : 1);
  return { layers, sum, target, scale: target / sum };
}
function media(u) {
  const Qn = +u.Q;
  if (!(Qn > 0)) return { error: "Enter the net filtrate flow" };
  const fa = filterArea(u);
  if (fa.error) return { error: fa.error };
  if (!(fa.A > 0)) return { error: "Enter the filter size" };
  const vn = rec(u.rate_normal, "pt.mmf_rate_normal"), vmax = rec(u.rate_max, "pt.mmf_rate_max");
  const bw = rec(u.bw_rate, "pt.bw_rate"), bwt = rec(u.bw_min, "pt.bw_min"), ar = rec(u.air_rate, "pt.air_rate"), at = rec(u.air_min, "pt.air_min");
  const rt = rec(u.rinse_min, "pt.rinse_min"), run = rec(u.run_h, "pt.run_h"), lossMax = rec(u.loss_max, "pt.bw_loss_max_pct");
  const A = fa.A;
  const Vbw = A * (bw * bwt + vn * rt) / 60;                      // m³ per wash (backwash + rinse to drain)
  const gross = N => { const Vday = N * Vbw * 24 / run; return { Vday, Qg: Qn + Vday / 24 }; };
  let N = blank(u.N) ? null : Math.max(2, Math.round(+u.N));
  if (N === null) {
    for (let n = 2; n <= 400; n++) { const g = gross(n); if (g.Qg / ((n - 1) * A) <= vmax + 1e-9 && g.Qg / (n * A) <= vn + 1e-9) { N = n; break; } }
    if (N === null) return { error: "More than 400 filters needed — use a larger filter" };
  }
  const { Vday, Qg } = gross(N);
  const vN = Qg / (N * A), vN1 = Qg / ((N - 1) * A), vN2 = N > 2 ? Qg / ((N - 2) * A) : null;
  const ld = ldRatio(u), depthTotal = ld.layers.reduce((a, l) => a + l.depth, 0);
  const lossPct = Vday / (24 * Qg) * 100;
  const layers = ld.layers.map(l => Object.assign({}, l, { V: N * A * l.depth, t: N * A * l.depth * l.bulk / 1000 }));
  const checks = [];
  checks.push({ key: "vN", status: vN <= vn + 1e-9 ? "pass" : "fail", v: vN, lim: vn, N });
  checks.push({ key: "vN1", status: vN1 <= vmax + 1e-9 ? "pass" : "fail", v: vN1, lim: vmax, N });
  if (fa.vendorMax) checks.push({ key: "vendor", status: vN1 <= fa.vendorMax + 1e-9 ? "pass" : "warn", v: vN1, lim: fa.vendorMax });
  checks.push({ key: "ld", status: ld.sum >= ld.target - 1e-9 ? "pass" : "fail", v: ld.sum, lim: ld.target, tri: u.media === "tri", fine: !!u.fine });
  checks.push({ key: "loss", status: lossPct <= lossMax + 1e-9 ? "pass" : "warn", v: lossPct, lim: lossMax });
  if (vN2 != null) checks.push({ key: "vN2", status: "note", v: vN2 });
  if (u.type !== "gravity" && Qg * 24 > 20000) checks.push({ key: "pressure", status: "warn", v: Qg });
  return { Qn, Qg, N, A, Atot: N * A, fa, vn, vmax, vN, vN1, vN2, bw, bwt, ar, at, rt, run, Vbw, Vday, lossPct, lossMax,
           Qbw: bw * A, Qair: ar * A, ebct: depthTotal / vN * 60, ld, layers, depthTotal, checks };
}

/* ---------- bag filters (§11.4A) ---------- */
function bag(u, cartridgeMicron) {
  const Q = +u.Q;
  if (!(Q > 0)) return { error: "Enter the bag filter flow" };
  const el = u.element && u.element.specs, ho = u.housing && u.housing.specs;
  if (!el || !(el.flow_m3h > 0)) return { error: "Choose a bag element (rated flow per bag)" };
  if (!ho || !(ho.bags >= 1)) return { error: "Choose a bag filter housing" };
  const qb = +el.flow_m3h, k = Math.round(+ho.bags), sb = Math.round(rec(u.standby, "pt.bag_standby"));
  const n = Math.ceil(Q / qb - 1e-9), nh = Math.ceil(n / k - 1e-9);
  const q = Q / (nh * k), installed = (nh + sb) * k;
  const months = blank(u.months) ? null : +u.months;
  const checks = [{ key: "load", status: q <= qb + 1e-9 ? "pass" : "fail", v: q, lim: qb }];
  if (ho.max_flow_m3h) checks.push({ key: "hmax", status: Q / nh <= ho.max_flow_m3h + 1e-9 ? "pass" : "fail", v: Q / nh, lim: ho.max_flow_m3h });
  if (cartridgeMicron != null && el.micron <= cartridgeMicron) checks.push({ key: "micron", status: "warn", bag: el.micron, cf: cartridgeMicron });
  return { Q, qb, k, sb, n, nh, q, installed, perYear: months ? installed * 12 / months : null, months, micron: el.micron, change: rec(u.change_bar, "pt.bag_change_bar"), checks };
}

/* ---------- cartridge filters (§11.5) ---------- */
function cartridge(u) {
  const Q = +u.Q;
  if (!(Q > 0)) return { error: "Enter the cartridge filter flow" };
  const el = (u.element && u.element.specs) || { type: "standard", length_in: 40, micron: 5 };
  const high = el.type === "high_flow";
  const len = +el.length_in || 40;
  let q10 = null, qe;
  if (high && blank(u.q10)) { qe = +el.flow_m3h; if (!(qe > 0)) return { error: "The high-flow element needs a rated flow per element" }; }
  else { q10 = !blank(u.q10) ? +u.q10 : (el.q10_m3h ? +el.q10_m3h : RO.values.get("pt.cf_q10")); qe = q10 * len / 10; }
  const k = u.housing && u.housing.specs && u.housing.specs.elements ? Math.round(+u.housing.specs.elements) : Math.round(rec(u.elements_custom, "pt.cf_elements_housing"));
  const sb = Math.round(rec(u.standby, "pt.cf_standby")), months = rec(u.months, "pt.cf_months");
  const n = Math.ceil(Q / qe - 1e-9), nh = Math.ceil(n / k - 1e-9);
  const q = Q / (nh * k), installed = (nh + sb) * k;
  const hl = u.housing && u.housing.specs && u.housing.specs.length_in;
  const checks = [{ key: "load", status: q <= qe + 1e-9 ? "pass" : "fail", v: q, lim: qe }];
  if (hl && Math.abs(hl - len) > 0.1) checks.push({ key: "len", status: "warn", h: hl, e: len });
  if (u.housing && u.housing.specs && u.housing.specs.max_flow_m3h) checks.push({ key: "hmax", status: Q / nh <= u.housing.specs.max_flow_m3h + 1e-9 ? "pass" : "fail", v: Q / nh, lim: u.housing.specs.max_flow_m3h });
  checks.push({ key: "months", status: months <= 3 ? "pass" : "warn", v: months });
  checks.push({ key: "micron", status: el.micron <= 10 ? "pass" : "fail", v: el.micron });
  return { Q, high, len, q10, qe, k, sb, n, nh, q, installed, perYear: installed * 12 / months, months, micron: el.micron, replace: rec(u.replace_bar, "pt.cf_replace_bar"), checks };
}

/* ---------- chemical dosing (§11.6) ---------- */
function dosingRow(c) {
  if (!(+c.Q > 0)) return { c, error: `${c.name}: enter the flow at the dosing point` };
  const smbs = c.kind === "smbs";
  const dose = smbs && blank(c.dose) ? RO.values.get("pt.smbs_ratio") * RO.values.get("pt.cl2_residual") : +c.dose;
  const doseMax = blank(c.dose_max) ? dose : +c.dose_max;
  if (!(dose >= 0) || !(+c.strength_pct > 0) || !(+c.rho > 0)) return { c, error: `${c.name}: enter the dose, strength and density (SDS)` };
  const w = +c.strength_pct / 100;
  const ma = +c.Q * dose / 1000, maMax = +c.Q * doseMax / 1000;         // kg/h active
  const mp = ma / w, Vp = mp / +c.rho;                                     // kg/h, L/h product
  const dil = !blank(c.dilution_pct) && +c.dilution_pct > 0;
  const Vs = dil ? ma / (+c.dilution_pct / 100 * (+c.sol_rho || 1)) : null;
  const VsMax = dil ? maMax / (+c.dilution_pct / 100 * (+c.sol_rho || 1)) : null;
  const dosed = dil ? Vs : Vp, dosedMax = dil ? VsMax : maMax / w / +c.rho;
  const margin = rec(c.margin, "pt.dose_pump_margin"), td = RO.values.get("pt.dose_turndown");
  const cap = margin * dosedMax;
  const days = blank(c.days) ? null : +c.days;
  const checks = [];
  checks.push({ key: "turndown", status: cap / td <= dosed + 1e-12 ? "pass" : "warn", min: cap / td, avg: dosed, td });
  if (days === null) checks.push({ key: "days", status: "warn" });
  if (smbs) checks.push({ key: "smbs", status: dose >= RO.values.get("pt.smbs_ratio") * RO.values.get("pt.cl2_residual") - 1e-9 ? "pass" : "fail", dose, need: RO.values.get("pt.smbs_ratio") * RO.values.get("pt.cl2_residual") });
  return { c, dose, doseMax, ma, maMax, mp, Vp, dil, Vs, dosed, dosedMax, cap, margin, pumps: `${c.duty} + ${c.standby}`,
           perDay: mp * 24, perDayL: Vp * 24, perMonth: Vp * 24 * 30 / 1000, days, storage: days === null ? null : Vp * 24 * days / 1000, checks };
}
function dosing(u) { const rows = u.rows.map((c, i) => c.on ? Object.assign(dosingRow(c), { i }) : { c, i, off: true }); return { rows }; }

/* ---------- whole train ---------- */
function compute(S, F) {
  const on = id => (S.train.find(t => t.id === id) || {}).on;
  const R = { train: S.train };
  if (on("dosing")) R.dosing = dosing(S.dosing);
  if (on("daf")) R.daf = daf(S.daf, F);
  if (on("sedimentation")) R.sedimentation = sedimentation(S.sedimentation, F);
  if (on("media")) R.media = media(S.media);
  if (on("cartridge")) R.cartridge = cartridge(S.cartridge);
  if (on("bag")) R.bag = bag(S.bag, R.cartridge && !R.cartridge.error ? R.cartridge.micron : null);
  return R;
}

RO.pretreatCalc = { STEPS, defaultState, chem, snap, coag, daf, sedimentation, filterArea, ldRatio, mediaLayers, media, bag, cartridge, dosingRow, dosing, compute, blank, rec, FE_OH3_PER_FECL3 };
})(window.RO = window.RO || {});
