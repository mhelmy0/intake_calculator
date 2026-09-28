/* ============================================================
   Bill of materials — calculation layer (no DOM). equations.md §9B.
   Sources: Intake route (gravity / suction / discharge), Tools › Pipeline
   design line, Supports & buoyancy blocks, Intake pump station.
   Route line segment: { source, name, material, OD, e, sdr, custom, L, joint, mult, fittings:[{code, qty}] }
   ============================================================ */
(function (RO) {
"use strict";

const blank = v => v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));
const recOr = (v, key) => (blank(v) || !isFinite(v) ? RO.values.get(key) : +v);
const DN_LIST = [50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000];
const JOINT_LABEL = { butt_fusion: "Butt-fusion joint", electrofusion: "Electrofusion coupler", welded: "Weld", mechanical: "Mechanical coupling", flanged: "Flanged joint" };

/** Flange DN for a pipe OD: largest standard DN ≤ OD (PE OD 630 → DN 600). */
const dnFor = OD => DN_LIST.filter(d => d <= OD + 1e-9).pop() || DN_LIST[0];

/* ---------- sources → route segments ---------- */
function segFromRoute(sg, source, mult) {
  const g = RO.route.geom(sg);
  return { source, name: sg.name, material: sg.material || "PE100", OD: g.OD, e: g.e, sdr: sg.custom ? null : +sg.sdr, custom: !!sg.custom,
           L: +sg.L_m || 0, joint: sg.joint || "butt_fusion", mult, fittings: (sg.fittings || []).map(f => ({ code: f.code, qty: +f.qty || 0 })) };
}

/** Intake state → segments with their multiplicity (parallel lines / installed pumps). */
function fromIntake(S0) {
  const C = RO.intakeCalc, X = C.effective(S0), out = [];
  const pumps = Math.max(1, Math.round(+X.station.n_duty || 1)) + Math.max(0, Math.round(+X.station.n_standby || 0));
  if (C.hasGravity(X)) X.routes.gravity.segments.forEach(sg => out.push(segFromRoute(sg, "Intake · gravity line", Math.max(1, +X.routes.gravity.nLines || 1))));
  if (C.hasPumps(X)) {
    X.routes.suction.segments.forEach(sg => out.push(segFromRoute(sg, "Intake · suction", pumps)));
    X.routes.discharge.segments.forEach(sg => out.push(segFromRoute(sg, "Intake · discharge", sg.perPump ? pumps : Math.max(1, +X.routes.discharge.nLines || 1))));
  }
  return { segs: out, pumps: C.hasPumps(X) ? { duty: Math.round(+X.station.n_duty || 0), standby: Math.round(+X.station.n_standby || 0), type: X.station.pump_type, pumpId: X.selection.pumpId } : null };
}

/** Pipeline design state → segments (lengths along the pipe). Returns { segs, error }. */
function fromPipeline(S0) {
  const PC = RO.pipelineCalc, X = PC.effective(S0);
  const errs = PC.validate(X);
  if (errs.length) return { segs: [], error: errs[0] };
  const geo = PC.buildGeometry(X), n = Math.max(1, Math.round(+X.flow.nLines || 1));
  const src = "Pipeline · " + (S0.name || "line");
  return { segs: X.segments.map((sg, i) => segFromRoute(Object.assign({}, sg, { L_m: geo.segGeo[i].La }), src, n)), submerged: !!X.line.submerged, name: S0.name };
}

