/* ============================================================
   Module: Pipeline Hydraulics  (see "Pipeline Hydraulics Module — PRD.md")
     1. Friction loss   — Darcy–Weisbach + Swamee–Jain over a Q_min…Q_max range
     2. Water hammer    — Korteweg wave speed, Joukowsky surge, 2L/a, peak/min envelope
     3. SDR / pipe class— SDR, nearest ISO 4427 class, catalogue deviation, PN vs pressure
     4. Fluid properties— shared RO.fluid store (presets + temperature, or custom)
   All calculations SI internally; display in m³/h, mm, m, bar.
   ============================================================ */
(function (RO) {
"use strict";

const { G, PATM, darcyFriction, regimeOf, circleArea, headLossDW, waveSpeed, joukowskyPressure } = RO.hyd;
const P = RO.pipes;
const { $, fmt, fmtExp, escHtml, setVC, renderChecksList, showWarning, renderSteps, fitCanvas, clearBg } = RO.util;
const FL = RO.fluids;

/* ============ CONSTANTS ============ */
/* E = short-term elastic modulus used for surge (GPa); ε = absolute roughness (mm).
   Typical values — edit in the Pipe card if the manufacturer's data differ. */
const MATERIALS = {
  PE100:  { label: "PE100 (HDPE)",               E: 1.0,  eps: 0.0015, grade: "PE100" },
  PE80:   { label: "PE80",                       E: 0.8,  eps: 0.0015, grade: "PE80" },
  PVCU:   { label: "PVC-U",                      E: 3.0,  eps: 0.0015 },
  GRP:    { label: "GRP",                        E: 10,   eps: 0.03 },
  DI:     { label: "Ductile iron (cement-lined)",E: 170,  eps: 0.03 },
  CS:     { label: "Carbon steel",               E: 207,  eps: 0.045 },
  SS:     { label: "Stainless / super duplex",   E: 200,  eps: 0.015 },
  custom: { label: "Custom" }
};
const PN_TARGETS = [3.2, 4, 5, 6.3, 8, 10, 12.5, 16, 20, 25];
/* Typical PE temperature derating (ISO 4427-1 Annex A style) — verify against manufacturer data. */
const DERATING_PTS = [[20, 1.00], [30, 0.87], [40, 0.74]];

const DEFAULTS = {
  pl_material: "PE100", pl_E_GPa: 1.0, pl_eps_mm: 0.0015,
  pl_cat_OD: "500", pl_cat_SDR: "17",
  pl_OD_mm: 500, pl_e_mm: 29.7, pl_ID_mm: 440.6, pl_L_m: 550,
  pl_Q_min: 400, pl_Q_max: 750, pl_n_points: 7, pl_V_lo: 0.6, pl_V_hi: 3.0,
  pl_P_deliv: 3.0, pl_add_friction: true, pl_t_close: "", pl_psi: 0.8,
  pl_grade: "PE100", pl_PN_target: "10", pl_fT: "", pl_k_surge: 1.0
};
const FLUID_FIELDS = { pl_fluid_preset: "preset", pl_T_C: "T_C", pl_S_gkg: "S_gkg",
                       pl_rho: "rho", pl_nu_cSt: "nu_cSt", pl_K_GPa: "K_GPa" };

const TABS = [
  { id: "friction", label: "🧮 Friction Loss" },
  { id: "hammer",   label: "⚡ Water Hammer" },
  { id: "sdr",      label: "🧱 SDR / Pipe Class" },
  { id: "fluid",    label: "💧 Fluid Properties" }
];

let ROOT = null, META_EL = null, TABS_EL = null;
let currentTab = "friction";
let wallMode = "e";          // "e" = OD + wall thickness, "id" = OD + inner diameter
let LAST = null, LAST_F = null;

/* ============ MARKUP ============ */
/* Card labels are upper-cased by CSS; keep symbols (ρ, ν, f, e, Q_max …) in their true case. */
const SYM_RE = /(ρ|ν|μ|ε|ψ|σ|a₀|h_f|f_T|e_min|Q_max|Q_min|2L\/a|\b[aefk]\b)/g;
const sym = s => s.replace(SYM_RE, '<span class="sym">$1</span>');
const vc = (id, label, unit) =>
  `<div class="value-card" id="${id}"><span class="v-label">${sym(label)}</span><span class="v-val">—</span><span class="v-unit">${unit}</span></div>`;
const num = (id, label, step, extra = "") =>
  `<div class="input-row"><label for="${id}">${label}</label><input type="number" id="${id}" step="${step}"${extra}></div>`;

const MARKUP = `
  <aside class="left-panel">

    <div class="card" data-tabs="friction hammer sdr fluid">
      <h2>Fluid Properties <span class="h2-tag">shared by all calculators</span></h2>
      <div class="card-body">
        <div class="input-row">
          <label for="pl_fluid_preset">Fluid</label>
          <select id="pl_fluid_preset">
            ${Object.keys(FL.PRESETS).map(k => `<option value="${k}">${FL.PRESETS[k].label}</option>`).join("")}
          </select>
          <div class="hint" id="pl_fluid_note"></div>
        </div>
        <div class="input-pair">
          ${num("pl_T_C", "Temperature (°C)", "0.5")}
          <div id="pl-S-row">${num("pl_S_gkg", "Salinity S (g/kg)", "0.5", ' min="0"')}</div>
        </div>
        <div id="pl-custom-rows" style="margin-top:7px">
          ${num("pl_rho", "Density ρ (kg/m³)", "0.1", ' min="0"')}
          ${num("pl_nu_cSt", "Kinematic viscosity ν (×10⁻⁶ m²/s = cSt)", "0.01", ' min="0"')}
          ${num("pl_K_GPa", "Bulk modulus K (GPa)", "0.01", ' min="0"')}
        </div>
        <div class="sub-label">Evaluated properties</div>
        <div class="pl-mini-grid fluid">
          ${vc("pl_fp_rho", "Density ρ", "kg/m³")}
          ${vc("pl_fp_nu", "Kin. visc. ν", "×10⁻⁶ m²/s")}
          ${vc("pl_fp_mu", "Dyn. visc. μ", "mPa·s")}
          ${vc("pl_fp_K", "Bulk mod. K", "GPa")}
        </div>
        <div class="src-note" id="pl_fluid_src"></div>
      </div>
    </div>

    <div class="card" data-tabs="friction hammer sdr">
      <h2>Pipe</h2>
      <div class="card-body">
        <div class="input-row">
          <label for="pl_material">Material</label>
          <select id="pl_material">
            ${Object.keys(MATERIALS).map(k => `<option value="${k}">${MATERIALS[k].label}</option>`).join("")}
          </select>
        </div>
        <div class="input-pair">
          ${num("pl_E_GPa", "Elastic modulus E (GPa)", "0.05", ' min="0"')}
          ${num("pl_eps_mm", "Roughness ε (mm)", "0.0005", ' min="0"')}
        </div>
        <div class="sub-label">Fill from PE catalogue (ISO 4427)</div>
        <div class="input-row inline-row">
          <select id="pl_cat_OD" aria-label="Catalogue OD">
            ${P.ISO_OD_LIST.map(d => `<option value="${d}">OD ${d}</option>`).join("")}
          </select>
          <select id="pl_cat_SDR" aria-label="Catalogue SDR">
            ${P.SDR_SERIES.map(s => `<option value="${s}">SDR ${s} · PN${P.pnRating(s, "PE100")}</option>`).join("")}
          </select>
          <button type="button" class="btn-small" id="pl_cat_apply">Apply</button>
        </div>
        ${num("pl_OD_mm", "Outer diameter OD (mm)", "1", ' min="0"')}
        <div class="input-row">
          <label>Wall defined by</label>
          <div class="size-toggle" id="pl-wall-toggle">
            <button type="button" class="size-btn active" data-wall="e">Wall thickness e</button>
            <button type="button" class="size-btn" data-wall="id">Inner diameter ID</button>
          </div>
        </div>
        <div id="pl-e-row">${num("pl_e_mm", "Wall thickness e (mm)", "0.1", ' min="0"')}</div>
        <div id="pl-id-row" hidden>${num("pl_ID_mm", "Inner diameter ID (mm)", "0.1", ' min="0"')}</div>
        <div class="pl-mini-grid">
          ${vc("pl_g_OD", "OD", "mm")}
          ${vc("pl_g_e", "Wall e", "mm")}
          ${vc("pl_g_ID", "ID", "mm")}
          ${vc("pl_g_SDR", "SDR (OD/e)", "—")}
        </div>
        <div class="dn-warning" id="pl-geo-warning"></div>
        <div style="margin-top:7px">${num("pl_L_m", "Pipe length L (m)", "10", ' min="0"')}</div>
      </div>
    </div>

    <div class="card" data-tabs="friction hammer sdr">
      <h2>Flow Range</h2>
      <div class="card-body">
        <div class="input-pair">
          ${num("pl_Q_min", "Min flow Q_min (m³/h)", "10", ' min="0"')}
          ${num("pl_Q_max", "Max flow Q_max (m³/h)", "10", ' min="0"')}
        </div>
        ${num("pl_n_points", "Points across range (2–25)", "1", ' min="2" max="25"')}
        <div class="input-pair">
          ${num("pl_V_lo", "Velocity guide min (m/s)", "0.1", ' min="0"')}
          ${num("pl_V_hi", "Velocity guide max (m/s)", "0.1", ' min="0"')}
        </div>
      </div>
    </div>

    <div class="card" data-tabs="hammer sdr">
      <h2>Operating Pressure &amp; Surge</h2>
      <div class="card-body">
        ${num("pl_P_deliv", "Delivery / downstream pressure incl. static head (bar g)", "0.1")}
        <label class="check-input"><input type="checkbox" id="pl_add_friction"> Add friction loss @ Q_max → steady pressure at pipe inlet</label>
        <div class="input-pair">
          ${num("pl_t_close", "Valve closure time (s, optional)", "0.5", ' min="0" placeholder="—"')}
          ${num("pl_psi", "Restraint factor ψ", "0.05", ' min="0"')}
        </div>
        <div class="hint">Recommended ψ = 0.80 ≈ 1 − μ² (PE anchored throughout, μ ≈ 0.45). ψ = 1 gives the lowest wave speed, so it is the least conservative.</div>
      </div>
    </div>

    <div class="card" data-tabs="hammer sdr">
      <h2>Pipe Class Check</h2>
      <div class="card-body">
        <div class="input-pair">
          <div class="input-row">
            <label for="pl_grade">PE grade (PN basis)</label>
            <select id="pl_grade"><option value="PE100">PE100</option><option value="PE80">PE80</option></select>
          </div>
          <div class="input-row">
            <label for="pl_PN_target">Target class</label>
            <select id="pl_PN_target">${PN_TARGETS.map(p => `<option value="${p}">PN ${p}</option>`).join("")}</select>
          </div>
        </div>
        <div class="input-pair">
          ${num("pl_fT", "Temp. derating f_T (blank = auto)", "0.01", ' min="0" max="1" placeholder="auto"')}
          ${num("pl_k_surge", "Surge allowance k (PMA = k·PFA)", "0.05", ' min="0"')}
        </div>
        <div class="hint">k = 1.0 checks peak surge against the plain PN rating (conservative). Set per your design code.</div>
      </div>
    </div>

  </aside>

  <section class="right-panel">

    <!-- ========== FRICTION LOSS ========== -->
    <div class="view pl-calc-view pl-friction-view">
      <div class="card pl-r1c1">
        <h2>Friction Loss Results <span class="h2-tag">Darcy–Weisbach · Swamee–Jain</span></h2>
        <div class="card-body">
          <div class="value-group">
            <h3>@ <span class="sym">Q_max</span></h3>
            <div class="value-grid">
              ${vc("pl_f_V", "Velocity", "m/s")}
              ${vc("pl_f_Re", "Reynolds number", "—")}
              ${vc("pl_f_f", "Darcy friction factor f", "—")}
              ${vc("pl_f_hf", "Head loss h_f", "m")}
              ${vc("pl_f_dP", "Pressure loss ΔP", "bar")}
              ${vc("pl_f_hfkm", "Hydraulic gradient", "m/km")}
            </div>
          </div>
          <div class="value-group">
            <h3>@ <span class="sym">Q_min</span></h3>
            <div class="value-grid">
              ${vc("pl_f_Vmin", "Velocity", "m/s")}
              ${vc("pl_f_Remin", "Reynolds number", "—")}
              ${vc("pl_f_hfmin", "Head loss h_f", "m")}
              ${vc("pl_f_dPmin", "Pressure loss ΔP", "bar")}
            </div>
          </div>
        </div>
      </div>
      <div class="card chart-card pl-r1c2">
        <h2>Pressure Loss vs Flow <span class="h2-tag">ΔP (bar) · h_f (m)</span></h2>
        <div class="card-body"><canvas id="pl-fric-canvas"></canvas></div>
        <div class="legend">
          <span class="lf">ΔP(Q) curve</span>
          <span class="lm">table points</span>
          <span class="ls">Q_max</span>
        </div>
      </div>
      <div class="card pl-r1c3">
        <h2>Checks</h2>
        <div class="card-body">
          <div class="checks-summary" id="pl-fric-summary">—</div>
          <div class="checks-list" id="pl-fric-checks"></div>
        </div>
      </div>
      <div class="card pl-r2-span12">
        <h2>Across the Flow Range <span class="h2-tag" id="pl-fric-range-tag"></span></h2>
        <div class="card-body table-wrap"><table class="data-table" id="pl-fric-table"></table></div>
      </div>
      <div class="card pl-r2c3">
        <h2>Calculation Steps <span class="h2-tag">@ Q_max</span></h2>
        <div class="card-body"><div class="steps" id="pl-fric-steps"></div></div>
      </div>
    </div>

    <!-- ========== WATER HAMMER ========== -->
    <div class="view pl-calc-view pl-hammer-view">
      <div class="card pl-r1c1">
        <h2>Surge Results <span class="h2-tag">Korteweg · Joukowsky</span></h2>
        <div class="card-body">
          <div class="value-group">
            <h3>Wave</h3>
            <div class="value-grid">
              ${vc("pl_h_a0", "Sound speed in fluid a₀", "m/s")}
              ${vc("pl_h_a", "Pipe wave speed a", "m/s")}
              ${vc("pl_h_Tc", "Critical closure 2L/a", "s")}
              ${vc("pl_h_dV", "ΔV (full stop @ Q_max)", "m/s")}
            </div>
          </div>
          <div class="value-group">
            <h3>Surge</h3>
            <div class="value-grid">
              ${vc("pl_h_dH", "Surge head ΔH", "m")}
              ${vc("pl_h_dP", "Surge pressure ΔP", "bar")}
            </div>
          </div>
          <div class="value-group">
            <h3>Transient envelope</h3>
            <div class="value-grid">
              ${vc("pl_h_Pst", "Steady pressure", "bar g")}
              ${vc("pl_h_Ppk", "Peak (steady + surge)", "bar g")}
              ${vc("pl_h_Pmin", "Min (steady − surge)", "bar g")}
              ${vc("pl_h_PMA", "Allowable incl. surge PMA", "bar")}
            </div>
          </div>
        </div>
      </div>
      <div class="card chart-card pl-r1c2">
        <h2>Pressure Envelope <span class="h2-tag">bar g</span></h2>
        <div class="card-body"><canvas id="pl-ham-canvas"></canvas></div>
        <div class="legend">
          <span class="la">Steady</span>
          <span class="lm">Surge ΔP</span>
          <span class="lf">Downsurge min</span>
          <span class="lh">PFA</span>
          <span class="lr">PMA</span>
          <span class="ls">Vapour limit</span>
        </div>
      </div>
      <div class="card pl-r1c3">
        <h2>Checks</h2>
        <div class="card-body">
          <div class="checks-summary" id="pl-ham-summary">—</div>
          <div class="checks-list" id="pl-ham-checks"></div>
        </div>
      </div>
      <div class="card pl-r2-all">
        <h2>Calculation Steps</h2>
        <div class="card-body"><div class="steps" id="pl-ham-steps"></div></div>
      </div>
    </div>

    <!-- ========== SDR / PIPE CLASS ========== -->
    <div class="view pl-calc-view pl-sdr-view">
      <div class="card pl-r1c1">
        <h2>Pipe Class Results</h2>
        <div class="card-body">
          <div class="value-group">
            <h3>Dimension ratio</h3>
            <div class="value-grid">
              ${vc("pl_s_SDR", "Calculated SDR", "OD / e")}
              ${vc("pl_s_near", "Nearest standard", "—")}
              ${vc("pl_s_emin", "Catalogue e_min", "mm")}
              ${vc("pl_s_dev", "Wall deviation", "mm")}
            </div>
          </div>
          <div class="value-group">
            <h3>Rating</h3>
            <div class="value-grid">
              ${vc("pl_s_rated", "Rated class", "—")}
              ${vc("pl_s_PN", "Pressure class", "bar")}
              ${vc("pl_s_fT", "Temp. derating f_T", "—")}
              ${vc("pl_s_PFA", "PFA = PN·f_T", "bar")}
              ${vc("pl_s_PMA", "PMA = k·PFA", "bar")}
            </div>
          </div>
          <div class="value-group">
            <h3>Required</h3>
            <div class="value-grid">
              ${vc("pl_s_Pst", "Steady pressure", "bar g")}
              ${vc("pl_s_Ppk", "Peak incl. surge", "bar g")}
              ${vc("pl_s_margin", "Margin PMA − peak", "bar")}
            </div>
          </div>
        </div>
      </div>
      <div class="card pl-r1c2">
        <h2>SDR Series for this OD <span class="h2-tag" id="pl-sdr-table-tag"></span></h2>
        <div class="card-body table-wrap"><table class="data-table" id="pl-sdr-table"></table></div>
      </div>
      <div class="card pl-r1c3">
        <h2>Checks</h2>
        <div class="card-body">
          <div class="checks-summary" id="pl-sdr-summary">—</div>
          <div class="checks-list" id="pl-sdr-checks"></div>
        </div>
      </div>
      <div class="card pl-r2-all">
        <h2>Calculation Steps</h2>
        <div class="card-body"><div class="steps" id="pl-sdr-steps"></div></div>
      </div>
    </div>

    <!-- ========== FLUID PROPERTIES ========== -->
    <div class="view pl-fluid-view">
      <div class="card pl-fl-props">
        <h2>Fluid Properties <span class="h2-tag" id="pl-fl-tag"></span></h2>
        <div class="card-body">
          <div class="value-grid">
            ${vc("pl_fl_rho", "Density ρ", "kg/m³")}
            ${vc("pl_fl_nu", "Kinematic viscosity ν", "m²/s")}
            ${vc("pl_fl_mu", "Dynamic viscosity μ", "mPa·s")}
            ${vc("pl_fl_K", "Bulk modulus K", "GPa")}
            ${vc("pl_fl_c", "Sound speed c", "m/s")}
            ${vc("pl_fl_Pv", "Vapour pressure", "kPa")}
          </div>
          <ul class="pl-warn-list" id="pl-fl-warn"></ul>
        </div>
      </div>
      <div class="card pl-fl-presets">
        <h2>Preset Source Values <span class="h2-tag" id="pl-fl-preset-tag"></span></h2>
        <div class="card-body table-wrap"><table class="data-table" id="pl-fl-table"></table></div>
      </div>
      <div class="card pl-fl-steps">
        <h2>Correlations &amp; Intermediate Values</h2>
        <div class="card-body"><div class="steps" id="pl-fl-steps"></div></div>
      </div>
    </div>

  </section>
`;

/* ============ HELPERS ============ */
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
const dec = max => max < 0.05 ? 4 : max < 0.5 ? 3 : max < 5 ? 2 : 1;
const signed = (v, d) => (v > 0 ? "+" : "") + fmt(v, d);

/* ============ INPUTS ============ */
function readInputs() {
  const I = {};
  for (const k of Object.keys(DEFAULTS)) {
    const el = $(k);
    if (!el) { I[k] = DEFAULTS[k]; continue; }
    if (el.type === "checkbox") I[k] = el.checked;
    else if (el.tagName === "SELECT") I[k] = el.value;
    else { const v = el.value.trim(); I[k] = v === "" ? null : parseFloat(v); }
  }
  return I;
}
function writeInputs(vals) {
  for (const k of Object.keys(DEFAULTS)) {
    const el = $(k);
    if (!el || vals[k] === undefined) continue;
    if (el.type === "checkbox") el.checked = !!vals[k];
    else el.value = vals[k] === null ? "" : vals[k];
  }
}
function syncFluidInputs() {
  const s = RO.fluid.get();
  for (const id of Object.keys(FLUID_FIELDS)) {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = s[FLUID_FIELDS[id]];
  }
  const custom = s.preset === "custom";
  $("pl-custom-rows").hidden = !custom;
  $("pl-S-row").hidden = custom;
  $("pl_fluid_note").textContent = (FL.PRESETS[s.preset] || {}).note || "";
}
function readFluidInputs() {
  const patch = {};
  for (const id of Object.keys(FLUID_FIELDS)) {
    const el = $(id);
    patch[FLUID_FIELDS[id]] = el.tagName === "SELECT" ? el.value : parseFloat(el.value);
  }
  return patch;
}

/* ============ COMPUTE ============ */
function compute(I, F) {
  const errors = [];
  if (F.error) errors.push(F.error);
  const OD = I.pl_OD_mm;
  let e, ID;
  if (wallMode === "e") { e = I.pl_e_mm; ID = OD - 2 * e; }
  else { ID = I.pl_ID_mm; e = (OD - ID) / 2; }
  const geo = { OD, e, ID };
  if (!(OD > 0)) errors.push("Enter pipe OD > 0");
  else if (!(e > 0) || !(ID > 0)) errors.push("Wall must satisfy 0 < e < OD/2 (ID > 0)");
  if (!(I.pl_L_m > 0)) errors.push("Enter pipe length L > 0");
  if (!(I.pl_Q_max > 0)) errors.push("Enter Q_max > 0");
  if (!(I.pl_Q_min >= 0) || I.pl_Q_min > I.pl_Q_max) errors.push("Q_min must be between 0 and Q_max");
  if (!(I.pl_eps_mm >= 0)) errors.push("Roughness ε must be ≥ 0");
  if (!(I.pl_E_GPa > 0)) errors.push("Elastic modulus E must be > 0");
  if (!(I.pl_psi > 0)) errors.push("Restraint factor ψ must be > 0");
  if (errors.length) return { errors, geo };

  /* ---- Friction ---- */
  const D = ID / 1000, e_m = e / 1000, L = I.pl_L_m, A = circleArea(D), eps = I.pl_eps_mm / 1000;
  const point = Q_m3h => {
    const Q = Q_m3h / 3600, V = Q / A, Re = V * D / F.nu;
    const fr = Re > 0 ? darcyFriction(eps, D, Re) : { f: 0, method: "none" };
    const hf = headLossDW(fr.f, L, D, V);
    return { Q_m3h, Q, V, Re, f: fr.f, method: fr.method, regime: regimeOf(Re),
             hf, hf_km: hf * 1000 / L, dP_bar: F.rho * G * hf / 1e5 };
  };
  let n = Math.round(I.pl_n_points);
  if (!isFinite(n)) n = 7;
  n = Math.min(25, Math.max(2, n));
  const rows = [];
  if (I.pl_Q_max === I.pl_Q_min) rows.push(point(I.pl_Q_max));
  else for (let i = 0; i < n; i++) rows.push(point(I.pl_Q_min + i * (I.pl_Q_max - I.pl_Q_min) / (n - 1)));
  const qmax = point(I.pl_Q_max), qmin = point(I.pl_Q_min);

  /* ---- Water hammer ---- */
  const E = I.pl_E_GPa * 1e9, K = F.K, rho = F.rho, psi = I.pl_psi;
  const a0 = Math.sqrt(K / rho);
  const elastTerm = psi * (K / E) * (ID / e);
  const a = waveSpeed(K, rho, E, D, e_m, psi);
  const Tc = 2 * L / a;
  const dV = qmax.V;
  const dP_pa = joukowskyPressure(rho, a, dV);
  const dP = dP_pa / 1e5;
  const dH = a * dV / G;
  const P_deliv = isFinite(I.pl_P_deliv) ? I.pl_P_deliv : 0;
  const P_fric = I.pl_add_friction ? qmax.dP_bar : 0;
  const P_steady = P_deliv + P_fric;
  const P_peak = P_steady + dP;
  const P_min = P_steady - dP;
  const P_vap_g = (F.Pv - PATM) / 1e5;
  const t_close = I.pl_t_close != null && I.pl_t_close > 0 ? I.pl_t_close : null;

  /* ---- SDR / class ---- */
  const grade = I.pl_grade;
  const gradeData = P.PE_GRADES[grade] || P.PE_GRADES.PE100;
  const SDRc = OD / e;
  const near = P.nearestSDR(SDRc);
  const cat = P.catalogueWall(OD, near);
  const tol = P.wallTolerance(cat.e);
  const eMax = cat.e + tol;
  const devMm = e - cat.e, devPct = devMm / cat.e * 100;
  const RND = 0.05;   // mm — allowance for rounding of entered dimensions
  const catStatus = e < cat.e - RND ? "thin" : (e > eMax + RND ? "thick" : "ok");
  const stdOD = P.ISO_OD_LIST.indexOf(OD) >= 0;
  const rated = catStatus === "ok" ? near : P.ratedSDR(OD, e);
  const PN_rated = rated ? P.pnRating(rated, grade) : null;
  const P_allow_cont = P.allowablePressure(SDRc, grade);
  const fTa = deratingPE(F.T);
  const fT_user = I.pl_fT != null && I.pl_fT > 0;
  const fT = fT_user ? I.pl_fT : fTa.f;
  const k_surge = I.pl_k_surge > 0 ? I.pl_k_surge : 1;
  const PFA = PN_rated != null ? PN_rated * fT : null;
  const PMA = PFA != null ? PFA * k_surge : null;
  const PN_target = parseFloat(I.pl_PN_target);
  const series = P.SDR_SERIES.map(s => {
    const w = P.catalogueWall(OD, s);
    return { sdr: s, e: w.e, ID: OD - 2 * w.e, PN: P.pnRating(s, grade), Pallow: P.allowablePressure(s, grade), source: w.source };
  });

  return {
    I, F, geo, D, A, L, eps, rows, qmax, qmin, point,
    E, K, rho, psi, a0, elastTerm, a, Tc, dV, dP_pa, dP, dH,
    P_deliv, P_fric, P_steady, P_peak, P_min, P_vap_g, t_close,
    grade, gradeData, SDRc, near, cat, tol, eMax, devMm, devPct, catStatus, stdOD, rated, PN_rated,
    P_allow_cont, fT, fT_user, fTa, k_surge, PFA, PMA, PN_target, series
  };
}

/* ============ CHECKS ============ */
function pressureChecks(R) {
  const out = [];
  if (R.PFA == null) {
    out.push({ name: "Pipe pressure rating", desc: "wall thinner than SDR 41", val: "no class", status: "fail" });
    return out;
  }
  out.push({ name: "Steady pressure ≤ PFA", desc: `PFA = PN ${R.PN_rated} × f_T ${fmt(R.fT, 2)} = ${fmt(R.PFA, 2)} bar`,
    val: fmt(R.P_steady, 2) + " bar g", status: R.P_steady <= R.PFA ? "pass" : "fail" });
  out.push({ name: "Peak (steady + surge) ≤ PMA", desc: `PMA = ${fmt(R.k_surge, 2)} × PFA = ${fmt(R.PMA, 2)} bar`,
    val: fmt(R.P_peak, 2) + " bar g", status: R.P_peak <= R.PMA ? "pass" : "fail" });
  return out;
}

function frictionChecks(R) {
  const I = R.I;
  const allTurb = R.rows.every(r => r.Re >= 4000);
  const anyLam = R.rows.some(r => r.method === "laminar");
  const relRough = R.eps / R.D;
  const sjValid = R.rows.every(r => r.Re >= 5e3 && r.Re <= 1e8) && (relRough === 0 || (relRough >= 1e-6 && relRough <= 1e-2));
  return [
    { name: "Velocity @ Q_max", desc: `≤ ${fmt(I.pl_V_hi, 2)} m/s (erosion / surge guide)`, val: fmt(R.qmax.V, 2) + " m/s",
      status: R.qmax.V <= I.pl_V_hi ? "pass" : "fail" },
    { name: "Velocity @ Q_min", desc: `≥ ${fmt(I.pl_V_lo, 2)} m/s (sediment / fouling guide)`, val: fmt(R.qmin.V, 2) + " m/s",
      status: R.qmin.V >= I.pl_V_lo ? "pass" : "warn" },
    { name: "Turbulent across range", desc: "Re ≥ 4000" + (anyLam ? " · laminar points use f = 64/Re" : ""),
      val: "Re_min " + fmtExp(R.qmin.Re, 2), status: allTurb ? "pass" : "warn" },
    { name: "Swamee–Jain validity", desc: "5e3 ≤ Re ≤ 1e8, 1e-6 ≤ ε/D ≤ 1e-2",
      val: "ε/D " + fmtExp(relRough, 1), status: sjValid ? "pass" : "warn" }
  ];
}

function hammerChecks(R) {
  const out = pressureChecks(R);
  const vapMargin = R.P_min - R.P_vap_g;
  out.push({ name: "Downsurge minimum pressure", desc: `sub-atmospheric < 0 · vapour ≈ ${fmt(R.P_vap_g, 2)} bar g`,
    val: fmt(R.P_min, 2) + " bar g",
    status: R.P_min >= 0 ? "pass" : (vapMargin > 0 ? "warn" : "fail") });
  if (R.t_close != null) {
    out.push({ name: "Valve closure vs 2L/a", desc: `t_c > ${fmt(R.Tc, 2)} s → slow closure`,
      val: fmt(R.t_close, 1) + " s",
      status: R.t_close > R.Tc ? "pass" : "warn" });
  }
  return out;
}

function sdrChecks(R) {
  const out = [];
  out.push({ name: "Standard OD (ISO 4427)", desc: "OD in catalogue list", val: `OD ${R.geo.OD}`,
    status: R.stdOD ? "pass" : "warn" });
  const catDesc = `SDR ${R.near}: e ${fmt(R.cat.e, 1)}–${fmt(R.eMax, 1)} mm`;
  out.push({ name: "Wall matches catalogue", desc: catDesc,
    val: `e ${fmt(R.geo.e, 2)} mm (${signed(R.devMm, 2)})`,
    status: R.catStatus === "ok" ? "pass" : (R.catStatus === "thin" ? "fail" : "warn") });
  out.push({ name: "Rated class ≥ target", desc: `target PN ${R.PN_target}`,
    val: R.rated ? `SDR ${R.rated} · PN ${R.PN_rated}` : "no class",
    status: R.PN_rated != null && R.PN_rated >= R.PN_target ? "pass" : "fail" });
  return out.concat(pressureChecks(R));
}

/* ============ RENDER ============ */
function recalculate() {
  if (!ROOT) return;
  const I = readInputs();
  const F = RO.fluid.props();
  LAST_F = F;
  LAST = compute(I, F);
  renderMeta(LAST, F);
  renderFluidPanel(F);
  renderGeometry(LAST);
  if (LAST.errors) { renderErrors(LAST.errors); return; }
  renderFriction(LAST);
  renderHammer(LAST);
  renderSDR(LAST);
  if (!ROOT.hidden) { drawFrictionChart(LAST); drawHammerChart(LAST); }
}

function renderMeta(R, F) {
  let line = F.error ? "fluid: " + F.error
    : `ρ = ${fmt(F.rho, 1)} kg/m³ · ν = ${fmtExp(F.nu, 2)} m²/s · K = ${fmt(F.K / 1e9, 2)} GPa · ` +
      `${F.short}${F.S != null ? " " + F.S + " g/kg" : ""} @ ${F.T} °C`;
  if (!R.errors) line += ` · OD ${R.geo.OD} × ${fmt(R.geo.e, 1)} · L ${R.L} m`;
  META_EL.textContent = line;
}

function renderFluidPanel(F) {
  if (F.error) {
    ["pl_fp_rho", "pl_fp_nu", "pl_fp_mu", "pl_fp_K"].forEach(id => setVC(id, "—"));
    $("pl_fluid_src").textContent = F.error;
    return;
  }
  setVC("pl_fp_rho", fmt(F.rho, 1));
  setVC("pl_fp_nu", fmt(F.nu * 1e6, 4));
  setVC("pl_fp_mu", fmt(F.mu * 1000, 4));
  setVC("pl_fp_K", fmt(F.K / 1e9, 3));
  $("pl_fluid_src").textContent = "source: " + F.source + (F.warnings.length ? " · ⚠ " + F.warnings.length + " note(s) — see Fluid tab" : "");
  renderFluidView(F);
}

function renderGeometry(R) {
  const g = R.geo;
  setVC("pl_g_OD", fmt(g.OD, 0));
  setVC("pl_g_e", fmt(g.e, 2));
  setVC("pl_g_ID", fmt(g.ID, 1));
  setVC("pl_g_SDR", g.e > 0 ? fmt(g.OD / g.e, 2) : "—");
  const geoErr = R.errors ? R.errors.filter(m => /OD|Wall/.test(m)).join("; ") : "";
  showWarning("pl-geo-warning", geoErr);
}

function renderErrors(errors) {
  ROOT.querySelectorAll("section.right-panel .value-card").forEach(el => {
    if (el.id.startsWith("pl_fl_")) return;
    el.classList.remove("pass", "warn", "fail");
    const v = el.querySelector(".v-val"); if (v) v.textContent = "—";
  });
  const err = [{ name: "Input error", desc: errors.join(" · "), val: "fix inputs", status: "fail" }];
  renderChecksList("pl-fric-summary", "pl-fric-checks", err);
  renderChecksList("pl-ham-summary", "pl-ham-checks", err);
  renderChecksList("pl-sdr-summary", "pl-sdr-checks", err);
  ["pl-fric-steps", "pl-ham-steps", "pl-sdr-steps"].forEach(id => {
    $(id).innerHTML = `<div class="pl-error">${errors.map(escHtml).join("<br>")}</div>`;
  });
  $("pl-fric-table").innerHTML = "";
  $("pl-sdr-table").innerHTML = "";
  drawFrictionChart(null);
  drawHammerChart(null);
}

/* ---------- Friction ---------- */
function renderFriction(R) {
  const I = R.I, q = R.qmax, m = R.qmin;
  setVC("pl_f_V", fmt(q.V, 2), "m/s", q.V <= I.pl_V_hi ? "pass" : "fail");
  setVC("pl_f_Re", fmtExp(q.Re, 2), q.regime);
  setVC("pl_f_f", fmt(q.f, 5), q.method === "laminar" ? "64/Re" : "Swamee–Jain");
  setVC("pl_f_hf", fmt(q.hf, 3), "m");
  setVC("pl_f_dP", fmt(q.dP_bar, 3), "bar");
  setVC("pl_f_hfkm", fmt(q.hf_km, 2), "m/km");
  setVC("pl_f_Vmin", fmt(m.V, 2), "m/s", m.V >= I.pl_V_lo ? "pass" : "warn");
  setVC("pl_f_Remin", fmtExp(m.Re, 2), m.regime);
  setVC("pl_f_hfmin", fmt(m.hf, 3), "m");
  setVC("pl_f_dPmin", fmt(m.dP_bar, 3), "bar");

  renderChecksList("pl-fric-summary", "pl-fric-checks", frictionChecks(R));

  $("pl-fric-range-tag").textContent = `${R.rows.length} points · L = ${R.L} m · ID ${fmt(R.geo.ID, 1)} mm`;
  const head = "<thead><tr><th>Q (m³/h)</th><th>V (m/s)</th><th>Re</th><th>Regime</th><th>f</th>" +
               "<th>h_f (m)</th><th>m/km</th><th>ΔP (bar)</th><th>V guide</th></tr></thead>";
  const body = R.rows.map((r, i) => {
    const vs = r.V > I.pl_V_hi ? "fail" : (r.V < I.pl_V_lo ? "warn" : "pass");
    const cls = i === R.rows.length - 1 ? ' class="hl"' : "";
    return `<tr${cls}><td>${fmt(r.Q_m3h, 1)}</td><td>${fmt(r.V, 2)}</td><td>${fmtExp(r.Re, 2)}</td>` +
      `<td>${r.regime}</td><td>${fmt(r.f, 5)}</td><td>${fmt(r.hf, 3)}</td><td>${fmt(r.hf_km, 2)}</td>` +
      `<td>${fmt(r.dP_bar, 3)}</td><td><span class="badge ${vs}">${vs.toUpperCase()}</span></td></tr>`;
  }).join("");
  $("pl-fric-table").innerHTML = head + "<tbody>" + body + "</tbody>";

  const D = R.D, g = R.geo;
  const steps = [
    { head: `Q_max = ${fmt(q.Q_m3h, 1)} m³/h` },
    { label: "Flow in SI", eq: "Q = Q[m³/h] / 3600", sub: `= ${fmt(q.Q_m3h, 1)} / 3600`, res: `= ${fmt(q.Q, 5)} m³/s` },
    wallMode === "e"
      ? { label: "Inner diameter", eq: "D = OD − 2·e", sub: `= ${fmt(g.OD, 1)} − 2 × ${fmt(g.e, 2)}`, res: `= ${fmt(g.ID, 1)} mm = ${fmt(D, 4)} m` }
      : { label: "Inner diameter (entered)", eq: "D = ID", res: `= ${fmt(g.ID, 1)} mm = ${fmt(D, 4)} m` },
    { label: "Flow area", eq: "A = π·D² / 4", sub: `= π × ${fmt(D, 4)}² / 4`, res: `= ${fmt(R.A, 5)} m²` },
    { label: "Velocity", eq: "V = Q / A", sub: `= ${fmt(q.Q, 5)} / ${fmt(R.A, 5)}`, res: `= ${fmt(q.V, 2)} m/s` },
    { label: "Reynolds number", eq: "Re = V·D / ν", sub: `= ${fmt(q.V, 3)} × ${fmt(D, 4)} / ${fmtExp(R.F.nu, 3)}`,
      res: `= ${fmtExp(q.Re, 3)}  (${q.regime})` },
    { label: "Relative roughness", eq: "ε / D", sub: `= ${R.I.pl_eps_mm} mm / ${fmt(g.ID, 1)} mm`, res: `= ${fmtExp(R.eps / D, 3)}` },
    q.method === "laminar"
      ? { label: "Friction factor (laminar)", eq: "f = 64 / Re", sub: `= 64 / ${fmt(q.Re, 0)}`, res: `= ${fmt(q.f, 5)}` }
      : { label: "Friction factor (Swamee–Jain)", eq: "f = 0.25 / [log₁₀(ε/(3.7·D) + 5.74/Re^0.9)]²",
          sub: `= 0.25 / [log₁₀(${fmtExp(R.eps / (3.7 * D), 3)} + ${fmtExp(5.74 / Math.pow(q.Re, 0.9), 3)})]²`,
          res: `= ${fmt(q.f, 5)}` },
    { label: "Head loss (Darcy–Weisbach)", eq: "h_f = f · (L/D) · V² / 2g",
      sub: `= ${fmt(q.f, 5)} × (${R.L} / ${fmt(D, 4)}) × ${fmt(q.V, 3)}² / (2 × ${G})`,
      res: `= ${fmt(q.hf, 3)} m  (${fmt(q.hf_km, 2)} m/km)` },
    { label: "Pressure loss", eq: "ΔP = ρ · g · h_f", sub: `= ${fmt(R.rho, 1)} × ${G} × ${fmt(q.hf, 3)}`,
      res: `= ${fmt(q.dP_bar * 1e5, 0)} Pa = ${fmt(q.dP_bar, 3)} bar` }
  ];
  renderSteps("pl-fric-steps", steps);
}

/* ---------- Water hammer ---------- */
function renderHammer(R) {
  setVC("pl_h_a0", fmt(R.a0, 0), "m/s");
  setVC("pl_h_a", fmt(R.a, 0), "m/s");
  setVC("pl_h_Tc", fmt(R.Tc, 2), "s", R.t_close == null ? null : (R.t_close > R.Tc ? "pass" : "warn"));
  setVC("pl_h_dV", fmt(R.dV, 2), "m/s");
  setVC("pl_h_dH", fmt(R.dH, 2), "m");
  setVC("pl_h_dP", fmt(R.dP, 2), "bar");
  setVC("pl_h_Pst", fmt(R.P_steady, 2), "bar g", R.PFA == null ? "fail" : (R.P_steady <= R.PFA ? "pass" : "fail"));
  setVC("pl_h_Ppk", fmt(R.P_peak, 2), "bar g", R.PMA == null ? "fail" : (R.P_peak <= R.PMA ? "pass" : "fail"));
  setVC("pl_h_Pmin", fmt(R.P_min, 2), "bar g", R.P_min >= 0 ? "pass" : (R.P_min > R.P_vap_g ? "warn" : "fail"));
  setVC("pl_h_PMA", R.PMA == null ? "—" : fmt(R.PMA, 2), "bar");

  renderChecksList("pl-ham-summary", "pl-ham-checks", hammerChecks(R));

  const g = R.geo;
  const steps = [
    { head: "Pressure wave speed (Korteweg)" },
    { label: "Sound speed in unconfined fluid", eq: "a₀ = √(K / ρ)", sub: `= √(${fmtExp(R.K, 3)} / ${fmt(R.rho, 1)})`, res: `= ${fmt(R.a0, 1)} m/s` },
    { label: "Pipe elasticity term", eq: "ψ · (K/E) · (D/e)",
      sub: `= ${R.psi} × (${fmt(R.K / 1e9, 3)} / ${fmt(R.E / 1e9, 3)}) × (${fmt(g.ID, 1)} / ${fmt(g.e, 2)})`, res: `= ${fmt(R.elastTerm, 3)}` },
    { label: "Wave speed", eq: "a = a₀ / √(1 + ψ·(K/E)·(D/e))", sub: `= ${fmt(R.a0, 1)} / √(1 + ${fmt(R.elastTerm, 3)})`, res: `= ${fmt(R.a, 1)} m/s` },
    { label: "Critical closure time", eq: "T_c = 2L / a", sub: `= 2 × ${R.L} / ${fmt(R.a, 1)}`, res: `= ${fmt(R.Tc, 2)} s`,
      note: "A closure faster than T_c develops the full Joukowsky surge." },
    { head: "Joukowsky surge — instantaneous stop from Q_max" },
    { label: "Velocity change", eq: "ΔV = V(Q_max) − 0", res: `= ${fmt(R.dV, 2)} m/s` },
    { label: "Surge head", eq: "ΔH = a · ΔV / g", sub: `= ${fmt(R.a, 1)} × ${fmt(R.dV, 3)} / ${G}`, res: `= ${fmt(R.dH, 2)} m` },
    { label: "Surge pressure", eq: "ΔP = ρ · a · ΔV", sub: `= ${fmt(R.rho, 1)} × ${fmt(R.a, 1)} × ${fmt(R.dV, 3)}`,
      res: `= ${fmt(R.dP_pa, 0)} Pa = ${fmt(R.dP, 2)} bar` },
    { head: "Combined transient envelope" },
    R.I.pl_add_friction
      ? { label: "Steady pressure at inlet", eq: "P_steady = P_delivery + ΔP_friction(Q_max)",
          sub: `= ${fmt(R.P_deliv, 2)} + ${fmt(R.P_fric, 3)}`, res: `= ${fmt(R.P_steady, 2)} bar g` }
      : { label: "Steady pressure", eq: "P_steady = P_delivery", res: `= ${fmt(R.P_steady, 2)} bar g` },
    { label: "Peak pressure", eq: "P_peak = P_steady + ΔP", sub: `= ${fmt(R.P_steady, 2)} + ${fmt(R.dP, 2)}`, res: `= ${fmt(R.P_peak, 2)} bar g` },
    { label: "Minimum pressure (downsurge)", eq: "P_min = P_steady − ΔP", sub: `= ${fmt(R.P_steady, 2)} − ${fmt(R.dP, 2)}`,
      res: `= ${fmt(R.P_min, 2)} bar g`, note: `Vapour pressure ≈ ${fmt(R.P_vap_g, 2)} bar g (${fmt(R.F.Pv / 1000, 2)} kPa abs)` }
  ];
  renderSteps("pl-ham-steps", steps);
}

/* ---------- SDR / class ---------- */
function renderSDR(R) {
  const g = R.geo;
  setVC("pl_s_SDR", fmt(R.SDRc, 2), "OD / e");
  setVC("pl_s_near", "SDR " + R.near, `PN ${P.pnRating(R.near, R.grade)} ${R.grade}`);
  setVC("pl_s_emin", fmt(R.cat.e, 1), `mm (max ${fmt(R.eMax, 1)})`);
  setVC("pl_s_dev", signed(R.devMm, 2), `mm (${signed(R.devPct, 1)} %)`,
        R.catStatus === "ok" ? "pass" : (R.catStatus === "thin" ? "fail" : "warn"));
  setVC("pl_s_rated", R.rated ? "SDR " + R.rated : "none", R.catStatus === "ok" ? "catalogue match" : "conservative",
        R.rated ? null : "fail");
  setVC("pl_s_PN", R.PN_rated == null ? "—" : "PN " + R.PN_rated, "bar",
        R.PN_rated != null && R.PN_rated >= R.PN_target ? "pass" : "fail");
  setVC("pl_s_fT", fmt(R.fT, 3), R.fT_user ? "user" : `auto @ ${R.F.T} °C`);
  setVC("pl_s_PFA", R.PFA == null ? "—" : fmt(R.PFA, 2), "bar");
  setVC("pl_s_PMA", R.PMA == null ? "—" : fmt(R.PMA, 2), "bar");
  setVC("pl_s_Pst", fmt(R.P_steady, 2), "bar g", R.PFA != null && R.P_steady <= R.PFA ? "pass" : "fail");
  setVC("pl_s_Ppk", fmt(R.P_peak, 2), "bar g", R.PMA != null && R.P_peak <= R.PMA ? "pass" : "fail");
  const margin = R.PMA == null ? null : R.PMA - R.P_peak;
  setVC("pl_s_margin", margin == null ? "—" : signed(margin, 2), "bar", margin == null ? "fail" : (margin >= 0 ? "pass" : "fail"));

  renderChecksList("pl-sdr-summary", "pl-sdr-checks", sdrChecks(R));

  $("pl-sdr-table-tag").textContent = `OD ${g.OD} · ${R.grade}`;
  const head = "<thead><tr><th>SDR</th><th>e_min (mm)</th><th>ID (mm)</th><th>PN (bar)</th><th>20σ/(SDR−1)</th><th>Source</th><th></th></tr></thead>";
  const body = R.series.map(s => {
    const tags = [];
    if (s.sdr === R.near) tags.push("nearest");
    if (s.sdr === R.rated) tags.push("rated");
    if (s.PN === R.PN_target) tags.push("target");
    const cls = s.sdr === R.near ? ' class="hl"' : (s.sdr === R.rated ? ' class="hl-2"' : "");
    return `<tr${cls}><td>SDR ${s.sdr}</td><td>${fmt(s.e, 1)}</td><td>${fmt(s.ID, 1)}</td><td>${s.PN}</td>` +
      `<td>${fmt(s.Pallow, 2)}</td><td>${s.source === "ISO 4427 table" ? "table" : "OD/SDR"}</td><td class="tags">${tags.join(" · ")}</td></tr>`;
  }).join("");
  $("pl-sdr-table").innerHTML = head + "<tbody>" + body + "</tbody>";

  const catText = R.catStatus === "ok" ? "within catalogue tolerance"
    : R.catStatus === "thin" ? "BELOW catalogue minimum — rated down" : "thicker than catalogue maximum (non-standard)";
  const steps = [
    { head: "Dimension ratio" },
    { label: "Standard dimension ratio", eq: "SDR = OD / e", sub: `= ${fmt(g.OD, 1)} / ${fmt(g.e, 2)}`, res: `= ${fmt(R.SDRc, 2)}` },
    { label: "Nearest standard class", eq: "min |ln(SDR / SDRᵢ)|, SDRᵢ ∈ {41, 33, 26, 21, 17, 13.6, 11, 9, 7.4}",
      res: `→ SDR ${R.near}  (${R.grade} PN ${P.pnRating(R.near, R.grade)})` },
    { head: "Catalogue check (ISO 4427)" },
    { label: `Catalogue wall · OD ${g.OD} SDR ${R.near}`,
      eq: R.cat.source === "ISO 4427 table" ? "e_min from ISO 4427 table" : "e_min = OD / SDR, rounded up to 0.1 mm",
      sub: R.cat.source === "ISO 4427 table" ? "" : `= ${g.OD} / ${R.near}`, res: `e_min = ${fmt(R.cat.e, 1)} mm` },
    { label: "Wall tolerance (ISO 11922-1 grade V)", eq: "t = 0.1·e_min + 0.1, rounded up to 0.1 mm",
      sub: `= 0.1 × ${fmt(R.cat.e, 1)} + 0.1`, res: `e_max = ${fmt(R.cat.e, 1)} + ${fmt(R.tol, 1)} = ${fmt(R.eMax, 1)} mm` },
    { label: "Deviation from catalogue", eq: "Δe = e − e_min", sub: `= ${fmt(g.e, 2)} − ${fmt(R.cat.e, 1)}`,
      res: `= ${signed(R.devMm, 2)} mm (${signed(R.devPct, 1)} %) → ${catText}` },
    { label: "Rated class", eq: R.catStatus === "ok" ? "catalogue match → nearest class" : "thickest SDRᵢ with e_min(OD, SDRᵢ) ≤ e",
      res: R.rated ? `SDR ${R.rated} → PN ${R.PN_rated} bar` : "thinner than SDR 41 — no class" },
    { head: "Pressure rating" },
    { label: "Allowable pressure of actual wall (info)", eq: "P = 20·σs / (SDR − 1),  σs = MRS / C",
      sub: `σs = ${R.gradeData.MRS} / 1.25 = ${R.gradeData.sigma} MPa;  P = 20 × ${R.gradeData.sigma} / (${fmt(R.SDRc, 2)} − 1)`,
      res: `= ${fmt(R.P_allow_cont, 2)} bar`, note: "The rated PN class governs; this is the continuous value for reference." },
    { label: "Temperature derating", eq: R.fT_user ? "f_T entered by user" : "f_T interpolated: 20 °C 1.00 · 30 °C 0.87 · 40 °C 0.74",
      sub: `T = ${R.F.T} °C`, res: `f_T = ${fmt(R.fT, 3)}`,
      note: !R.fT_user && R.fTa.extrapolated ? "Above 40 °C — clamped; use manufacturer data." : "Typical PE values — confirm with manufacturer." },
    R.PFA == null
      ? { label: "Allowable pressures", res: "No rated class — cannot evaluate" }
      : { label: "Allowable operating pressure", eq: "PFA = PN × f_T", sub: `= ${R.PN_rated} × ${fmt(R.fT, 3)}`, res: `= ${fmt(R.PFA, 2)} bar` },
    R.PFA == null ? null
      : { label: "Allowable maximum incl. surge", eq: "PMA = k × PFA", sub: `= ${fmt(R.k_surge, 2)} × ${fmt(R.PFA, 2)}`, res: `= ${fmt(R.PMA, 2)} bar` },
    R.PFA == null ? null
      : { label: "Required vs allowable", eq: "P_steady ≤ PFA  and  P_peak ≤ PMA",
          sub: `${fmt(R.P_steady, 2)} ≤ ${fmt(R.PFA, 2)}  ·  ${fmt(R.P_peak, 2)} ≤ ${fmt(R.PMA, 2)}`,
          res: (R.P_steady <= R.PFA && R.P_peak <= R.PMA) ? "PASS" : "FAIL" }
  ].filter(Boolean);
  renderSteps("pl-sdr-steps", steps);
}

/* ---------- Fluid view ---------- */
function renderFluidView(F) {
  $("pl-fl-tag").textContent = `${F.label}${F.S != null ? " · " + F.S + " g/kg" : ""} · ${F.T} °C`;
  setVC("pl_fl_rho", fmt(F.rho, 2), "kg/m³");
  setVC("pl_fl_nu", fmtExp(F.nu, 3), "m²/s");
  setVC("pl_fl_mu", fmt(F.mu * 1000, 4), "mPa·s");
  setVC("pl_fl_K", fmt(F.K / 1e9, 3), "GPa");
  setVC("pl_fl_c", fmt(F.c, 1), "m/s");
  setVC("pl_fl_Pv", fmt(F.Pv / 1000, 3), "kPa");
  $("pl-fl-warn").innerHTML = F.warnings.map(w => `<li>⚠ ${escHtml(w)}</li>`).join("");

  $("pl-fl-preset-tag").textContent = `evaluated at ${F.T} °C`;
  const presetRows = ["fresh", "sea", "brine"].map(k => {
    const p = FL.compute({ preset: k, T_C: F.T, S_gkg: FL.PRESETS[k].S });
    return { name: FL.PRESETS[k].label, S: FL.PRESETS[k].S, p, hl: F.preset === k && F.S === FL.PRESETS[k].S };
  });
  if (F.preset === "custom" || !presetRows.some(r => r.hl)) {
    presetRows.push({ name: F.preset === "custom" ? "Custom (entered)" : `${F.label} (S modified)`, S: F.S, p: F, hl: true });
  }
  const head = "<thead><tr><th>Fluid</th><th>S (g/kg)</th><th>ρ (kg/m³)</th><th>ν (cSt)</th><th>μ (mPa·s)</th><th>c (m/s)</th><th>K (GPa)</th><th>Pv (kPa)</th></tr></thead>";
  const body = presetRows.map(r => `<tr${r.hl ? ' class="hl"' : ""}><td>${escHtml(r.name)}</td><td>${r.S == null ? "—" : r.S}</td>` +
    `<td>${fmt(r.p.rho, 2)}</td><td>${fmt(r.p.nu * 1e6, 4)}</td><td>${fmt(r.p.mu * 1000, 4)}</td>` +
    `<td>${fmt(r.p.c, 1)}</td><td>${fmt(r.p.K / 1e9, 3)}</td><td>${fmt(r.p.Pv / 1000, 3)}</td></tr>`).join("");
  $("pl-fl-table").innerHTML = head + "<tbody>" + body + "</tbody>";
  renderSteps("pl-fl-steps", F.steps);
}

/* ============ CHARTS ============ */
function axes(ctx, w, h, pad) {
  ctx.strokeStyle = "#2a3441"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
}

function drawFrictionChart(R) {
  const c = $("pl-fric-canvas");
  if (!c) return;
  const { ctx, w, h } = fitCanvas(c);
  clearBg(ctx, w, h);
  if (!R || R.errors) return;

  const pad = { l: 56, r: 56, t: 18, b: 34 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const Qtop = R.qmax.Q_m3h * 1.15;
  const N = 60, curve = [];
  for (let i = 1; i <= N; i++) curve.push(R.point(Qtop * i / N));
  const Pmax = Math.max(curve[curve.length - 1].dP_bar, 1e-6) * 1.12;
  const toHead = p => p * 1e5 / (R.rho * G);
  const xOf = Q => pad.l + (Q / Qtop) * plotW;
  const yOf = p => h - pad.b - (p / Pmax) * plotH;
  const d = dec(Pmax), dh = dec(toHead(Pmax));

  // Q range band
  ctx.fillStyle = "rgba(88,166,255,0.07)";
  ctx.fillRect(xOf(R.qmin.Q_m3h), pad.t, xOf(R.qmax.Q_m3h) - xOf(R.qmin.Q_m3h), plotH);

  axes(ctx, w, h, pad);
  ctx.font = "11px ui-monospace, monospace";
  for (let i = 0; i <= 5; i++) {
    const p = Pmax * i / 5, y = yOf(p);
    ctx.fillStyle = "#8b949e"; ctx.textAlign = "right";
    ctx.fillText(p.toFixed(d), pad.l - 5, y + 3);
    ctx.textAlign = "left";
    ctx.fillText(toHead(p).toFixed(dh), w - pad.r + 5, y + 3);
    ctx.strokeStyle = "#1c2530"; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }
  ctx.textAlign = "center";
  for (let i = 0; i <= 6; i++) {
    const Q = Qtop * i / 6, x = xOf(Q);
    ctx.fillStyle = "#8b949e";
    ctx.fillText(Q.toFixed(0), x, h - pad.b + 14);
  }

  // Curve
  ctx.strokeStyle = "#58a6ff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(0), yOf(0));
  curve.forEach(pt => ctx.lineTo(xOf(pt.Q_m3h), yOf(pt.dP_bar)));
  ctx.stroke();

  // Table points
  ctx.fillStyle = "#d29922";
  R.rows.forEach(r => { ctx.beginPath(); ctx.arc(xOf(r.Q_m3h), yOf(r.dP_bar), 3.5, 0, Math.PI * 2); ctx.fill(); });

  // Q_max marker
  const x = xOf(R.qmax.Q_m3h), y = yOf(R.qmax.dP_bar);
  ctx.strokeStyle = "rgba(163,113,247,0.6)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, h - pad.b); ctx.lineTo(x, y); ctx.lineTo(pad.l, y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#a371f7"; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.textAlign = "right"; ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(`${R.qmax.dP_bar.toFixed(d)} bar · ${R.qmax.hf.toFixed(dh)} m`, x - 10, y - 8);

  // Axis titles
  ctx.fillStyle = "#8b949e"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("Q (m³/h)", pad.l + plotW / 2, h - 4);
  ctx.save(); ctx.translate(12, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("ΔP (bar)", 0, 0); ctx.restore();
  ctx.save(); ctx.translate(w - 10, pad.t + plotH / 2); ctx.rotate(Math.PI / 2); ctx.fillText("h_f (m)", 0, 0); ctx.restore();
}

function drawHammerChart(R) {
  const c = $("pl-ham-canvas");
  if (!c) return;
  const { ctx, w, h } = fitCanvas(c);
  clearBg(ctx, w, h);
  if (!R || R.errors) return;

  const pad = { l: 52, r: 20, t: 18, b: 30 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const top = Math.max(R.P_peak, R.PMA || 0, R.PFA || 0, 1) * 1.12;
  const bottom = Math.min(0, R.P_min, R.P_vap_g) * 1.15 - 0.2;
  const yOf = p => pad.t + (top - p) / (top - bottom) * plotH;

  axes(ctx, w, h, pad);
  ctx.font = "11px ui-monospace, monospace";
  const stepsN = 6;
  for (let i = 0; i <= stepsN; i++) {
    const p = bottom + (top - bottom) * i / stepsN, y = yOf(p);
    ctx.fillStyle = "#8b949e"; ctx.textAlign = "right";
    ctx.fillText(p.toFixed(1), pad.l - 5, y + 3);
    ctx.strokeStyle = "#1c2530"; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }
  // zero line
  ctx.strokeStyle = "#8b949e"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, yOf(0)); ctx.lineTo(w - pad.r, yOf(0)); ctx.stroke();

  const barW = Math.min(90, plotW / 5);
  const xs = [0.2, 0.5, 0.8].map(f => pad.l + plotW * f - barW / 2);
  const bar = (x, p0, p1, color, label) => {
    const y0 = yOf(p0), y1 = yOf(p1);
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.min(y0, y1), barW, Math.abs(y1 - y0));
    if (label && Math.abs(y1 - y0) > 14) {
      ctx.fillStyle = "#0d1117"; ctx.font = "bold 11px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText(label, x + barW / 2, (y0 + y1) / 2 + 4);
    }
  };
  bar(xs[0], 0, R.P_steady, "#3fb950", fmt(R.P_steady, 2));
  bar(xs[1], 0, R.P_steady, "#3fb950", "");
  bar(xs[1], R.P_steady, R.P_peak, "#d29922", "+" + fmt(R.dP, 2));
  bar(xs[2], 0, R.P_min, "#58a6ff", fmt(R.P_min, 2));

  const hline = (p, color, dash, text) => {
    const y = yOf(p);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = "right";
    ctx.fillText(text, w - pad.r - 4, y - 4);
  };
  if (R.PFA != null) hline(R.PFA, "#79c0ff", [4, 3], `PFA ${fmt(R.PFA, 2)}`);
  if (R.PMA != null && Math.abs(R.PMA - R.PFA) > 1e-9) hline(R.PMA, "#f85149", [6, 3], `PMA ${fmt(R.PMA, 2)}`);
  else if (R.PMA != null) hline(R.PMA, "#f85149", [6, 3], `PFA = PMA ${fmt(R.PMA, 2)}`);
  hline(R.P_vap_g, "#a371f7", [2, 3], `vapour ${fmt(R.P_vap_g, 2)}`);

  // Peak label above bar
  ctx.fillStyle = "#e6edf3"; ctx.font = "bold 11px ui-monospace, monospace"; ctx.textAlign = "center";
  ctx.fillText(fmt(R.P_peak, 2), xs[1] + barW / 2, yOf(R.P_peak) - 5);

  ctx.fillStyle = "#e6edf3"; ctx.font = "11px sans-serif";
  ctx.fillText("Steady", xs[0] + barW / 2, h - pad.b + 16);
  ctx.fillText("Peak = steady + ΔP", xs[1] + barW / 2, h - pad.b + 16);
  ctx.fillText("Min = steady − ΔP", xs[2] + barW / 2, h - pad.b + 16);
}

/* ============ WIRING ============ */
function setTab(tab, fromRoute) {
  currentTab = TABS.some(t => t.id === tab) ? tab : "friction";
  if (!fromRoute && RO.app.isActive("pipeline")) history.replaceState(null, "", "#/pipeline/" + currentTab);
  ROOT.setAttribute("data-tab", currentTab);
  TABS_EL.querySelectorAll("button.tab").forEach(b => b.classList.toggle("active", b.dataset.tab === currentTab));
  ROOT.querySelectorAll("aside.left-panel .card[data-tabs]").forEach(card => {
    card.hidden = card.dataset.tabs.split(" ").indexOf(currentTab) < 0;
  });
  requestAnimationFrame(() => requestAnimationFrame(recalculate));
}

function setWallMode(mode, convert) {
  if (convert && LAST && LAST.geo && LAST.geo.e > 0 && LAST.geo.ID > 0) {
    $("pl_e_mm").value = +LAST.geo.e.toFixed(2);
    $("pl_ID_mm").value = +LAST.geo.ID.toFixed(2);
  }
  wallMode = mode === "id" ? "id" : "e";
  ROOT.querySelectorAll("#pl-wall-toggle .size-btn").forEach(b => b.classList.toggle("active", b.dataset.wall === wallMode));
  $("pl-e-row").hidden = wallMode !== "e";
  $("pl-id-row").hidden = wallMode !== "id";
}

function applyMaterial(key) {
  const m = MATERIALS[key];
  if (!m || key === "custom") return;
  $("pl_E_GPa").value = m.E;
  $("pl_eps_mm").value = m.eps;
  if (m.grade) $("pl_grade").value = m.grade;
}

function applyCatalogue() {
  const OD = parseFloat($("pl_cat_OD").value), sdr = parseFloat($("pl_cat_SDR").value);
  const e = P.catalogueWall(OD, sdr).e;
  $("pl_OD_mm").value = OD;
  $("pl_e_mm").value = e;
  $("pl_ID_mm").value = +(OD - 2 * e).toFixed(2);
  recalculate();
}

function bindAll() {
  // Generic: every module input recalculates
  ROOT.querySelectorAll("aside.left-panel input, aside.left-panel select").forEach(el => {
    if (FLUID_FIELDS[el.id]) return;
    el.addEventListener("input", recalculate);
    el.addEventListener("change", recalculate);
  });
  // Fluid inputs write to the shared store (which triggers recalculation via subscription)
  Object.keys(FLUID_FIELDS).forEach(id => {
    const el = $(id);
    const handler = () => {
      const patch = readFluidInputs();
      if (id === "pl_fluid_preset" && patch.preset !== "custom") {
        patch.S_gkg = FL.PRESETS[patch.preset].S;
        $("pl_S_gkg").value = patch.S_gkg;
      }
      RO.fluid.set(patch, "pipeline");
    };
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", handler);
  });
  RO.fluid.subscribe((s, source) => {
    if (source !== "pipeline") syncFluidInputs();
    else {
      const custom = s.preset === "custom";
      $("pl-custom-rows").hidden = !custom;
      $("pl-S-row").hidden = custom;
      $("pl_fluid_note").textContent = (FL.PRESETS[s.preset] || {}).note || "";
    }
    recalculate();
  });
  // Material presets fill E / ε; manual edits switch to Custom
  $("pl_material").addEventListener("change", e => { applyMaterial(e.target.value); recalculate(); });
  ["pl_E_GPa", "pl_eps_mm"].forEach(id => $(id).addEventListener("input", () => { $("pl_material").value = "custom"; }));
  $("pl_cat_apply").addEventListener("click", applyCatalogue);
  ROOT.querySelectorAll("#pl-wall-toggle .size-btn").forEach(b =>
    b.addEventListener("click", () => { setWallMode(b.dataset.wall, true); recalculate(); }));
  TABS_EL.querySelectorAll("button.tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  RO.util.bindCollapsibles(ROOT);
}

function resetAll() {
  writeInputs(DEFAULTS);
  setWallMode("e", false);
  RO.fluid.reset();          // notifies subscribers → syncs inputs + recalculates
}

/* ============ STATE (for project profiles) ============ */
function getState() {
  return { inputs: readInputs(), wallMode, tab: currentTab };
}
function setState(s) {
  if (!s) return;
  if (s.inputs) writeInputs(s.inputs);
  setWallMode(s.wallMode || "e", false);
  setTab(s.tab || currentTab);
}

/* ============ MODULE REGISTRATION ============ */
let resizeRaf = null;
RO.registerModule({
  id: "pipeline",
  title: "Pipeline Hydraulics",
  short: "Pipeline",
  icon: "🛢",
  description: "Friction loss, water hammer / surge and SDR / pipe class checks",

  mount(ctx) {
    ROOT = ctx.root; META_EL = ctx.meta; TABS_EL = ctx.tabs;
    ROOT.innerHTML = MARKUP;
    TABS_EL.innerHTML = TABS.map(t =>
      `<button class="tab" data-tab="${t.id}">${t.label}</button>`).join("");
    writeInputs(DEFAULTS);
    syncFluidInputs();
    bindAll();
    setWallMode("e", false);
    setTab("friction");

    window.addEventListener("resize", () => {
      if (!RO.app.isActive("pipeline")) return;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => { drawFrictionChart(LAST); drawHammerChart(LAST); });
    });
    window.addEventListener("beforeprint", () => {
      if (RO.app.isActive("pipeline")) setTimeout(recalculate, 30);
    });
    window.addEventListener("afterprint", () => {
      if (RO.app.isActive("pipeline")) setTimeout(recalculate, 30);
    });
  },
  onShow() { recalculate(); },
  onRoute(sub) { if (sub && sub !== currentTab) setTab(sub, true); },
  reset: resetAll,
  getState,
  setState,
  /* exposed for testing / other modules */
  api: { compute: (I, F) => compute(I, F), MATERIALS, deratingPE }
});
})(window.RO = window.RO || {});
