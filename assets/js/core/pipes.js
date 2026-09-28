/* ============================================================
   PE pipe catalogue (ISO 4427) + SDR / PN helpers
   ============================================================ */
(function (RO) {
"use strict";

/* ISO 4427 PE100 pipe table.
   Row format: [DN_OD_mm,
                e_SDR17, ID_SDR17,
                e_SDR13.6, ID_SDR13.6,
                e_SDR11, ID_SDR11,
                e_SDR7.4, ID_SDR7.4]
   Wall (e) and ID values in mm; null = combination not standardized. */
const PE_DATA = [
  [63,    3.8,   55.4,   4.7,   53.6,   5.8,   51.4,   8.6,   45.8],
  [75,    4.5,   66.0,   5.6,   63.8,   6.8,   61.4,  10.3,   54.4],
  [90,    5.4,   79.2,   6.7,   76.6,   8.2,   73.6,  12.3,   65.4],
  [110,   6.6,   96.8,   8.1,   93.8,  10.0,   90.0,  15.1,   79.8],
  [125,   7.4,  110.2,   9.2,  106.6,  11.4,  102.2,  17.1,   90.8],
  [160,   9.5,  141.0,  11.8,  136.4,  14.6,  130.8,  21.9,  116.2],
  [200,  11.9,  176.2,  14.7,  170.6,  18.2,  163.6,  27.4,  145.2],
  [250,  14.8,  220.4,  18.4,  213.2,  22.7,  204.6,  33.9,  182.2],
  [315,  18.7,  277.6,  23.2,  268.6,  28.6,  257.8,  42.9,  229.2],
  [355,  20.9,  313.2,  26.1,  302.8,  32.2,  290.6,  48.3,  258.4],
  [400,  23.7,  352.6,  29.4,  341.2,  36.3,  327.4,  54.5,  291.0],
  [450,  26.7,  396.6,  33.1,  383.8,  40.9,  368.2,  61.3,  327.4],
  [500,  29.7,  440.6,  36.8,  426.4,  45.4,  409.2,  67.8,  364.4],
  [560,  33.2,  493.6,  41.2,  477.6,  50.8,  458.4,  75.9,  408.2],
  [630,  37.4,  555.2,  46.3,  537.4,  57.2,  515.6,  85.5,  459.0],
  [710,  42.1,  625.8,  52.2,  605.6,  64.5,  581.0,  96.3,  517.4],
  [800,  47.4,  705.2,  58.8,  682.4,  72.6,  654.8, 108.6,  582.8],
  [900,  53.3,  793.4,  66.1,  767.8,  81.7,  736.6, 122.2,  655.6],
  [1000, 59.3,  881.4,  73.5,  853.0,  90.9,  818.2, 135.9,  728.2],
  [1200, 71.1, 1057.8,  88.2, 1023.6, 109.1,  981.8,  null,   null]
];
const SDR_KEYS = ["SDR17", "SDR13.6", "SDR11", "SDR7.4"];
const SDR_PN   = { "SDR17": 10, "SDR13.6": 12.5, "SDR11": 16, "SDR7.4": 25 };
const DN_LIST_MM = PE_DATA.map(r => r[0]);
const PE_LOOKUP = (() => {
  const m = {};
  for (const r of PE_DATA) m[r[0]] = r;
  return m;
})();

/* Look up wall thickness e (mm) and ID (mm) for a given DN + SDR key ("SDR17").
   Returns { OD, e_mm, ID_mm, SDR, PN } or null if combination not available. */
function getPipeData(dn, sdr) {
  const row = PE_LOOKUP[dn];
  if (!row) return null;
  const idx = SDR_KEYS.indexOf(sdr);
  if (idx < 0) return null;
  const e_mm  = row[1 + idx * 2];
  const ID_mm = row[2 + idx * 2];
  if (e_mm == null || ID_mm == null) return null;
  return { OD: dn, e_mm, ID_mm, SDR: sdr, PN: SDR_PN[sdr] };
}

/* ---------- Full SDR series (Pipeline Hydraulics PRD) ---------- */
const SDR_SERIES = [41, 33, 26, 21, 17, 13.6, 11, 9, 7.4];          // thin → thick
const PN_PE100   = { 41: 4, 33: 5, 26: 6.3, 21: 8, 17: 10, 13.6: 12.5, 11: 16, 9: 20, 7.4: 25 };
const PN_R10     = [2.5, 3.2, 4, 5, 6.3, 8, 10, 12.5, 16, 20, 25, 32];
/* Design stress σs = MRS / C with C = 1.25 (MPa). */
const PE_GRADES  = {
  PE100: { MRS: 10.0, sigma: 8.0 },
  PE80:  { MRS: 8.0,  sigma: 6.3 }
};
const ISO_OD_LIST = [20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 140, 160, 180, 200, 225, 250, 280,
  315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000];

/* Continuous allowable pressure for a given SDR (bar, 20 °C): P = 20·σs / (SDR − 1) */
function allowablePressure(sdr, grade = "PE100") {
  const g = PE_GRADES[grade] || PE_GRADES.PE100;
  return 20 * g.sigma / (sdr - 1);
}

/* Nominal pressure class (bar). PE100 from the standard table; other grades rounded to nearest R10 PN. */
function pnRating(sdr, grade = "PE100") {
  if (grade === "PE100" && PN_PE100[sdr] != null) return PN_PE100[sdr];
  const raw = allowablePressure(sdr, grade);
  let best = PN_R10[0];
  for (const p of PN_R10) if (Math.abs(p - raw) < Math.abs(best - raw)) best = p;
  return best;
}

/* Catalogue minimum wall for OD at a standard SDR.
   Uses the ISO 4427 table where available, else e = OD/SDR rounded up to 0.1 mm (min 2.0 mm). */
function catalogueWall(OD, sdr) {
  const row = PE_LOOKUP[OD];
  const idx = SDR_KEYS.indexOf("SDR" + sdr);
  if (row && idx >= 0 && row[1 + idx * 2] != null) {
    return { e: row[1 + idx * 2], source: "ISO 4427 table" };
  }
  const e = Math.max(2.0, Math.ceil(OD / sdr * 10 - 1e-9) / 10);
  return { e, source: "OD ÷ SDR, rounded up to 0.1 mm" };
}

/* Permitted positive wall deviation, ISO 11922-1 grade V: 0.1·e + 0.1 mm, rounded up to 0.1 mm. */
function wallTolerance(e) {
  return Math.ceil((0.1 * e + 0.1) * 10 - 1e-9) / 10;
}

/* Nearest standard SDR by ratio (log distance). */
function nearestSDR(sdr) {
  let best = SDR_SERIES[0], bestD = Infinity;
  for (const s of SDR_SERIES) {
    const d = Math.abs(Math.log(sdr / s));
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/* Conservative rating: the thickest standard class whose catalogue e_min ≤ actual wall. null if thinner than SDR41. */
function ratedSDR(OD, e) {
  for (let i = SDR_SERIES.length - 1; i >= 0; i--) {
    const s = SDR_SERIES[i];
    if (catalogueWall(OD, s).e <= e + 1e-6) return s;
  }
  return null;
}

RO.pipes = {
  PE_DATA, SDR_KEYS, SDR_PN, DN_LIST_MM, PE_LOOKUP, getPipeData,
  SDR_SERIES, PN_PE100, PE_GRADES, ISO_OD_LIST,
  allowablePressure, pnRating, catalogueWall, wallTolerance, nearestSDR, ratedSDR
};
})(window.RO = window.RO || {});
