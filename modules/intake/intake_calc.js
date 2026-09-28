/* ============================================================
   Intake — calculation layer (no DOM). PRD §5–8, equations.md §3–9.
   RO.intakeCalc.compute(S, F, pump?) → results for every tab.
   ============================================================ */
(function (RO) {
"use strict";

const { G, PATM } = RO.hyd;

/* ---------- default state ---------- */
function seg(o) { return RO.route.newSegment(o); }
function defaultState() {
  return {
    arrangement: "gravity_pumps",               // gravity_pumps | pumps_only | gravity_only
    flow: { Q_design: 1500, Q_min: 700 },       // total, m³/h
    levels: { LAT: -0.3, HAT: 2.5, seabed: -4.5, inlet_crown: -5.7, sump_min: -1.5, sump_max: 1.0 },
    station: { pump_type: "submersible", z_pump: -3.5, z_delivery: 10, P_delivery: 0, P_source: 0, n_duty: 2, n_standby: 1, retention_s: 180 },
    routes: {
      gravity: { nLines: 2, transition: "gradual", segments: [
        seg({ name: "Sea line", dn: 630, sdr: 17, L_m: 550, fittings: [{ code: "SCR-FOUL50", qty: 1 }, { code: "EXIT", qty: 1 }] })
      ] },
      suction: { nLines: 1, transition: "gradual", segments: [] },
      discharge: { nLines: 1, transition: "gradual", segments: [
        seg({ name: "Pump discharge", dn: 400, sdr: 11, L_m: 8, dz_m: 4, perPump: true, joint: "flanged",
              fittings: [{ code: "CHK-DUAL", qty: 1 }, { code: "BFV-M", qty: 1 }, { code: "ELB90-LR", qty: 2 }] }),
        seg({ name: "Transfer main", dn: 630, sdr: 11, L_m: 550, dz_m: 9.5,
              fittings: [{ code: "TEE-BR", qty: 1 }, { code: "ELB90-LR", qty: 4 }, { code: "BFV-L", qty: 1 }, { code: "EXIT", qty: 1 }] })
      ] }
    },
    surge: { side: "discharge", psi: null, fT: null, k_surge: 1.0, t_close: null },
    selection: { pumpId: null },
    // Design basis (null = use the recommended value, shown with a REC tag in the UI)
    feed: { T: null, tds: null },                                        // °C, mg/L → shared fluid model
    line: { material: "PE100", eps_mm: null },                           // suction + discharge (pumped line)
    gline: { material: "PE100", eps_mm: null },                          // gravity line
    sizing: { residual: null, margin: null, eff_pump: null, eff_motor: null }, // bar, %, %, %
    overrides: {}
  };
}

/* ---------- design basis → compute-ready state ---------- */
const recOr = (v, key) => (v === null || v === undefined || v === "" || !isFinite(v) ? RO.values.get(key) : +v);

/** Salinity (g/kg) from TDS (mg/L): S = TDS / ρ(T, S), iterated (equations.md §1.6). */
function tdsToS(T, tds) {
  let S = tds / 1025;
  for (let i = 0; i < 5; i++) S = tds / RO.fluids.densitySW(T, S).rho;
  return S;
}
/** Fluid-store patch for the feed water (seawater model; custom fluids are set in Tools). */
function feedFluid(S) {
  const T = recOr(S.feed.T, "feed.temp_C"), tds = recOr(S.feed.tds, "feed.tds_mgL");
  return { preset: tds < 1000 ? "fresh" : "sea", T_C: T, S_gkg: +tdsToS(T, tds).toFixed(3) };
}
/** Deep copy with recommended values filled in: line material / roughness on every segment, residual pressure. */
function effective(S) {
  const X = JSON.parse(JSON.stringify(S));
  const mats = RO.pipeclass.materials();
  const blank = v => v === null || v === undefined || v === "" || !isFinite(v);
  const apply = (sides, line) => {
    const m = mats[line.material] || mats.PE100;
    sides.forEach(sd => X.routes[sd].segments.forEach(sg => {
      sg.material = line.material;
      sg.eps_mm = blank(line.eps_mm) ? m.eps : +line.eps_mm;
      if (!m.grade) sg.custom = true;                 // non-PE pipes are entered as OD × wall
    }));
  };
  apply(["suction", "discharge"], X.line);
  apply(["gravity"], X.gline);
  X.station.P_delivery = recOr(S.sizing.residual, "delivery.residual_bar");
  return X;
}

/* IEC standard motor ratings (kW), as in the design. */
const MOTORS = [0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000];

/**
 * Pump sizing (design "Intake pump sizing"): TDH with design margin, hydraulic / shaft / motor-input power,
 * standard motor per duty pump and its load. equations.md §6.1.
 */
function computeSizing(S, F, station, selection) {
  if (!station || station.errors) return null;
  const n = station.n, rg = F.rho * G;
  const margin = recOr(S.sizing.margin, "pump.head_margin_pct") / 100;
  const effSel = selection && selection.opMin && selection.opMin.eff ? selection.opMin.eff : null;
  const ep = (effSel ?? recOr(S.sizing.eff_pump, "pump.eff_pct")) / 100;
  const em = recOr(S.sizing.eff_motor, "motor.eff_pct") / 100;
  const Hbase = station.TDH_min, hmar = Hbase * margin, H = Hbase + hmar;
  const Q = S.flow.Q_design / 3600, Q1 = Q / n;
  const Ph = rg * Q * H / 1000, Ps = Ph / ep, Pin = Ps / em;
  const Ps1 = Ps / n;
  const motorMargin = crit(S, "pump.motor_margin");
  const motor = MOTORS.find(m => m >= Ps1 * motorMargin) || null;
  const load = motor ? Ps1 / motor : null;
  const Hs = station.H_st_min - station.H_press;                            // pure elevation difference
  const hf = station.evS.segs.concat(station.evD.segs).reduce((a, s) => a + s.hf, 0);
  const hm = station.evS.segs.concat(station.evD.segs).reduce((a, s) => a + s.hm, 0)
           + station.evS.trans.concat(station.evD.trans).reduce((a, t) => a + t.h, 0);
  const sumK = station.evS.segs.concat(station.evD.segs).reduce((a, s) => a + s.sumK, 0);
  const main = station.evD.segs.reduce((a, s) => (+s.seg.L_m > +a.seg.L_m ? s : a), station.evD.segs[0]);
  return { n, margin, ep, em, effFromPump: !!effSel, Hbase, hmar, H, Q, Q1, Ph, Ps, Pin, Ps1, Pin1: Pin / n, motor, load, motorMargin,
           hp: station.H_press, Hs, hf, hm, sumK, main };
}

/** Smallest catalogue OD at the segment's SDR giving V ≤ target (recommended size). */
function recOD(seg, Qline, target) {
  if (seg.custom) return null;
  for (const od of RO.pipes.ISO_OD_LIST) {
    const e = RO.pipes.catalogueWall(od, +seg.sdr).e, D = (od - 2 * e) / 1000;
    if (D > 0 && Qline / (Math.PI * D * D / 4) <= target) return od;
  }
  return null;
}

/* ---------- recommended value with optional user override ---------- */
function crit(S, key) {
  const o = S.overrides ? S.overrides[key] : null;
  return o !== null && o !== undefined && o !== "" && isFinite(o) ? +o : RO.values.get(key);
}
const overridden = (S, key) => S.overrides && S.overrides[key] !== null && S.overrides[key] !== undefined && S.overrides[key] !== "";

function sourceLevels(S) {
  return S.arrangement === "pumps_only"
    ? { min: +S.levels.LAT, max: +S.levels.HAT, label: "sea (LAT / HAT)" }
    : { min: +S.levels.sump_min, max: +S.levels.sump_max, label: "sump (min / max)" };
}

const hasGravity = S => S.arrangement !== "pumps_only";
const hasPumps = S => S.arrangement !== "gravity_only";

/* ============ GRAVITY LINE ============ */
function computeGravity(S, F) {
  if (!hasGravity(S)) return null;
  const side = S.routes.gravity;
  const Q = S.flow.Q_design / 3600, Qmin = S.flow.Q_min / 3600;
  const ev = RO.route.evalSide(side, Q, F);
  if (ev.empty) return { errors: ["The gravity line has no segments — add one on the Route tab"] };
  if (ev.errors.length) return { errors: ev.errors, ev };
  const L = S.levels;
  const H_avail_min = L.LAT - L.sump_min, H_avail_max = L.HAT - L.sump_min;
  const margin_LAT = H_avail_min - ev.h, margin_HAT = H_avail_max - ev.h;
  const hf = ev.segs.reduce((a, s) => a + s.hf, 0);
  const hm = ev.segs.reduce((a, s) => a + s.hm, 0) + ev.trans.reduce((a, t) => a + t.h, 0);
  const evMin = RO.route.evalSide(side, Qmin, F, { nLines: 1 });
  const V_qmin = Math.min(...evMin.segs.map(s => s.V));
  const main = ev.segs.reduce((a, s) => (+s.seg.L_m > +a.seg.L_m ? s : a), ev.segs[0]);
  const first = ev.segs[0], last = ev.segs[ev.segs.length - 1];
  // Submergence at the inlet — ANSI/HI 9.8 (equations.md §10)
  const c = crit(S, "submergence.hi_coeff");
  const Fr = first.V / Math.sqrt(G * first.g.D);
  const S_min = first.g.D * (1 + c * Fr);
  const submergence_ok = L.inlet_crown + S_min <= L.LAT;
  // Sump & sediment (legacy intake rules)
  const V_sump = Q * S.station.retention_s;
  const sump_depth = Math.abs(L.sump_min) + 2.0;
  const sump_width = Math.max(2 * last.g.D, 2.0);
  const sump_length = V_sump / (sump_width * sump_depth);
  const V_sc = Math.sqrt(8 * 0.04 / Math.max(main.f, 1e-6) * G * (2.65 - 1) * 0.0002);

  const vmin = crit(S, "velocity.gravity_min"), vmax = crit(S, "velocity.gravity_max");
  const mreq = crit(S, "intake.head_margin_m"), vsed = crit(S, "velocity.sediment_min");
  const ov = k => (overridden(S, k) ? " (user)" : "");
  const checks = [
    { name: "Head margin @ LAT", desc: `≥ ${mreq.toFixed(2)} m${ov("intake.head_margin_m")}`, val: margin_LAT.toFixed(3) + " m",
      status: margin_LAT < mreq ? "fail" : (margin_LAT < 2 * mreq ? "warn" : "pass") },
    { name: "Margin @ HAT (no reverse flow)", desc: "> 0 m", val: margin_HAT.toFixed(3) + " m", status: margin_HAT > 0 ? "pass" : "fail" }
  ];
  ev.segs.forEach(s => checks.push({
    name: `Velocity @ Q_design — ${s.seg.name}`, desc: `${vmin}–${vmax} m/s${ov("velocity.gravity_min") || ov("velocity.gravity_max")}`,
    val: s.V.toFixed(2) + " m/s", status: s.V >= vmin && s.V <= vmax ? "pass" : "fail" }));
  checks.push({ name: "Velocity @ Q_min, one line", desc: `≥ ${vsed} m/s (sediment)${ov("velocity.sediment_min")}`, val: V_qmin.toFixed(2) + " m/s", status: V_qmin >= vsed ? "pass" : "fail" });
  checks.push({ name: "Submergence vs vortex (HI 9.8)", desc: `crown + S ≤ LAT; S = D(1 + ${c}·Fr) = ${S_min.toFixed(3)} m, Fr = ${Fr.toFixed(3)}`,
    val: (L.inlet_crown + S_min).toFixed(2) + " m", status: submergence_ok ? "pass" : "fail" });

  return { ev, evMin, H_avail_min, H_avail_max, margin_LAT, margin_HAT, H_required: ev.h, hf, hm, V_qmin, main, first, last,
           Fr, S_min, submergence_ok, c, V_sump, sump_depth, sump_width, sump_length, V_sc, checks, warnings: ev.warnings };
}

/** Smallest catalogue OD for the longest gravity segment that meets margin and velocity limits. */
function suggestGravityDN(S, F) {
  if (!hasGravity(S)) return null;
  const side = S.routes.gravity;
  if (!side.segments.length) return null;
  const idx = side.segments.reduce((b, s, i, a) => (+s.L_m > +a[b].L_m ? i : b), 0);
  const segRef = side.segments[idx];
  if (segRef.custom) return { index: idx, dn: null, note: "custom pipe — size manually" };
  const L = S.levels, mreq = crit(S, "intake.head_margin_m");
  const vmin = crit(S, "velocity.gravity_min"), vmax = crit(S, "velocity.gravity_max");
  for (const dn of RO.pipes.ISO_OD_LIST.filter(d => d >= 90)) {
    const trial = Object.assign({}, side, { segments: side.segments.map((s, i) => (i === idx ? Object.assign({}, s, { dn }) : s)) });
    const ev = RO.route.evalSide(trial, S.flow.Q_design / 3600, F);
    if (ev.errors.length) continue;
    const V = ev.segs[idx].V;
    if (L.LAT - L.sump_min - ev.h >= mreq && V >= vmin && V <= vmax) return { index: idx, dn, V, margin: L.LAT - L.sump_min - ev.h };
  }
  return { index: idx, dn: null, note: "no catalogue size meets the criteria" };
}

/* ============ PUMP STATION ============ */
function computeStation(S, F) {
  if (!hasPumps(S)) return null;
  const st = S.station, n = Math.max(1, Math.round(st.n_duty));
  const lv = sourceLevels(S);
  const Q = S.flow.Q_design / 3600;
  const opts = { nLines: n, nPumps: n };
  const evS = RO.route.evalSide(S.routes.suction, Q, F, opts);
  const evD = RO.route.evalSide(S.routes.discharge, Q, F, { nPumps: n });
  const errors = evS.errors.concat(evD.errors);
  if (evD.empty) errors.push("The discharge line has no segments — add one on the Route tab");
  if (errors.length) return { errors, evS, evD };
  const rg = F.rho * G;
  const H_press = ((+st.P_delivery || 0) - (+st.P_source || 0)) * 1e5 / rg;
  const H_st_min = st.z_delivery - lv.min + H_press, H_st_max = st.z_delivery - lv.max + H_press;
  const TDH_min = H_st_min + evS.h + evD.h, TDH_max = H_st_max + evS.h + evD.h;
  const P_dis = (+st.P_delivery || 0) + rg * (st.z_delivery - st.z_pump + evD.h) / 1e5;
  const npshBase = level => (PATM + (+st.P_source || 0) * 1e5) / rg + (level - st.z_pump) - F.Pv / rg;
  const hS = Qm3h => (Qm3h <= 0 || evS.empty ? 0 : RO.route.evalSide(S.routes.suction, Qm3h / 3600, F, opts).h);
  const hD = Qm3h => (Qm3h <= 0 ? 0 : RO.route.evalSide(S.routes.discharge, Qm3h / 3600, F, { nPumps: n }).h);
  const sysH = level => Qm3h => st.z_delivery - level + H_press + hS(Qm3h) + hD(Qm3h);
  const NPSHa = npshBase(lv.min) - evS.h;
  const curve = [];
  const Qtop = S.flow.Q_design * 1.5;
  for (let i = 0; i <= 40; i++) {
    const q = Qtop * i / 40, l = hS(q) + hD(q);
    curve.push({ Q: q, Hmin: st.z_delivery - lv.min + H_press + l, Hmax: st.z_delivery - lv.max + H_press + l });
  }
  // Pressure head along the discharge line at the design point
  const Hp0 = P_dis * 1e5 / rg;
  const profile = evD.profile.map(p => ({ x: p.x, p_head: Hp0 - p.loss - p.dz, z: st.z_pump + p.dz, name: p.name }));
  const minP = Math.min(...profile.map(p => p.p_head));

  const smin = crit(S, "velocity.suction_min"), smax = crit(S, "velocity.suction_max");
  const dmin = crit(S, "velocity.discharge_min"), dmax = crit(S, "velocity.discharge_max");
  const checks = [];
  evS.segs.forEach(s => checks.push({ name: `Suction velocity — ${s.seg.name}`, desc: `${smin}–${smax} m/s`, val: s.V.toFixed(2) + " m/s",
    status: s.V > smax ? "fail" : (s.V < smin ? "warn" : "pass") }));
  evD.segs.forEach(s => checks.push({ name: `Discharge velocity — ${s.seg.name}`, desc: `${dmin}–${dmax} m/s`, val: s.V.toFixed(2) + " m/s",
    status: s.V > dmax ? "fail" : (s.V < dmin ? "warn" : "pass") }));
  checks.push({ name: "NPSH available @ Q_design, min level", desc: "must exceed the pump's NPSHr + margin (Pump Selection)", val: NPSHa.toFixed(2) + " m",
    status: NPSHa > 0 ? "pass" : "fail" });
  checks.push({ name: "Min pressure along discharge", desc: "≥ 0 m (no sub-atmospheric pressure)", val: minP.toFixed(2) + " m",
    status: minP >= 0 ? "pass" : "warn" });
  const dzSum = evD.profile[evD.profile.length - 1].dz;
  const warnings = evS.warnings.concat(evD.warnings);
  if (Math.abs(st.z_pump + dzSum - st.z_delivery) > 0.5) {
    warnings.push(`Discharge Δz sum (${dzSum.toFixed(2)} m) ≠ delivery − pump elevation (${(st.z_delivery - st.z_pump).toFixed(2)} m): the pressure profile uses Δz, the static head uses the elevations`);
  }
  return { n, lv, evS, evD, H_press, H_st_min, H_st_max, TDH_min, TDH_max, P_dis, NPSHa, npshBase, hS, hD, sysH, curve, profile, minP,
           Hp0, checks, warnings };
}

/* ============ PUMP SELECTION ============ */
function computeSelection(S, F, station, pump) {
  if (!station || station.errors || !pump) return null;
  const pf = RO.pumpcurve.fit(pump);
  if (pf.error) return { error: pf.error, pump };
  const n = station.n, lv = station.lv, rg = F.rho * G;
  const opAt = (nn, level) => {
    const op = RO.pumpcurve.operatingPoint(pf, nn, station.sysH(level));
    if (!op) return null;
    op.level = level; op.n = nn;
    op.NPSHa = station.npshBase(level) - station.hS(op.Q) ;
    op.P_shaft = op.eff ? rg * (op.Q1 / 3600) * op.H / (op.eff / 100) / 1000 : (pf.power ? pf.power.fn(op.Q1) : null);
    return op;
  };
  const opMin = opAt(n, lv.min), opMax = opAt(n, lv.max), opN1 = n > 1 ? opAt(n - 1, lv.min) : null;
  const porMin = crit(S, "pump.por_min"), porMax = crit(S, "pump.por_max");
  const npshM = crit(S, "pump.npsh_margin_m"), npshR = crit(S, "pump.npsh_ratio"), motorM = crit(S, "pump.motor_margin");
  const checks = [];
  const Qd = S.flow.Q_design;
  checks.push({ name: "Duty flow @ min source level", desc: `Q_op ≥ ${Qd} m³/h with ${n} duty`, val: opMin ? opMin.Q.toFixed(0) + " m³/h" : "no intersection",
    status: opMin && opMin.Q >= Qd * 0.999 ? "pass" : "fail" });
  checks.push({ name: "Operating point @ max source level", desc: "within the entered curve (no runout)", val: opMax ? opMax.Q.toFixed(0) + " m³/h" : "beyond curve",
    status: opMax ? "pass" : "fail" });
  if (pf.bep) {
    [opMin, opMax].forEach((op, i) => {
      if (!op) return;
      const r = op.Q1 / pf.bep;
      checks.push({ name: `POR @ ${i ? "max" : "min"} level`, desc: `${porMin}–${porMax} × BEP (${pf.bep.toFixed(0)} m³/h)`, val: r.toFixed(2) + " × BEP",
        status: r >= porMin && r <= porMax ? "pass" : "warn" });
    });
  } else checks.push({ name: "Preferred operating region", desc: "BEP unknown — enter η points or BEP flow", val: "—", status: "warn" });
  [opMin, opMax].forEach((op, i) => {
    if (!op || op.npshr == null) return;
    const ok = op.NPSHa >= op.npshr + npshM && op.NPSHa >= npshR * op.npshr;
    checks.push({ name: `NPSH @ ${i ? "max" : "min"} level`, desc: `NPSHa ≥ NPSHr + ${npshM} m and ≥ ${npshR} × NPSHr`,
      val: `${op.NPSHa.toFixed(2)} / ${op.npshr.toFixed(2)} m`, status: ok ? "pass" : (op.NPSHa >= op.npshr ? "warn" : "fail") });
  });
  const Pmax = Math.max(...[opMin, opMax, opN1].filter(Boolean).map(o => o.P_shaft || 0));
  if (pump.motor_kw && Pmax > 0) {
    checks.push({ name: "Motor rating", desc: `≥ ${motorM} × max absorbed (${Pmax.toFixed(1)} kW)`, val: pump.motor_kw + " kW",
      status: pump.motor_kw >= motorM * Pmax ? "pass" : "fail" });
  }
  if (pump.min_flow_m3h && opMin) checks.push({ name: "Min continuous flow", desc: `Q per pump ≥ ${pump.min_flow_m3h} m³/h`, val: opMin.Q1.toFixed(0) + " m³/h",
    status: opMin.Q1 >= pump.min_flow_m3h ? "pass" : "fail" });
  checks.push({ name: "Standby", desc: "≥ 1 standby pump", val: S.station.n_standby, status: S.station.n_standby >= 1 ? "pass" : "warn" });
  return { pump, pf, n, opMin, opMax, opN1, Pmax, checks, warnings: pf.warnings };
}

/** Rank library pumps: smallest n (1–6) meeting duty at min level, then lowest absorbed power. */
function rankPumps(S, F, pumps) {
  const out = [];
  pumps.forEach(p => {
    for (let n = 1; n <= 6; n++) {
      const Sx = JSON.parse(JSON.stringify(S)); Sx.station.n_duty = n;
      const st = computeStation(Sx, F);
      const sel = computeSelection(Sx, F, st, p);
      if (!sel || sel.error || !sel.opMin) continue;
      if (sel.opMin.Q >= S.flow.Q_design * 0.999) {
        const fails = sel.checks.filter(c => c.status === "fail").length, warns = sel.checks.filter(c => c.status === "warn").length;
        out.push({ pump: p, n, Q: sel.opMin.Q, P: sel.Pmax * n, fails, warns });
        break;
      }
    }
  });
  return out.sort((a, b) => a.fails - b.fails || a.n - b.n || a.P - b.P);
}

/* ============ SURGE & PIPE CLASS (per segment) ============ */
function computeSurge(S, F, gravity, station, selection) {
  const sideKey = S.surge.side === "gravity" || !hasPumps(S) ? "gravity" : "discharge";
  const src = sideKey === "gravity" ? gravity : station;
  if (!src || src.errors) return { sideKey, errors: ["Fix the " + sideKey + " line first"] };
  const ev = sideKey === "gravity" ? src.ev : src.evD;
  const rg = F.rho * G;
  const mats = RO.pipeclass.materials();
  const psiDefault = crit(S, "surge.psi_pe");
  const psi = S.surge.psi !== null && S.surge.psi !== "" && S.surge.psi > 0 ? +S.surge.psi : psiDefault;
  let loss = 0, dz = 0, TcSum = 0;
  const rows = ev.segs.map((s, i) => {
    const t = ev.trans.find(tr => tr.index === i);
    if (t) loss += t.h;
    const m = mats[s.seg.material] || {};
    const E = (+s.seg.E_GPa > 0 ? +s.seg.E_GPa : m.E || 1) * 1e9;
    const a = RO.hyd.waveSpeed(F.K, F.rho, E, s.g.D, s.g.e / 1000, psi);
    const dP = F.rho * a * s.V / 1e5;
    TcSum += (+s.seg.L_m) / a;
    let P_steady;
    if (sideKey === "discharge") P_steady = rg * (station.Hp0 - loss - dz) / 1e5;
    else P_steady = rg * (S.levels.HAT - (S.levels.inlet_crown + dz) - loss) / 1e5;
    let P_shut = null;
    if (sideKey === "discharge" && selection && selection.pf) {
      // Pump shut-off (closed valve): pump head at Q = 0 plus suction static head at max source level
      P_shut = rg * (selection.pf.head(0) + station.lv.max - S.station.z_pump - dz) / 1e5;
    }
    const row = { i, s, E, a, dP, P_steady, P_shut, P_max_steady: Math.max(P_steady, P_shut ?? -Infinity) };
    loss += s.h; dz += +s.seg.dz_m || 0;
    return row;
  });
  const gov = rows.reduce((b, r) => (r.dP > b.dP ? r : b), rows[0]);
  const dPgov = gov ? gov.dP : 0;
  const Tc = 2 * TcSum;
  const Pv_g = (F.Pv - PATM) / 1e5;
  const checks = [];
  rows.forEach(r => {
    const grade = (mats[r.s.seg.material] || {}).grade;
    r.peak = r.P_max_steady + dPgov;
    r.min = r.P_steady - dPgov;
    if (grade) {
      r.cls = RO.pipeclass.classCheck({ OD: r.s.g.OD, e: r.s.g.e, grade, T: F.T, fT_override: S.surge.fT, k_surge: S.surge.k_surge });
      checks.push({ name: `${r.s.seg.name}: steady ≤ PFA`, desc: `PFA = PN ${r.cls.PN_rated ?? "—"} × ${r.cls.fT.toFixed(2)} = ${r.cls.PFA != null ? r.cls.PFA.toFixed(2) : "—"} bar`,
        val: r.P_max_steady.toFixed(2) + " bar g", status: r.cls.PFA != null && r.P_max_steady <= r.cls.PFA ? "pass" : "fail" });
      checks.push({ name: `${r.s.seg.name}: peak ≤ PMA`, desc: `PMA = ${r.cls.k_surge} × PFA = ${r.cls.PMA != null ? r.cls.PMA.toFixed(2) : "—"} bar`,
        val: r.peak.toFixed(2) + " bar g", status: r.cls.PMA != null && r.peak <= r.cls.PMA ? "pass" : "fail" });
      if (r.cls.catStatus !== "ok" && r.s.seg.custom) checks.push({ name: `${r.s.seg.name}: wall vs catalogue`, desc: `nearest SDR ${r.cls.near}`, val: r.cls.catStatus, status: r.cls.catStatus === "thin" ? "fail" : "warn" });
    } else {
      checks.push({ name: `${r.s.seg.name}: pressure class`, desc: "non-PE material — check against the pipe's rating", val: r.peak.toFixed(2) + " bar g peak", status: "warn" });
    }
    checks.push({ name: `${r.s.seg.name}: downsurge`, desc: `≥ 0 bar g · vapour ≈ ${Pv_g.toFixed(2)} bar g`, val: r.min.toFixed(2) + " bar g",
      status: r.min >= 0 ? "pass" : (r.min > Pv_g ? "warn" : "fail") });
  });
  if (S.surge.t_close > 0) checks.push({ name: "Valve closure vs 2ΣL/a", desc: `t_c > ${Tc.toFixed(2)} s → slow closure`, val: S.surge.t_close + " s", status: S.surge.t_close > Tc ? "pass" : "warn" });
  return { sideKey, rows, gov, dPgov, Tc, psi, psiDefault, Pv_g, checks };
}

/* ============ ALL ============ */
function compute(S0, F, pump) {
  if (F.error) return { fluidError: F.error };
  const S = effective(S0);
  const gravity = computeGravity(S, F);
  const station = computeStation(S, F);
  const selection = computeSelection(S, F, station, pump);
  const surge = computeSurge(S, F, gravity, station, selection);
  const sizing = computeSizing(S, F, station, selection);
  return { S, gravity, station, selection, surge, sizing, suggestion: suggestGravityDN(S, F) };
}

RO.intakeCalc = { defaultState, compute, computeGravity, computeStation, computeSelection, computeSurge, computeSizing, rankPumps, suggestGravityDN,
                  effective, feedFluid, tdsToS, recOD, recOr, MOTORS, sourceLevels, crit, overridden, hasGravity, hasPumps };
})(window.RO = window.RO || {});
