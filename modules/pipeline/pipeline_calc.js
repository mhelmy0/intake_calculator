/* ============================================================
   Pipeline design — calculation layer (no DOM). PRD §8A, equations.md §5A.
   One line along a surveyed profile (chainage, ground, cover), split into
   segments by chainage. Reuses the shared route, fittings, fluid, pipe-class
   and surge engines. All state values are SI (m³/h, m, mm, bar, °C).
   RO.pipelineCalc.compute(S, F) → results for every page.
   ============================================================ */
(function (RO) {
"use strict";

const { G, PATM } = RO.hyd;
const blank = v => v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));
const num = v => (blank(v) ? null : +v);
const recOr = (v, key) => (blank(v) || !isFinite(v) ? RO.values.get(key) : +v);
function crit(S, key) { const o = S.overrides ? S.overrides[key] : null; return blank(o) || !isFinite(o) ? RO.values.get(key) : +o; }
const EPS = 1e-6;

/* ---------- default state: an onshore transfer line over a ridge ---------- */
function defaultState() {
  return {
    name: "Transfer line",
    mode: "pumped",                                          // pumped | gravity
    flow: { Q_design: 1000, Q_min: 600, Q_max: 1200, nLines: 1 },
    start: { type: "level", level: 2.0, pressure: null },   // pumped: suction water level (TDH, optional) · gravity: upstream level or pressure at ch 0
    end: { type: "delivery", z: 16.0, residual: null, level: 16.0 },   // delivery: elevation + residual (REC) · level: downstream water level
    line: { material: "PE100", eps_mm: null, cover: null, submerged: false, transition: "gradual" },
    profile: [
      { x: 0,    ground: 4.0,  cover: null, z: null, label: "Pump station" },
      { x: 150,  ground: 7.5,  cover: null, z: null, label: "" },
      { x: 400,  ground: 14.0, cover: null, z: null, label: "Ridge" },
      { x: 650,  ground: 10.5, cover: null, z: null, label: "" },
      { x: 900,  ground: 8.0,  cover: 1.5,  z: null, label: "Wadi crossing" },
      { x: 1200, ground: 13.5, cover: null, z: null, label: "Tank" }
    ],
    segments: [
      { name: "Discharge reach", x1: 400, dn: 500, sdr: 11, custom: false, od_mm: 500, e_mm: 45.4, joint: "butt_fusion",
        fittings: [{ code: "BFV-L", qty: 1, k: null, kv: null, x: 0 }, { code: "ELB90-LR", qty: 2, k: null, kv: null, x: null }] },
      { name: "Main reach", x1: null, dn: 500, sdr: 17, custom: false, od_mm: 500, e_mm: 29.7, joint: "butt_fusion",
        fittings: [{ code: "BND22", qty: 4, k: null, kv: null, x: null }, { code: "BFV-L", qty: 1, k: null, kv: null, x: 1200 }, { code: "EXIT", qty: 1, k: null, kv: null, x: 1200 }] }
    ],
    surge: { psi: null, fT: null, k_surge: 1.0, t_close: null },
    overrides: {}
  };
}

function newSegment(prev, x1) {
  return { name: "Segment", x1: x1 ?? null, dn: prev ? prev.dn : 500, sdr: prev ? prev.sdr : 17, custom: false,
           od_mm: prev ? prev.od_mm : 500, e_mm: prev ? prev.e_mm : 29.7, joint: prev ? prev.joint : "butt_fusion", fittings: [] };
}

/* ---------- material / roughness applied to every segment ---------- */
function effective(S0) {
  const X = JSON.parse(JSON.stringify(S0));
  const mats = RO.pipeclass.materials();
  const m = mats[X.line.material] || mats.PE100;
  X.segments.forEach(sg => {
    sg.material = X.line.material;
    sg.eps_mm = blank(X.line.eps_mm) ? m.eps : +X.line.eps_mm;
    if (!m.grade) sg.custom = true;                           // non-PE pipes are entered as OD × wall
  });
  return X;
}

