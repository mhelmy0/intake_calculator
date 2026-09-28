/* ============================================================
   Pipe materials + PE pressure-class check (equations.md §7.1, §8).
   Extracted from the v1 Pipeline Hydraulics module so every route segment
   can be checked with the same logic.
   ============================================================ */
(function (RO) {
"use strict";

const P = RO.pipes;

/* E = short-term modulus for surge (GPa); ε = roughness (mm). Recommended, user-editable. */
function materials() {
  const pe100E = (RO.values && RO.values.get("material.pe100_E_GPa")) || 1.0;
  return {
    PE100:  { label: "PE100 (HDPE)",                E: pe100E, eps: 0.0015, grade: "PE100", poisson: 0.45 },
    PE80:   { label: "PE80",                        E: 0.8,    eps: 0.0015, grade: "PE80",  poisson: 0.45 },
    PVCU:   { label: "PVC-U",                       E: 3.0,    eps: 0.0015, poisson: 0.40 },
    GRP:    { label: "GRP",                         E: 10,     eps: 0.03,   poisson: 0.30 },
    DI:     { label: "Ductile iron (cement-lined)", E: 170,    eps: 0.03,   poisson: 0.28 },
    CS:     { label: "Carbon steel",                E: 207,    eps: 0.045,  poisson: 0.30 },
    SS:     { label: "Stainless / super duplex",    E: 200,    eps: 0.015,  poisson: 0.30 }
  };
}

/* ISO 4427-1 Table A.1 pressure reduction coefficients (PE80 / PE100), linear interpolation. */
const DERATING_PTS = [[20, 1.00], [30, 0.87], [40, 0.74]];
function deratingPE(T) {
  const pts = DERATING_PTS;
  if (!isFinite(T) || T <= pts[0][0]) return { f: pts[0][1], extrapolated: false };
  for (let i = 1; i < pts.length; i++) {
    if (T <= pts[i][0]) {
      const [t0, f0] = pts[i - 1], [t1, f1] = pts[i];
      return { f: f0 + (f1 - f0) * (T - t0) / (t1 - t0), extrapolated: false };
    }
  }
  return { f: pts[pts.length - 1][1], extrapolated: true };
}

/**
 * PE class check for one pipe.
 * in: { OD, e, grade, T, fT_override, k_surge, PN_target }
 */
function classCheck(inp) {
  const { OD, e } = inp;
  const grade = inp.grade || "PE100";
  const gradeData = P.PE_GRADES[grade] || P.PE_GRADES.PE100;
  const SDRc = OD / e;
  const near = P.nearestSDR(SDRc);
  const cat = P.catalogueWall(OD, near);
  const tol = P.wallTolerance(cat.e);
  const eMax = cat.e + tol;
  const devMm = e - cat.e, devPct = devMm / cat.e * 100;
  const RND = 0.05;
  const catStatus = e < cat.e - RND ? "thin" : (e > eMax + RND ? "thick" : "ok");
  const rated = catStatus === "ok" ? near : P.ratedSDR(OD, e);
  const PN_rated = rated ? P.pnRating(rated, grade) : null;
  const fTa = deratingPE(inp.T);
  const fT_user = inp.fT_override != null && inp.fT_override > 0;
  const fT = fT_user ? inp.fT_override : fTa.f;
  const k_surge = inp.k_surge > 0 ? inp.k_surge : 1;
  const PFA = PN_rated != null ? PN_rated * fT : null;
  return {
    OD, e, grade, gradeData, SDRc, near, cat, tol, eMax, devMm, devPct, catStatus,
    stdOD: P.ISO_OD_LIST.indexOf(OD) >= 0, rated, PN_rated,
    P_allow_cont: P.allowablePressure(SDRc, grade),
    fT, fT_user, fTa, k_surge, PFA, PMA: PFA != null ? PFA * k_surge : null,
    PN_target: inp.PN_target
  };
}

RO.pipeclass = { materials, deratingPE, classCheck };
})(window.RO = window.RO || {});