/* ---------- build ---------- */
function build(input) {
  const stick = recOr(input.stick_m, "bom.stick_m"), allow = recOr(input.allowance_pct, "bom.allowance_pct") / 100;
  const mats = RO.pipeclass.materials();
  const pipes = {}, fittings = {}, joints = {}, flanges = {}, warnings = [];
  const add = (map, key, base, q) => { const o = map[key] || (map[key] = Object.assign({ qty: 0, sources: new Set() }, base)); o.qty += q; if (base.source) o.sources.add(base.source); return o; };

  const pnOf = s => {
    const grade = (mats[s.material] || {}).grade;
    if (!grade) return 16;
    const sdr = s.sdr || RO.pipes.nearestSDR(s.OD / s.e);
    return Math.max(10, RO.pipes.pnRating(sdr, grade) || 10);
  };
  const isPE = s => !!(mats[s.material] || {}).grade;
  function flangedEnds(s, count) {
    if (!(count > 0)) return;
    const DN = dnFor(s.OD), PN = pnOf(s);
    if (isPE(s)) add(flanges, `stub|${s.OD}|${PN}`, { item: "Stub end + backing ring", size: `OD ${s.OD}`, rating: `PN ${PN}`, order: 1, source: s.source }, count);
    else add(flanges, `wn|${DN}|${PN}`, { item: "Flange, weld-neck / slip-on", size: `DN ${DN}`, rating: `PN ${PN}`, order: 1, source: s.source }, count);
    add(flanges, `gasket|${DN}|${PN}`, { item: "Gasket", size: `DN ${DN}`, rating: `PN ${PN}`, order: 2, source: s.source }, count);
    add(flanges, `bolt|${DN}|${PN}`, { item: "Bolt set (EN 1092-1 drilling)", size: `DN ${DN}`, rating: `PN ${PN}`, order: 3, source: s.source }, count);
  }
  function jointOfType(s, type, count) {
    if (!(count > 0)) return;
    if (type === "flanged") {                                        // pipe-to-pipe flange: 2 flanged ends, 1 gasket, 1 bolt set
      const DN = dnFor(s.OD), PN = pnOf(s);
      if (isPE(s)) add(flanges, `stub|${s.OD}|${PN}`, { item: "Stub end + backing ring", size: `OD ${s.OD}`, rating: `PN ${PN}`, order: 1, source: s.source }, 2 * count);
      else add(flanges, `wn|${DN}|${PN}`, { item: "Flange, weld-neck / slip-on", size: `DN ${DN}`, rating: `PN ${PN}`, order: 1, source: s.source }, 2 * count);
      add(flanges, `gasket|${DN}|${PN}`, { item: "Gasket", size: `DN ${DN}`, rating: `PN ${PN}`, order: 2, source: s.source }, count);
      add(flanges, `bolt|${DN}|${PN}`, { item: "Bolt set (EN 1092-1 drilling)", size: `DN ${DN}`, rating: `PN ${PN}`, order: 3, source: s.source }, count);
      return;
    }
    add(joints, `${type}|${s.OD}`, { item: JOINT_LABEL[type] || type, size: `OD ${s.OD}`, type, source: s.source }, count);
  }
  const endsOf = it => ({ tee: 3, cross: 4 })[it.category] || (it.code === "AIRV" || it.code === "FLAP" ? 1 : 2);

  (input.segs || []).forEach(s => {
    if (!(s.OD > 0) || !(s.L >= 0)) { warnings.push(`${s.source} · ${s.name}: invalid pipe — skipped`); return; }
    const m = s.mult;
    const key = s.custom ? `${s.material}|${s.OD}|e${s.e.toFixed(1)}` : `${s.material}|${s.OD}|${s.sdr}`;
    const p = pipes[key] || (pipes[key] = { material: s.material, label: (mats[s.material] || {}).label || s.material, OD: s.OD, e: s.e, sdr: s.sdr, custom: s.custom, net: 0, sources: new Set() });
    p.net += s.L * m; p.sources.add(s.source);
    const sticks = Math.ceil(s.L / stick - 1e-9);
    jointOfType(s, s.joint, Math.max(0, sticks - 1) * m);
    s.fittings.forEach(f => {
      if (!(f.qty > 0)) return;
      const r = RO.fittings.resolve(f.code, s.OD), it = r.item;
      if (!it) { warnings.push(`${s.source} · ${s.name}: fitting ${f.code} not in the active list`); return; }
      if (!it.bom) return;
      const q = f.qty * m;
      add(fittings, `${it.code}|${s.OD}`, { code: it.code, name: it.name, category: it.category, OD: s.OD, DN: dnFor(s.OD), connection: it.connection, source: s.source }, q);
      if (it.category === "flange") { if (it.code === "FLG-ADPT" || it.code === "FLG-BLIND") { const DN = dnFor(s.OD), PN = pnOf(s);
          add(flanges, `gasket|${DN}|${PN}`, { item: "Gasket", size: `DN ${DN}`, rating: `PN ${PN}`, order: 2, source: s.source }, q);
          add(flanges, `bolt|${DN}|${PN}`, { item: "Bolt set (EN 1092-1 drilling)", size: `DN ${DN}`, rating: `PN ${PN}`, order: 3, source: s.source }, q); }
        return; }
      if (it.category === "joint") { if (it.code === "DISM") flangedEnds(s, 2 * q); return; }
      const ends = endsOf(it) * q;
      if (it.connection === "flanged") flangedEnds(s, ends);
      else if (it.connection && it.connection !== "none") jointOfType(s, it.connection === "welded" || !isPE(s) && it.connection === "butt_fusion" ? "welded" : it.connection, ends);
    });
  });

  const pipeRows = Object.values(pipes).map(p => {
    const order = p.net * (1 + allow);
    return Object.assign(p, { order, sticks: Math.ceil(order / stick - 1e-9), sources: [...p.sources] });
  }).sort((a, b) => a.material.localeCompare(b.material) || a.OD - b.OD || (a.sdr || 0) - (b.sdr || 0));
  const list = map => Object.values(map).map(o => Object.assign(o, { sources: [...o.sources] }));
  const fitRows = list(fittings).sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code) || a.OD - b.OD);
  const jointRows = list(joints).sort((a, b) => a.item.localeCompare(b.item) || parseFloat(a.size.slice(3)) - parseFloat(b.size.slice(3)));
  const flangeRows = list(flanges).sort((a, b) => a.order - b.order || a.size.localeCompare(b.size, undefined, { numeric: true }));

  // ballast from Supports & buoyancy
  const blocks = [];
  if (input.buoyancy) input.buoyancy.rows.filter(r => !r.error).forEach(r => {
    const k = `${r.sec.piece_kg}`;
    const b = blocks.find(x => x.key === k) || (blocks.push({ key: k, piece_kg: +r.sec.piece_kg, pieces: 0, mass: 0, concrete: 0, sections: [] }), blocks[blocks.length - 1]);
    b.pieces += r.piecesTotal; b.mass += r.massTotal; b.concrete += r.concrete; b.sections.push(r.sec.name);
  });

  return { stick, allow, pipes: pipeRows, fittings: fitRows, joints: jointRows, flanges: flangeRows, blocks, pumps: input.pumps || null, warnings,
           totals: { net: pipeRows.reduce((a, p) => a + p.net, 0), order: pipeRows.reduce((a, p) => a + p.order, 0), sticks: pipeRows.reduce((a, p) => a + p.sticks, 0),
                     fittings: fitRows.reduce((a, f) => a + f.qty, 0), joints: jointRows.reduce((a, j) => a + j.qty, 0), concrete: blocks.reduce((a, b) => a + b.concrete, 0) } };
}