/* ---------- profile parsing (paste / CSV) ---------- */
const COLS = [
  ["x", /^(ch|chain|chainage|station|sta|x|dist|distance)\b/i],
  ["ground", /ground|terrain|gl\b|existing|surface/i],
  ["cover", /cover/i],
  ["z", /pipe|invert|centre|center|cl\b|^z\b|level/i],
  ["label", /label|note|desc|remark|name|feature/i]
];
/**
 * Rows (arrays of strings) → profile points in SI. First row may be a header (non-numeric first cell).
 * Header units: "(ft)" / "_ft" → feet, "(m)" / "_m" → metres; otherwise `defaultImperial` decides.
 * Without a header the columns are: chainage, ground, cover, pipe level, label.
 */
function parseProfileRows(rows, defaultImperial) {
  const errors = [];
  const clean = rows.map(r => r.map(c => String(c ?? "").trim())).filter(r => r.some(c => c !== ""));
  if (!clean.length) return { points: [], errors: ["No rows found"] };
  const isNum = s => s !== "" && isFinite(Number(s.replace(/,/g, "")));
  let map = { x: 0, ground: 1, cover: 2, z: 3, label: 4 }, ft = { x: defaultImperial, ground: defaultImperial, cover: defaultImperial, z: defaultImperial };
  let body = clean;
  if (!isNum(clean[0][0])) {
    const head = clean[0];
    map = {};
    head.forEach((h, i) => {
      const hit = COLS.find(([k, re]) => map[k] === undefined && re.test(h));
      if (hit) { map[hit[0]] = i; if (hit[0] !== "label") ft[hit[0]] = /\(ft\)|_ft\b|\bft\b|feet/i.test(h) ? true : (/\(m\)|_m\b|\bm\b/i.test(h) ? false : defaultImperial); }
    });
    if (map.x === undefined) return { points: [], errors: ["No chainage column found (header: chainage / ch / x / station)"] };
    body = clean.slice(1);
  }
  const toM = (k, s) => { if (s === undefined || s === "") return null; const v = Number(String(s).replace(/,/g, "")); if (!isFinite(v)) return NaN; return ft[k] ? v / 3.28084 : v; };
  const points = [];
  body.forEach((r, n) => {
    const p = { x: toM("x", r[map.x]), ground: map.ground !== undefined ? toM("ground", r[map.ground]) : null,
                cover: map.cover !== undefined ? toM("cover", r[map.cover]) : null, z: map.z !== undefined ? toM("z", r[map.z]) : null,
                label: map.label !== undefined ? (r[map.label] || "") : "" };
    const bad = ["x", "ground", "cover", "z"].filter(k => Number.isNaN(p[k]));
    if (p.x === null) { errors.push(`Row ${n + 1}: chainage missing — skipped`); return; }
    if (bad.length) { errors.push(`Row ${n + 1}: not a number in ${bad.join(", ")} — skipped`); return; }
    points.push(p);
  });
  return { points, errors };
}
function profileCsv(points) {
  return RO.csv.stringify(["chainage_m", "ground_m", "cover_m", "pipe_level_m", "label"],
    points.map(p => [p.x, p.ground ?? "", p.cover ?? "", p.z ?? "", p.label || ""]));
}

/* ---------- validation + geometry along the profile ---------- */
function segRanges(S) {
  const P = S.profile, x0 = +P[0].x, xe = +P[P.length - 1].x;
  let xa = x0;
  return S.segments.map((sg, i) => {
    const last = i === S.segments.length - 1;
    const xb = last ? xe : +sg.x1;
    const r = { i, xa, xb };
    xa = xb;
    return r;
  });
}

function validate(S) {
  const errs = [];
  const P = S.profile || [];
  if (P.length < 2) errs.push("Enter at least two profile points");
  P.forEach((p, k) => {
    if (blank(p.x) || !isFinite(p.x)) errs.push(`Profile point ${k + 1}: chainage missing`);
    else if (k > 0 && !(+p.x > +P[k - 1].x)) errs.push(`Profile point ${k + 1}: chainage must increase (${p.x} after ${P[k - 1].x}) — to lengthen one reach, edit its Length column instead; later points move with it`);
    if (blank(p.z) && blank(p.ground)) errs.push(`Profile point ${k + 1}: enter a ground level or a pipe level`);
  });
  if (!S.segments.length) errs.push("Add at least one segment");
  if (errs.length) return errs;
  const x0 = +P[0].x, xe = +P[P.length - 1].x;
  segRanges(S).forEach(r => {
    const sg = S.segments[r.i];
    if (r.i < S.segments.length - 1 && (blank(sg.x1) || !isFinite(sg.x1))) errs.push(`${sg.name}: enter the end chainage`);
    else if (!(r.xb > r.xa + EPS)) errs.push(`${sg.name}: end chainage must be after ${r.xa.toFixed(1)} m`);
    else if (r.xb > xe + EPS) errs.push(`${sg.name}: ends at ${r.xb} m, beyond the profile end ${xe} m — lengthen the profile (Length column) or lower the end chainage`);
  });
  if (x0 > 0 && errs.length === 0) { /* a profile may start at any chainage */ }
  return errs;
}

