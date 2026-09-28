/* ============================================================
   Pump curve fitting + operating points (PRD §7, equations.md §6).
   Flows in m³/h, heads in m.
   ============================================================ */
(function (RO) {
"use strict";

/** Least-squares polynomial fit on x scaled to [0,1] for conditioning. Returns { fn, coeffs, maxResid, r2 }. */
function polyfit(xs, ys, deg) {
  const n = xs.length;
  deg = Math.min(deg, n - 1);
  const xmax = Math.max(...xs.map(Math.abs)) || 1;
  const X = xs.map(x => x / xmax);
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    const pw = [1];
    for (let k = 1; k <= 2 * deg; k++) pw[k] = pw[k - 1] * X[i];
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) A[r][c] += pw[r + c];
      A[r][m] += pw[r] * ys[i];
    }
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-14) return null;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  const coeffs = A.map((row, i) => row[m] / row[i]);
  const fn = x => { const t = x / xmax; let s = 0, p = 1; for (const cf of coeffs) { s += cf * p; p *= t; } return s; };
  let ss = 0, st = 0, maxResid = 0;
  const mean = ys.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - fn(xs[i]);
    ss += r * r; st += (ys[i] - mean) ** 2;
    maxResid = Math.max(maxResid, Math.abs(r));
  }
  return { fn, coeffs, xmax, deg, maxResid, r2: st > 0 ? 1 - ss / st : 1 };
}

/** Fit a pump record { points:[{q_m3h,h_m,eff_pct,npshr_m,power_kw}], bep_flow_m3h, min_flow_m3h, motor_kw }. */
function fit(pump) {
  const pts = (pump.points || []).filter(p => isFinite(p.q_m3h) && isFinite(p.h_m)).sort((a, b) => a.q_m3h - b.q_m3h);
  if (pts.length < 3) return { error: "At least 3 curve points needed" };
  const q = pts.map(p => p.q_m3h);
  const H = polyfit(q, pts.map(p => p.h_m), pts.length >= 6 ? 3 : 2);
  if (!H) return { error: "Curve points cannot be fitted" };
  const sub = key => pts.filter(p => p[key] !== null && p[key] !== undefined && p[key] !== "" && isFinite(p[key]));
  const ep = sub("eff_pct"), np = sub("npshr_m"), pp = sub("power_kw");
  const eta = ep.length >= 3 ? polyfit(ep.map(p => p.q_m3h), ep.map(p => +p.eff_pct), 2) : null;
  const npshr = np.length >= 2 ? polyfit(np.map(p => p.q_m3h), np.map(p => +p.npshr_m), np.length >= 3 ? 2 : 1) : null;
  const power = pp.length >= 2 ? polyfit(pp.map(p => p.q_m3h), pp.map(p => +p.power_kw), pp.length >= 3 ? 2 : 1) : null;
  const Qmax = q[q.length - 1];
  let bep = +pump.bep_flow_m3h > 0 ? +pump.bep_flow_m3h : null, bepSource = "datasheet";
  if (!bep && eta) {
    let best = -Infinity;
    for (let i = 0; i <= 200; i++) { const Q = Qmax * i / 200, e = eta.fn(Q); if (e > best) { best = e; bep = Q; } }
    bepSource = "max of fitted η curve";
  }
  const warnings = [];
  if (H.maxResid > 0.02 * Math.max(...pts.map(p => p.h_m))) warnings.push(`H(Q) fit residual ${H.maxResid.toFixed(2)} m — check the curve points`);
  for (let i = 1; i <= 50; i++) {
    const Q = Qmax * i / 50;
    if (H.fn(Q) > H.fn(Q - Qmax / 50) + 1e-6 && Q > Qmax * 0.2) { warnings.push("Fitted H(Q) rises with flow in part of the range (unstable / hump curve)"); break; }
  }
  return {
    pump, pts, Qmax, H, eta, npshr, power, bep, bepSource, warnings,
    head: Q => H.fn(Q),
    eff: Q => (eta ? eta.fn(Q) : null),
    npsh: Q => (npshr ? Math.max(npshr.fn(Q), 0) : null)
  };
}

/** First root of f on [a, b] found by scanning then bisection; null if none. */
function root(f, a, b, steps = 400) {
  let x0 = a, f0 = f(a);
  for (let i = 1; i <= steps; i++) {
    const x1 = a + (b - a) * i / steps, f1 = f(x1);
    if (f0 === 0) return x0;
    if (f0 * f1 < 0) {
      let lo = x0, hi = x1, flo = f0;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
      }
      return (lo + hi) / 2;
    }
    x0 = x1; f0 = f1;
  }
  return null;
}

/**
 * Operating point of n identical pumps in parallel against a system curve.
 * sysH(Q_total_m3h) → head. Returns null if the curves don't cross within the fitted range.
 */
function operatingPoint(pf, n, sysH) {
  const Qtop = pf.Qmax * n;
  const Q = root(Qt => pf.head(Qt / n) - sysH(Qt), 0, Qtop);
  if (Q === null) return null;
  const Q1 = Q / n;
  return { Q, Q1, H: pf.head(Q1), eff: pf.eff(Q1), npshr: pf.npsh(Q1) };
}

RO.pumpcurve = { polyfit, fit, root, operatingPoint };
})(window.RO = window.RO || {});
