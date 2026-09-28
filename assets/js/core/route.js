/* ============================================================
   Segmented route hydraulics (PRD §5–6, equations.md §3–5).

   Segment: { name, material, custom, dn, sdr, od_mm, e_mm, eps_mm, E_GPa,
              L_m, dz_m, joint, fittings: [{ code, qty, k, kv }] }
            custom=false → OD = dn, e = catalogue wall for (dn, sdr)
   Side:    { nLines, transition: "gradual"|"sudden"|"none", segments: [] }
   ============================================================ */
(function (RO) {
"use strict";

const { G, darcyFriction, regimeOf, circleArea, headLossDW } = RO.hyd;

function geom(seg) {
  let OD, e;
  if (seg.custom) { OD = +seg.od_mm; e = +seg.e_mm; }
  else { OD = +seg.dn; e = RO.pipes.catalogueWall(OD, +seg.sdr).e; }
  const ID = OD - 2 * e;
  const valid = OD > 0 && e > 0 && ID > 0;
  const D = ID / 1000;
  return { OD, e, ID, D, A: valid ? circleArea(D) : NaN, SDR: OD / e, valid };
}

/** Hydraulics of one segment at flow Q_line (m³/s). */
function evalSegment(seg, Qline, fluid) {
  const g = geom(seg);
  const warnings = [];
  if (!g.valid) return { seg, g, error: `${seg.name || "Segment"}: invalid pipe geometry` };
  if (!(seg.L_m >= 0)) return { seg, g, error: `${seg.name || "Segment"}: length must be ≥ 0` };
  const V = Qline / g.A;
  const Re = V * g.D / fluid.nu;
  const eps = (+seg.eps_mm || 0) / 1000;
  const fr = Re > 0 ? darcyFriction(eps, g.D, Re) : { f: 0, method: "none" };
  const vh = V * V / (2 * G);
  const hf = headLossDW(fr.f, +seg.L_m, g.D, V);
  const fits = [];
  let sumK = 0;
  (seg.fittings || []).forEach((f, j) => {
    const qty = +f.qty || 0;
    if (qty <= 0) return;
    const r = RO.fittings.resolve(f.code, g.OD);
    if (!r.item) { warnings.push(r.note); return; }
    if (r.note) warnings.push(r.note);
    let K, method;
    if (f.k !== null && f.k !== undefined && f.k !== "") { K = +f.k; method = "user override"; }
    else {
      const k = RO.fittings.kOf(r.item, g.D, Re, { kv: +f.kv || null });
      if (k.warn) warnings.push(k.warn);
      if (k.K === null) { warnings.push(`${r.item.code}: formula items are applied automatically at diameter changes`); return; }
      K = k.K; method = k.method;
    }
    if (r.item.status === "placeholder" && method !== "user override") warnings.push(`${r.item.code}: placeholder K — use manufacturer data`);
    sumK += qty * K;
    fits.push({ j, code: r.item.code, name: r.item.name, qty, K, method, hm: qty * K * vh, status: r.item.status, overridden: method === "user override" });
  });
  const hm = sumK * vh;
  return {
    seg, g, Q: Qline, V, Re, regime: regimeOf(Re), f: fr.f, fMethod: fr.method, vh, hf, sumK, hm, h: hf + hm,
    hf_km: seg.L_m > 0 ? hf * 1000 / seg.L_m : 0, fits, warnings
  };
}

/** Automatic transition loss between two consecutive segments. */
function transition(a, b, mode) {
  if (mode === "none" || a.error || b.error) return null;
  const D1 = a.g.D, D2 = b.g.D;
  if (Math.abs(D2 - D1) / D1 <= 0.01) return null;
  const contraction = D2 < D1;
  let K, V, label, method;
  if (mode === "sudden") {
    const r = contraction ? (D2 / D1) : (D1 / D2);
    K = contraction ? 0.5 * (1 - r * r) : Math.pow(1 - r * r, 2);
    V = contraction ? b.V : a.V;
    label = contraction ? "Sudden contraction" : "Sudden expansion";
    method = contraction ? "K = 0.5(1 − (D₂/D₁)²) @ V₂" : "K = (1 − (D₁/D₂)²)² @ V₁";
  } else {
    const code = contraction ? "RED-CONC" : "EXP-CONC";
    const r = RO.fittings.resolve(code, contraction ? b.g.OD : a.g.OD);
    K = r.item ? RO.fittings.kOf(r.item, Math.min(D1, D2), 1e6).K : (contraction ? 0.05 : 0.2);
    V = contraction ? b.V : a.V;                  // small-end velocity
    label = contraction ? "Gradual reducer" : "Gradual expander";
    method = `${code} K @ small-end V`;
  }
  return { from: a.seg.name, to: b.seg.name, label, K, V, method, h: K * V * V / (2 * G), contraction };
}

/**
 * Evaluate one side of the route at total flow Q (m³/s).
 * opts.nLines overrides side.nLines; opts.nPumps = duty pumps — segments flagged
 * perPump (pump-local piping) carry Q / nPumps instead of Q / nLines.
 */
function evalSide(side, Qtotal, fluid, opts = {}) {
  const nLines = Math.max(1, Math.round(opts.nLines || side.nLines || 1));
  const nPumps = Math.max(1, Math.round(opts.nPumps || 1));
  const Qline = Qtotal / nLines;
  const segs = (side.segments || []).map(s => evalSegment(s, s.perPump && opts.nPumps ? Qtotal / nPumps : Qline, fluid));
  const errors = segs.filter(s => s.error).map(s => s.error);
  const trans = [];
  for (let i = 1; i < segs.length; i++) {
    const t = transition(segs[i - 1], segs[i], side.transition || "gradual");
    if (t) trans.push(Object.assign(t, { index: i }));
  }
  let h = 0, L = 0, x = 0, loss = 0, z = 0;
  const profile = [{ x: 0, loss: 0, dz: 0 }];
  segs.forEach((s, i) => {
    if (s.error) return;
    const t = trans.find(tr => tr.index === i);
    if (t) loss += t.h;
    loss += s.h;
    x += +s.seg.L_m;
    z += +s.seg.dz_m || 0;
    profile.push({ x, loss, dz: z, name: s.seg.name });
    h += s.h;
    L += +s.seg.L_m;
  });
  trans.forEach(t => { h += t.h; });
  const warnings = [].concat(...segs.filter(s => !s.error).map(s => s.warnings));
  return { nLines, Qline, segs, trans, h, L, profile, errors, warnings, empty: segs.length === 0 };
}

/** Head loss of a side as a function of total flow (m³/s) — for system curves. */
function lossFn(side, fluid, opts) {
  return Q => (Q <= 0 ? 0 : evalSide(side, Q, fluid, opts).h);
}

function newSegment(over = {}) {
  return Object.assign({
    name: "Segment", material: "PE100", custom: false, dn: 500, sdr: 17, od_mm: 500, e_mm: 29.7,
    eps_mm: 0.0015, L_m: 100, dz_m: 0, joint: "butt_fusion", perPump: false, fittings: []
  }, over);
}

RO.route = { geom, evalSegment, evalSide, lossFn, transition, newSegment };
})(window.RO = window.RO || {});