/** Pipe centreline z at every profile point (equations.md §5A), plus interpolated segment boundaries. */
function buildGeometry(S) {
  const cover0 = recOr(S.line.cover, "pipeline.cover_m");
  const ranges = segRanges(S);
  const geoms = S.segments.map(sg => RO.route.geom(sg));
  const segAt = x => { const r = ranges.find(rr => x <= rr.xb + EPS); return r ? r.i : ranges.length - 1; };
  const pts = S.profile.map((p, k) => {
    const i = segAt(+p.x), OD = geoms[i].OD / 1000;
    const cover = blank(p.cover) ? cover0 : +p.cover;
    const zGiven = !blank(p.z);
    const z = zGiven ? +p.z : +p.ground - cover - OD / 2;
    return { k, x: +p.x, ground: num(p.ground), cover: zGiven ? (blank(p.ground) ? null : +p.ground - z - OD / 2) : cover, z, zGiven, label: p.label || "", seg: i, kind: "pt" };
  });
  const interp = (x, key) => {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (x >= a.x - EPS && x <= b.x + EPS) {
        if (a[key] === null || b[key] === null) return null;
        const t = (x - a.x) / (b.x - a.x || 1);
        return a[key] + t * (b[key] - a[key]);
      }
    }
    return null;
  };
  // per segment: its ordered points [xa … xb] including boundaries
  const segPts = ranges.map(r => {
    const inner = pts.filter(p => p.x > r.xa + EPS && p.x < r.xb - EPS);
    const end = x => pts.find(p => Math.abs(p.x - x) < EPS) || { x, z: interp(x, "z"), ground: interp(x, "ground"), label: "", kind: "bnd" };
    return [end(r.xa), ...inner, end(r.xb)];
  });
  const segGeo = ranges.map((r, i) => {
    const sp = segPts[i];
    let La = 0;
    for (let k = 1; k < sp.length; k++) La += Math.hypot(sp[k].x - sp[k - 1].x, sp[k].z - sp[k - 1].z);
    return Object.assign({}, r, { pts: sp, Lh: r.xb - r.xa, La, zA: sp[0].z, zB: sp[sp.length - 1].z, dz: sp[sp.length - 1].z - sp[0].z, g: geoms[i] });
  });
  return { pts, segGeo, cover0, interp };
}

/**
 * Set the horizontal length of reach k (point k−1 → point k) and move everything after it:
 * later profile points, segment ends and located fittings shift by the change; segment ends
 * and fittings inside the edited reach scale with it. Mutates S. Returns false if not applicable.
 */
function setReachLength(S, k, len) {
  const P = S.profile;
  if (!(k >= 1 && k < P.length) || !(len > 0)) return false;
  const a = +P[k - 1].x, b = +P[k].x, old = b - a;
  if (!isFinite(a) || !isFinite(b) || !(old > 0)) return false;
  const d = len - old;
  const move = x => (blank(x) || !isFinite(x) ? x : (+x >= b - EPS ? +x + d : +x > a + EPS ? a + (+x - a) * len / old : +x));
  for (let j = k; j < P.length; j++) P[j].x = +(+P[j].x + d).toFixed(6);
  S.segments.forEach(sg => { if (!blank(sg.x1)) sg.x1 = +move(sg.x1).toFixed(6); (sg.fittings || []).forEach(f => { if (!blank(f.x)) f.x = +move(f.x).toFixed(6); }); });
  return true;
}