/** Flat rows for CSV export. */
function csvRows(B) {
  const rows = [];
  B.pipes.forEach(p => rows.push(["Pipe", `${p.label} OD ${p.OD} ${p.sdr ? "SDR " + p.sdr : "e " + p.e.toFixed(1) + " mm"}`, `OD ${p.OD}`, p.sdr ? `SDR ${p.sdr}` : "", "m", p.order.toFixed(1), `net ${p.net.toFixed(1)} m + ${(B.allow * 100).toFixed(1)} % · ${p.sticks} × ${B.stick} m`, p.sources.join("; ")]));
  B.fittings.forEach(f => rows.push(["Fitting", f.name, `OD ${f.OD}`, f.connection, "pcs", f.qty, f.code, f.sources.join("; ")]));
  B.joints.forEach(j => rows.push(["Joint", j.item, j.size, "", "pcs", j.qty, "", j.sources.join("; ")]));
  B.flanges.forEach(x => rows.push(["Flange set", x.item, x.size, x.rating, "pcs", x.qty, "", x.sources.join("; ")]));
  B.blocks.forEach(b => rows.push(["Ballast", `Concrete block ${b.piece_kg} kg`, "", "", "pcs", b.pieces, `${b.concrete.toFixed(2)} m³ concrete`, b.sections.join("; ")]));
  if (B.pumps) rows.push(["Equipment", B.pumps.label, "", "", "pcs", B.pumps.duty + B.pumps.standby, `${B.pumps.duty} duty + ${B.pumps.standby} standby`, "Intake · pump station"]);
  return { head: ["group", "item", "size", "rating / connection", "unit", "quantity", "notes", "source"], rows };
}

RO.bomCalc = { DN_LIST, dnFor, fromIntake, fromPipeline, build, csvRows };
})(window.RO = window.RO || {});
