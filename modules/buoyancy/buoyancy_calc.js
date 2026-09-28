/* ============================================================
   Supports & buoyancy — calculation layer (no DOM). equations.md §9, §9.5.
   PPI Handbook Ch. 10 method with user-defined concrete blocks per section.
   All per metre of pipe in N/m; inputs in mm, m, kg, kg/m³.
   ============================================================ */
(function (RO) {
"use strict";

const G = RO.hyd.G;
const blank = v => v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));
const recOr = (v, key) => (blank(v) || !isFinite(v) ? RO.values.get(key) : +v);

/* PPI Table 1 — percent weighting of the air-filled net buoyancy (reference ranges). */
const INSTALL = {
  none:          { label: "No PPI range check", lo: null, hi: null },
  float_sink:    { label: "Float-and-sink installation", lo: 5, hi: 85 },
  trench_gravel: { label: "Trenched, gravel cover", lo: 15, hi: 50 },
  trench_fine:   { label: "Trenched, fine-grained fill", lo: 50, hi: 85 },
  bottom_still:  { label: "On-bottom, still water", lo: 5, hi: 50 },
  bottom_shallow:{ label: "On-bottom, rough shallow water", lo: 50, hi: 85 },
  bottom_deep:   { label: "On-bottom, rough deep water", lo: 5, hi: 50 }
};

function newSection(o = {}) {
  return Object.assign({ name: "Section", source: "manual", od: 630, sdr: 17, custom: false, e_mm: 37.4, L: 100, lines: 1, bundle: 1,
    piece_kg: 1000, pieces: 2, spacing: 3, contents: "air", growth_mm: 0, install: "bottom_still" }, o);
}
function defaultState() {
  return {
    water_rho: null, concrete_rho: null, pe_rho: null, sf_target: null, wall_factor: null, growth_rho: null,
    sf_def: "A",                                   // A = ballast ÷ net uplift · B = total down ÷ buoyancy
    sections: [newSection({ name: "Sea line", od: 630, sdr: 17, L: 550, lines: 2, piece_kg: 1000, pieces: 2, spacing: 3, install: "trench_gravel" })]
  };
}

/** Surrounding water: seawater at the design temperature (and the fluid's salinity when it is seawater / brine). */
function seawaterRho(F) {
  const st = RO.fluid ? RO.fluid.get() : { T_C: 25, preset: "sea", S_gkg: 40 };
  const S = st.preset === "sea" ? +st.S_gkg : 40;
  return RO.fluids.compute({ preset: "sea", T_C: F && F.T != null ? F.T : st.T_C, S_gkg: S }).rho;
}

function params(S, F) {
  return {
    rhoW: blank(S.water_rho) ? seawaterRho(F) : +S.water_rho,
    rhoB: recOr(S.concrete_rho, "buoyancy.concrete_rho"),
    rhoP: recOr(S.pe_rho, "buoyancy.pe_rho"),
    sf: recOr(S.sf_target, "buoyancy.sf_min"),
    wf: recOr(S.wall_factor, "buoyancy.wall_factor"),
    rhoG: recOr(S.growth_rho, "buoyancy.growth_rho"),
    rhoC: F && F.rho ? F.rho : 1025,
    def: S.sf_def === "B" ? "B" : "A"
  };
}