/* ---------- route side for the shared engine ---------- */
function routeSide(X, geo) {
  return {
    nLines: Math.max(1, Math.round(+X.flow.nLines || 1)), transition: X.line.transition || "gradual",
    segments: X.segments.map((sg, i) => RO.route.newSegment({
      name: sg.name, material: sg.material, custom: !!sg.custom, dn: +sg.dn, sdr: +sg.sdr, od_mm: +sg.od_mm, e_mm: +sg.e_mm,
      eps_mm: sg.eps_mm, L_m: geo.segGeo[i].La, dz_m: geo.segGeo[i].dz, joint: sg.joint,
      fittings: (sg.fittings || []).map(f => ({ code: f.code, qty: f.qty, k: f.k, kv: f.kv }))
    }))
  };
}

/* ---------- loss along the line (stations with steps at fittings / transitions) ---------- */
function stationsAlong(X, geo, ev, warnings) {
  const out = [];
  let h = 0;
  geo.segGeo.forEach((sgG, i) => {
    const s = ev.segs[i], sg = X.segments[i];
    const t = ev.trans.find(tr => tr.index === i);
    if (t) h += t.h;                                           // step at the diameter change (previous segment already emitted the point before it)
    // located vs spread fittings
    const located = [];
    let hmSpread = 0;
    s.fits.forEach(fx => {
      const f = sg.fittings[fx.j];
      const hasX = f && !blank(f.x) && isFinite(f.x);
      if (hasX && +f.x >= sgG.xa - EPS && +f.x <= sgG.xb + EPS) located.push({ x: +f.x, hm: fx.hm, code: fx.code, name: fx.name, qty: fx.qty });
      else {
        if (hasX) warnings.push(`${sg.name}: ${fx.code} at ${(+f.x).toFixed(1)} m is outside the segment (${sgG.xa.toFixed(1)}–${sgG.xb.toFixed(1)} m) — spread along the segment`);
        hmSpread += fx.hm;
      }
    });
    const rate = sgG.La > 0 ? (s.hf + hmSpread) / sgG.La : 0;
    // station list: segment points + located fittings (z interpolated)
    const st = sgG.pts.map(p => ({ x: p.x, z: p.z, ground: p.ground, label: p.label, kind: p.kind || "pt" }));
    located.forEach(L => { if (!st.some(p => Math.abs(p.x - L.x) < EPS)) st.push({ x: L.x, z: geo.interp(L.x, "z"), ground: geo.interp(L.x, "ground"), label: "", kind: "fit" }); });
    st.sort((a, b) => a.x - b.x);
    let sAlong = 0, h0 = h;
    st.forEach((p, k) => {
      if (k > 0) sAlong += Math.hypot(p.x - st[k - 1].x, p.z - st[k - 1].z);
      const hBase = h0 + rate * sAlong;
      const here = located.filter(L => Math.abs(L.x - p.x) < EPS);
      const before = located.filter(L => L.x < p.x - EPS).reduce((a, L) => a + L.hm, 0);
      const stepHere = here.reduce((a, L) => a + L.hm, 0);
      const skipDup = k === 0 && i > 0 && !t;                // boundary already emitted by the previous segment
      if (!skipDup || here.length) out.push({ x: p.x, z: p.z, ground: p.ground, h: hBase + before, seg: i, V: s.V, kind: p.kind, label: p.label, fits: here.length ? here : null });
      if (here.length) out.push({ x: p.x, z: p.z, ground: p.ground, h: hBase + before + stepHere, seg: i, V: s.V, kind: "fit-out", label: p.label, fits: here });
      if (k === st.length - 1) h = hBase + before + stepHere;
    });
  });
  return { stations: out, hEnd: h };
}

/* ---------- high / low points (interior local extrema, flat runs once) ---------- */
function extrema(pts) {
  const runs = [];
  pts.forEach(p => { const last = runs[runs.length - 1]; if (last && Math.abs(last.z - p.z) < 1e-4) last.to = p; else runs.push({ z: p.z, from: p, to: p }); });
  const highs = [], lows = [];
  for (let k = 1; k < runs.length - 1; k++) {
    const a = runs[k - 1].z, b = runs[k].z, c = runs[k + 1].z;
    if (b > a && b > c) highs.push(runs[k].from);
    if (b < a && b < c) lows.push(runs[k].from);
  }
  return { highs, lows };
}

/* ---------- suggested bends where the profile deflects ---------- */
const BENDS = [[16.875, "BND11", 11.25], [33.75, "BND22", 22.5], [67.5, "BND45-LR", 45], [999, "BND90-3D", 90]];
function bendSuggestions(X, geo) {
  const lim = crit(X, "pipeline.bend_min_deg");
  const P = geo.pts, out = [];
  for (let k = 1; k < P.length - 1; k++) {
    const a1 = Math.atan2(P[k].z - P[k - 1].z, P[k].x - P[k - 1].x), a2 = Math.atan2(P[k + 1].z - P[k].z, P[k + 1].x - P[k].x);
    const deg = Math.abs(a2 - a1) * 180 / Math.PI;
    if (deg >= lim) {
      const b = BENDS.find(r => deg <= r[0]);
      const sg = X.segments[P[k].seg];
      const already = (sg.fittings || []).some(f => !blank(f.x) && Math.abs(+f.x - P[k].x) < 0.01 && /^BND|^ELB/.test(f.code));
      out.push({ x: P[k].x, seg: P[k].seg, deg, code: b[1], std: b[2], crest: a2 < a1, already });
    }
  }
  return out;
}

/* ---------- main compute ---------- */
function computeCore(S0, F, opts = {}) {
  const X = effective(S0);
  const errors = validate(X);
  if (!(+X.flow.Q_design > 0)) errors.push("Enter the design flow");
  if (errors.length) return { errors };
  const geo = buildGeometry(X);
  const side = routeSide(X, geo);
  const Q = +X.flow.Q_design / 3600;
  const ev = RO.route.evalSide(side, Q, F);
  if (ev.errors.length) return { errors: ev.errors };
  const warnings = [...new Set(ev.warnings)];
  const { stations, hEnd } = stationsAlong(X, geo, ev, warnings);
  const rg = F.rho * G;
  const hTotal = ev.h;
  const P = geo.pts, z0 = P[0].z, zE = P[P.length - 1].z;

  // end / start conditions
  const residual = recOr(X.end.residual, "pipeline.residual_bar");
  let HGLend;
  if (X.end.type === "level") { if (blank(X.end.level)) return { errors: ["Enter the downstream water level"] }; HGLend = +X.end.level; }
  else { const zd = blank(X.end.z) ? zE : +X.end.z; HGLend = zd + residual * 1e5 / rg; }
  let HGL0, Hin = null, Pin = null, TDH = null, available = null, margin = null, Qcap = null;
  if (X.mode === "gravity") {
    if (X.start.type === "pressure") { if (blank(X.start.pressure)) return { errors: ["Enter the pressure at chainage 0"] }; HGL0 = z0 + +X.start.pressure * 1e5 / rg; }
    else { if (blank(X.start.level)) return { errors: ["Enter the upstream water level"] }; HGL0 = +X.start.level; }
    available = HGL0 - HGLend;
    margin = available - hTotal;
    if (!opts.light) Qcap = capacity(side, F, available, Q);
  } else {
    Hin = HGLend + hTotal;
    HGL0 = Hin;
    Pin = rg * (Hin - z0) / 1e5;
    if (X.start.type === "level" && !blank(X.start.level)) TDH = Hin - +X.start.level;
  }
  const HGLstatic = X.mode === "gravity" ? HGL0 : HGLend;
  const Pv_g = (F.Pv - PATM) / 1e5;

  stations.forEach(s => {
    s.HGL = HGL0 - s.h;
    s.EGL = s.HGL + s.V * s.V / (2 * G);
    s.p = rg * (s.HGL - s.z) / 1e5;
    s.pStatic = rg * (HGLstatic - s.z) / 1e5;
  });

  // pressure extremes and sub-atmospheric zones
  const pmin = stations.reduce((a, s) => (s.p < a.p ? s : a), stations[0]);
  const pmax = stations.reduce((a, s) => (Math.max(s.p, s.pStatic) > Math.max(a.p, a.pStatic) ? s : a), stations[0]);
  const zones = [];
  for (let k = 1; k < stations.length; k++) {
    const a = stations[k - 1], b = stations[k];
    if (a.p >= 0 && b.p >= 0) continue;
    const xa = a.p < 0 ? a.x : a.x + (b.x - a.x) * a.p / (a.p - b.p);
    const xb = b.p < 0 ? b.x : a.x + (b.x - a.x) * a.p / (a.p - b.p);
    const last = zones[zones.length - 1];
    if (last && Math.abs(last.x1 - xa) < EPS) last.x1 = xb; else zones.push({ x0: xa, x1: xb });
  }

  // segments: hydraulics + surge + class
  const mats = RO.pipeclass.materials();
  const psiDefault = RO.values.get("surge.psi_pe");
  const psi = blank(X.surge.psi) || !(+X.surge.psi > 0) ? psiDefault : +X.surge.psi;
  let TcSum = 0;
  const segs = geo.segGeo.map((g, i) => {
    const s = ev.segs[i], m = mats[X.line.material] || {};
    const E = (m.E || 1) * 1e9;
    const a = RO.hyd.waveSpeed(F.K, F.rho, E, s.g.D, s.g.e / 1000, psi);
    TcSum += g.La / a;
    return { i, name: X.segments[i].name, geo: g, ev: s, E, a, dP: F.rho * a * s.V / 1e5, st: stations.filter(x => x.seg === i) };
  });
  const gov = segs.reduce((b, r) => (r.dP > b.dP ? r : b), segs[0]);
  const dPgov = gov.dP;
  segs.forEach(r => {
    r.pSteadyMax = Math.max(...r.st.map(x => Math.max(x.p, x.pStatic)));
    r.pMin = Math.min(...r.st.map(x => x.p));
    r.peak = r.pSteadyMax + dPgov;
    r.min = r.pMin - dPgov;
    const grade = (mats[X.line.material] || {}).grade;
    r.cls = grade ? RO.pipeclass.classCheck({ OD: r.ev.g.OD, e: r.ev.g.e, grade, T: F.T, fT_override: X.surge.fT, k_surge: X.surge.k_surge }) : null;
  });
  stations.forEach(s => { s.peak = Math.max(s.p, s.pStatic) + dPgov; s.min = s.p - dPgov; });
  const surge = { psi, psiDefault, gov, dPgov, Tc: 2 * TcSum };

  const ex = extrema(P);
  const valves = X.line.submerged ? { highs: [], lows: [] } : ex;

  // checks
  const checks = [];
  const vmin = crit(X, X.mode === "gravity" ? "velocity.gravity_min" : "velocity.discharge_min");
  const vmax = crit(X, X.mode === "gravity" ? "velocity.gravity_max" : "velocity.discharge_max");
  const pLim = crit(X, "pipeline.min_pressure_bar");
  segs.forEach(r => {
    const V = r.ev.V, ok = V >= vmin && V <= vmax;
    checks.push({ key: "vel", status: ok ? "pass" : (V > vmax ? "fail" : "warn"), seg: r.i, V, vmin, vmax, text: `${r.name}: velocity ${ok ? "within" : "outside"} limits` });
  });
  checks.push({ key: "pmin", status: pmin.p < Pv_g ? "fail" : pmin.p < 0 ? "fail" : pmin.p < pLim ? "warn" : "pass", p: pmin.p, x: pmin.x, lim: pLim, Pv_g });
  segs.forEach(r => {
    if (!r.cls) { checks.push({ key: "cls-na", status: "warn", seg: r.i, peak: r.peak }); return; }
    checks.push({ key: "pfa", status: r.cls.PFA != null && r.pSteadyMax <= r.cls.PFA ? "pass" : "fail", seg: r.i, p: r.pSteadyMax, PFA: r.cls.PFA, PN: r.cls.PN_rated, fT: r.cls.fT });
    checks.push({ key: "pma", status: r.cls.PMA != null && r.peak <= r.cls.PMA ? "pass" : "fail", seg: r.i, p: r.peak, PMA: r.cls.PMA, k: r.cls.k_surge });
    if (r.cls.catStatus !== "ok" && X.segments[r.i].custom) checks.push({ key: "wall", status: r.cls.catStatus === "thin" ? "fail" : "warn", seg: r.i, near: r.cls.near, cat: r.cls.catStatus });
  });
  const minSurge = segs.reduce((a, r) => (r.min < a.min ? r : a), segs[0]);
  checks.push({ key: "downsurge", status: minSurge.min >= 0 ? "pass" : (minSurge.min > Pv_g ? "warn" : "fail"), seg: minSurge.i, p: minSurge.min, Pv_g });
  if (X.mode === "gravity") {
    checks.push({ key: "cap", status: margin >= 0 ? "pass" : "fail", Qcap, Qd: +X.flow.Q_design, margin });
  }
  if (X.line.submerged) checks.push({ key: "sub", status: "note" });
  else {
    checks.push({ key: "av", status: ex.highs.length ? "note" : "pass", list: ex.highs.map(p => p.x) });
    if (ex.lows.length) checks.push({ key: "drain", status: "note", list: ex.lows.map(p => p.x) });
  }
  if (!blank(X.surge.t_close) && +X.surge.t_close > 0) checks.push({ key: "tclose", status: +X.surge.t_close > surge.Tc ? "pass" : "warn", t: +X.surge.t_close, Tc: surge.Tc });

  const Lh = geo.segGeo.reduce((a, g) => a + g.Lh, 0), La = geo.segGeo.reduce((a, g) => a + g.La, 0);
  const R = { X, geo, side, ev, stations, hTotal, hf: ev.segs.reduce((a, s) => a + s.hf, 0), HGL0, HGLend, HGLstatic, residual, Hin, Pin, TDH, available, margin, Qcap,
              z0, zE, pmin, pmax, zones, segs, surge, extrema: ex, valves, checks, warnings, Lh, La, Pv_g, nLines: side.nLines };
  if (!opts.light) {
    R.bends = bendSuggestions(X, geo);
    R.range = flowRange(X, F, side, R);
    R.quantities = quantities(X, R);
    R.compare = compareDiameters(S0, F, R);
  }
  return R;
}