/** One section (equations.md §9.5). */
function section(sec, P) {
  const errs = [];
  const OD = +sec.od;
  const e = sec.custom ? +sec.e_mm : (OD > 0 && +sec.sdr > 0 ? RO.pipes.catalogueWall(OD, +sec.sdr).e : NaN);
  if (!(OD > 0) || !(e > 0) || 2 * e >= OD) errs.push("pipe size");
  ["L", "piece_kg", "spacing"].forEach(k => { if (!(+sec[k] > 0)) errs.push({ L: "length", piece_kg: "piece weight", spacing: "spacing" }[k]); });
  if (!(+sec.pieces >= 1)) errs.push("pieces per location");
  if (!(+sec.bundle >= 1)) errs.push("pipes in bundle");
  if (errs.length) return { sec, error: `${sec.name}: enter ${errs.join(", ")}` };
  const n = Math.round(+sec.bundle), lines = Math.max(1, Math.round(+sec.lines || 1));
  const Do = OD / 1000, eW = e * P.wf / 1000, Di = Do - 2 * eW;
  const tg = (+sec.growth_mm || 0) / 1000;
  const A = d => Math.PI * d * d / 4;
  const WP = P.rhoP * G * (A(Do) - A(Di));
  const WC = sec.contents === "water" ? P.rhoC * G * A(Di) : 0;
  const WG = tg > 0 ? P.rhoG * G * (A(Do + 2 * tg) - A(Do)) : 0;
  const WDW = P.rhoW * G * A(Do + 2 * tg);
  const subF = 1 - P.rhoW / P.rhoB;
  const Ls = +sec.spacing, mLoc = +sec.piece_kg * Math.round(+sec.pieces);
  const Wb = mLoc * G * subF / Ls;                                  // ballast, submerged, per m of bundle
  const down = n * (WP + WC + WG), up = n * WDW;
  const uplift = up - down;                                          // net uplift without ballast (N/m)
  const SF_A = uplift > 0 ? Wb / uplift : Infinity;
  const SF_B = (down + Wb) / up;
  const SF = P.def === "B" ? SF_B : SF_A;
  const reqPerM = P.def === "B" ? Math.max(0, P.sf * up - down) : Math.max(0, P.sf * uplift);   // required submerged ballast N/m
  const reqLoc = reqPerM * Ls / (G * subF);                          // kg per location
  const maxSpacing = reqPerM > 0 ? mLoc * G * subF / reqPerM : Infinity;
  const airUplift = n * (WDW - WP);                                  // PPI: air-filled net buoyancy
  const Wpct = airUplift > 0 ? Wb / airUplift * 100 : null;
  const N = Math.ceil(+sec.L / Ls - 1e-9) + 1;
  const piecesTotal = N * Math.round(+sec.pieces) * lines;
  const massTotal = N * mLoc * lines;
  const ins = INSTALL[sec.install] || INSTALL.none;
  const checks = [];
  checks.push({ key: "sf", status: SF >= P.sf - 1e-9 ? "pass" : "fail", SF, target: P.sf, def: P.def });
  checks.push({ key: "spacing", status: Ls >= Do - 1e-9 && Ls <= 12 * Do + 1e-9 ? "pass" : "warn", Ls, lo: Do, hi: 12 * Do });
  // For information only (equations.md §9.3): PPI ranges assume water-filled service, so an air-filled SF ≥ 1 is always above them.
  if (ins.lo != null && Wpct != null) checks.push({ key: "wpct", status: "note", within: Wpct >= ins.lo && Wpct <= ins.hi, Wpct, lo: ins.lo, hi: ins.hi, label: ins.label });
  if (Wpct != null && Wpct > 85 && sec.install === "float_sink") checks.push({ key: "float", status: "warn" });
  if (uplift <= 0) checks.push({ key: "sinks", status: "note" });
  return { sec, OD, e, eW: eW * 1000, Di: Di * 1000, n, lines, WP, WC, WG, WDW, down, up, uplift, subF, mLoc, Wb, SF_A, SF_B, SF, reqLoc, maxSpacing, Wpct,
           N, piecesTotal, massTotal, concrete: massTotal / P.rhoB, pieceVol: +sec.piece_kg / P.rhoB, checks };
}

function compute(S, F) {
  const P = params(S, F);
  const rows = S.sections.map(s => section(s, P));
  const ok = rows.filter(r => !r.error);
  return {
    P, rows, errors: rows.filter(r => r.error).map(r => r.error),
    minSF: ok.length ? Math.min(...ok.map(r => r.SF)) : null,
    pieces: ok.reduce((a, r) => a + r.piecesTotal, 0),
    mass: ok.reduce((a, r) => a + r.massTotal, 0),
    concrete: ok.reduce((a, r) => a + r.concrete, 0)
  };
}

/** Sections from a route (Intake gravity line or a submerged Pipeline design line). */
function sectionsFromSegments(segs, lines, prefix, source) {
  return segs.map((sg, i) => newSection({ name: (prefix ? prefix + " · " : "") + sg.name, source: `${source}:${i}`, od: +sg.od, sdr: +sg.sdr || 17, custom: !!sg.custom,
    e_mm: +sg.e || 0, L: +(+sg.L).toFixed(1), lines }));
}

RO.buoyancyCalc = { INSTALL, newSection, defaultState, seawaterRho, params, section, compute, sectionsFromSegments, blank };
})(window.RO = window.RO || {});