/** Gravity capacity: Q where h_total(Q) = available head (bisection; h rises with Q). */
function capacity(side, F, available, Qd) {
  if (!(available > 0)) return 0;
  const h = q => RO.route.evalSide(side, q, F).h;
  let lo = 0, hi = Math.max(Qd, 1e-4);
  let n = 0;
  while (h(hi) < available && n++ < 40) hi *= 2;
  if (h(hi) < available) return hi * 3600;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (h(mid) > available) hi = mid; else lo = mid; }
  return (lo + hi) / 2 * 3600;
}

function flowRange(X, F, side, R) {
  const qs = [+X.flow.Q_min, +X.flow.Q_design, +X.flow.Q_max].filter(q => q > 0);
  const uniq = [...new Set(qs)].sort((a, b) => a - b);
  const rg = F.rho * G;
  return uniq.map(q => {
    const ev = RO.route.evalSide(side, q / 3600, F);
    const Vmax = Math.max(...ev.segs.map(s => s.V || 0));
    const row = { Q: q, h: ev.h, Vmax, design: q === +X.flow.Q_design };
    if (X.mode === "gravity") row.margin = R.available - ev.h;
    else { row.Pin = rg * (R.HGLend + ev.h - R.z0) / 1e5; row.Hin = R.HGLend + ev.h; if (R.TDH !== null) row.TDH = R.HGLend + ev.h - +X.start.level; }
    return row;
  });
}

function quantities(X, R) {
  const n = R.nLines, pipes = {}, fits = {};
  R.segs.forEach(r => {
    const sg = X.segments[r.i], g = r.ev.g;
    const key = sg.custom ? `${X.line.material}|${g.OD}×${g.e.toFixed(1)}` : `${X.line.material}|${g.OD}|SDR ${sg.sdr}`;
    const p = pipes[key] || (pipes[key] = { material: X.line.material, OD: g.OD, e: g.e, sdr: sg.custom ? null : +sg.sdr, custom: !!sg.custom, La: 0, Lh: 0, joints: {} });
    p.La += r.geo.La * n; p.Lh += r.geo.Lh * n;
    p.joints[sg.joint] = (p.joints[sg.joint] || 0) + r.geo.La * n;
    (sg.fittings || []).forEach(f => {
      if (!(+f.qty > 0)) return;
      const item = RO.fittings.resolve(f.code, g.OD).item;
      const k = `${f.code}|${g.OD}`;
      const o = fits[k] || (fits[k] = { code: f.code, name: item ? item.name : f.code, OD: g.OD, qty: 0, bom: item ? item.bom !== false && item.bom !== "no" : true });
      o.qty += +f.qty * n;
    });
  });
  return { pipes: Object.values(pipes), fittings: Object.values(fits) };
}

/** Same profile with every catalogue segment at a candidate OD (same SDR). */
function compareDiameters(S0, F, R) {
  const cat = S0.segments.map((sg, i) => ({ sg, i })).filter(o => !o.sg.custom);
  if (!cat.length || !(RO.pipeclass.materials()[S0.line.material] || {}).grade) return { rows: [], note: "Diameter comparison needs catalogue PE segments" };
  const base = cat.reduce((a, o) => (R.geo.segGeo[o.i].La > R.geo.segGeo[a.i].La ? o : a), cat[0]);
  const list = RO.pipes.ISO_OD_LIST, bi = list.indexOf(+base.sg.dn);
  const ods = list.slice(Math.max(0, bi - 2), bi + 3);
  const rows = ods.map(od => {
    const S1 = JSON.parse(JSON.stringify(S0));
    S1.segments.forEach(sg => { if (!sg.custom) { sg.dn = od; sg.od_mm = od; } });
    const r = computeCore(S1, F, { light: true });
    if (r.errors) return { od, error: r.errors[0] };
    const fails = r.checks.filter(c => c.status === "fail").length, warns = r.checks.filter(c => c.status === "warn").length;
    const pns = r.segs.map(s => (s.cls ? s.cls.PN_rated : null)).filter(v => v != null);
    return { od, current: od === +base.sg.dn, Vmax: Math.max(...r.segs.map(s => s.ev.V)), h: r.hTotal, Pin: r.Pin, TDH: r.TDH, margin: r.margin,
             Qcap: null, pmax: Math.max(...r.segs.map(s => s.pSteadyMax)), peak: Math.max(...r.segs.map(s => s.peak)),
             pn: pns.length ? Math.min(...pns) : null, fails, warns };
  });
  if (S0.mode === "gravity") rows.forEach(row => {
    if (row.error) return;
    const S1 = JSON.parse(JSON.stringify(S0));
    S1.segments.forEach(sg => { if (!sg.custom) { sg.dn = row.od; sg.od_mm = row.od; } });
    const X1 = effective(S1), geo1 = buildGeometry(X1);
    row.Qcap = capacity(routeSide(X1, geo1), F, R.available, +S0.flow.Q_design / 3600);
  });
  return { rows, baseName: base.sg.name, sdrNote: [...new Set(cat.map(o => o.sg.sdr))].map(s => "SDR " + s).join(", ") };
}

function compute(S, F) { return computeCore(S, F); }

/* ---------- Send to Intake: segments + profile for the Intake route ---------- */
function toIntakeRoute(S, R) {
  const X = effective(S);
  return {
    name: S.name || "Pipeline",
    material: S.line.material, eps_mm: S.line.eps_mm, transition: S.line.transition, nLines: R.nLines,
    segments: X.segments.map((sg, i) => RO.route.newSegment({
      name: sg.name, custom: !!sg.custom, dn: +sg.dn, sdr: +sg.sdr, od_mm: +sg.od_mm, e_mm: +sg.e_mm,
      L_m: +R.geo.segGeo[i].La.toFixed(2), dz_m: +R.geo.segGeo[i].dz.toFixed(3), joint: sg.joint,
      fittings: (sg.fittings || []).map(f => ({ code: f.code, qty: f.qty, k: f.k ?? null, kv: f.kv ?? null }))
    })),
    profile: { name: S.name || "Pipeline", pts: R.geo.pts.map(p => [p.x, +p.z.toFixed(3), p.ground]), bounds: R.geo.segGeo.slice(0, -1).map(g => g.xb) }
  };
}

RO.pipelineCalc = { defaultState, newSegment, effective, validate, buildGeometry, segRanges, setReachLength, parseProfileRows, profileCsv, extrema,
                    bendSuggestions, capacity, compute, computeCore, toIntakeRoute, crit, recOr, blank };
})(window.RO = window.RO || {});
