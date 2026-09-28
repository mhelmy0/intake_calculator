/* ============================================================
   Fluid properties — presets, correlations and a shared store.

   Presets (freshwater / seawater / brine) differ only by salinity S and
   are evaluated at the user's temperature T with published correlations:
     ρ(T,S)  Sharqawy, Lienhard & Zubair (2010), eq. 8   0–180 °C, 0–160 g/kg
     μ(T,S)  Sharqawy et al. (2010), eqs. 22–23          0–180 °C, 0–150 g/kg
     c(T,S)  Marczak (1997) pure-water sound speed + Mackenzie (1981) salinity terms
     K       = ρ·c²   (isentropic bulk modulus — the one surge analysis needs)
     Pv(T,S) Antoine (water) with Sharqawy salinity correction
   Custom fluid: ρ, ν, K entered directly (no lookup).

   RO.fluid is an app-level store so any module can share the same fluid.
   ============================================================ */
(function (RO) {
"use strict";

const PRESETS = {
  fresh:  { short: "Freshwater", label: "Freshwater",                    S: 0,  note: "S = 0 g/kg; raise S for brackish feed" },
  sea:    { short: "Seawater", label: "Seawater (Gulf / Arabian Sea)", S: 40, note: "Arabian Sea ≈ 36–37 g/kg, Arabian Gulf ≈ 40–45 g/kg" },
  brine:  { short: "Brine", label: "Brine / RO reject",             S: 70, note: "≈ 40 g/kg feed at ~43 % recovery" },
  custom: { short: "Custom fluid", label: "Custom fluid",                  S: null, note: "density, viscosity and bulk modulus entered directly" }
};

/* ---------- Correlations (T in °C, S in g/kg) ---------- */
const DENS_A = [9.999e2, 2.034e-2, -6.162e-3, 2.261e-5, -4.657e-8];
const DENS_B = [8.020e2, -2.001, 1.677e-2, -3.060e-5, -1.613e-5];

function densitySW(T, S_gkg) {
  const s = S_gkg / 1000, t = T, a = DENS_A, b = DENS_B;
  const rho_w = a[0] + a[1] * t + a[2] * t * t + a[3] * t ** 3 + a[4] * t ** 4;
  const dS = b[0] * s + b[1] * s * t + b[2] * s * t * t + b[3] * s * t ** 3 + b[4] * s * s * t * t;
  return { rho: rho_w + dS, rho_w, dS };
}

function viscositySW(T, S_gkg) {
  const s = S_gkg / 1000, t = T;
  const mu_w = 4.2844e-5 + 1 / (0.157 * (t + 64.993) ** 2 - 91.296);
  const A = 1.541 + 1.998e-2 * t - 9.52e-5 * t * t;
  const B = 7.974 - 7.561e-2 * t + 4.724e-4 * t * t;
  const factor = 1 + A * s + B * s * s;
  return { mu: mu_w * factor, mu_w, A, B, factor };
}

function soundSpeed(T, S_gkg) {
  const t = T;
  const c_w = 1402.385 + 5.038813 * t - 5.799136e-2 * t * t + 3.287156e-4 * t ** 3
            - 1.398845e-6 * t ** 4 + 2.787860e-9 * t ** 5;
  const dcdS = 1.340 - 1.025e-2 * t;
  return { c: c_w + dcdS * S_gkg, c_w, dcdS };
}

function vaporPressure(T, S_gkg = 0) {
  const Pw = Math.pow(10, 8.07131 - 1730.63 / (233.426 + T)) * 133.322;   // Pa
  const corr = 1 + 0.57357 * S_gkg / (1000 - S_gkg);
  return Pw / corr;
}

/* ---------- Evaluate a fluid state ---------- */
function compute(s) {
  const T = s.T_C;
  const warnings = [];
  const steps = [];
  if (!isFinite(T)) return { error: "Enter a temperature" };

  if (s.preset === "custom") {
    const rho = s.rho, nu = s.nu_cSt * 1e-6, K = s.K_GPa * 1e9;
    if (!(rho > 0) || !(nu > 0) || !(K > 0)) return { error: "Custom fluid needs ρ, ν and K > 0" };
    const mu = nu * rho, c = Math.sqrt(K / rho), Pv = vaporPressure(T, 0);
    steps.push({ head: "Custom fluid (user-entered)" });
    steps.push({ label: "Density (entered)", res: `ρ = ${rho.toFixed(1)} kg/m³` });
    steps.push({ label: "Kinematic viscosity (entered)", res: `ν = ${nu.toExponential(3)} m²/s` });
    steps.push({ label: "Bulk modulus (entered)", res: `K = ${(K / 1e9).toFixed(3)} GPa` });
    steps.push({ label: "Dynamic viscosity", eq: "μ = ν · ρ",
      sub: `= ${nu.toExponential(3)} × ${rho.toFixed(1)}`, res: `= ${(mu * 1000).toFixed(4)} mPa·s` });
    steps.push({ label: "Sound speed in fluid", eq: "c = √(K / ρ)",
      sub: `= √(${K.toExponential(3)} / ${rho.toFixed(1)})`, res: `= ${c.toFixed(1)} m/s` });
    steps.push({ label: "Vapour pressure (pure water basis)", eq: "log₁₀ Pv[mmHg] = 8.07131 − 1730.63 / (233.426 + T)",
      res: `Pv = ${(Pv / 1000).toFixed(3)} kPa`, note: "Used only for the downsurge / column-separation check." });
    return { preset: "custom", label: PRESETS.custom.label, short: PRESETS.custom.short, T, S: null, rho, nu, mu, K, c, Pv,
             source: "user-entered", steps, warnings };
  }

  const S = s.S_gkg;
  if (!isFinite(S) || S < 0) return { error: "Enter salinity ≥ 0 g/kg" };
  if (T < 0 || T > 95) warnings.push("Temperature outside 0–95 °C correlation range");
  if (S > 150) warnings.push("Salinity above 150 g/kg — viscosity correlation out of range");
  if (S > 40) warnings.push("Sound-speed salinity term extrapolated above 40 g/kg (brine) — K is approximate");

  const d = densitySW(T, S), v = viscositySW(T, S), sc = soundSpeed(T, S);
  const rho = d.rho, mu = v.mu, nu = mu / rho, c = sc.c, K = rho * c * c;
  const Pv = vaporPressure(T, S);
  const sk = S / 1000;

  steps.push({ head: `${PRESETS[s.preset] ? PRESETS[s.preset].label : "Fluid"} · T = ${T} °C · S = ${S} g/kg` });
  steps.push({ label: "Pure-water density ρw(T)", eq: "ρw = a1 + a2·T + a3·T² + a4·T³ + a5·T⁴",
    sub: `a = [${DENS_A.join(", ")}]`, res: `ρw = ${d.rho_w.toFixed(2)} kg/m³`,
    note: "Sharqawy, Lienhard & Zubair (2010) eq. 8" });
  steps.push({ label: "Salinity density increment", eq: "Δρ = b1·S + b2·S·T + b3·S·T² + b4·S·T³ + b5·S²·T²  (S in kg/kg)",
    sub: `b = [${DENS_B.join(", ")}], S = ${sk.toFixed(4)}`, res: `Δρ = ${d.dS.toFixed(2)} kg/m³` });
  steps.push({ label: "Density", eq: "ρ = ρw + Δρ", sub: `= ${d.rho_w.toFixed(2)} + ${d.dS.toFixed(2)}`,
    res: `ρ = ${rho.toFixed(2)} kg/m³` });
  steps.push({ label: "Pure-water viscosity μw(T)", eq: "μw = 4.2844e-5 + [0.157·(T + 64.993)² − 91.296]⁻¹",
    res: `μw = ${(v.mu_w * 1000).toFixed(4)} mPa·s`, note: "Sharqawy et al. (2010) eq. 23" });
  steps.push({ label: "Salinity viscosity factor", eq: "μ/μw = 1 + A·S + B·S²",
    sub: `A = 1.541 + 1.998e-2·T − 9.52e-5·T² = ${v.A.toFixed(4)};  B = 7.974 − 7.561e-2·T + 4.724e-4·T² = ${v.B.toFixed(4)}`,
    res: `μ/μw = ${v.factor.toFixed(4)}  →  μ = ${(mu * 1000).toFixed(4)} mPa·s`, note: "Sharqawy et al. (2010) eq. 22" });
  steps.push({ label: "Kinematic viscosity", eq: "ν = μ / ρ", sub: `= ${mu.toExponential(4)} / ${rho.toFixed(2)}`,
    res: `ν = ${nu.toExponential(3)} m²/s  (${(nu * 1e6).toFixed(4)} cSt)` });
  steps.push({ label: "Sound speed", eq: "c = cw(T) + (1.340 − 0.01025·T)·S   (S in g/kg)",
    sub: `cw = ${sc.c_w.toFixed(2)} m/s (Marczak 1997);  dc/dS = ${sc.dcdS.toFixed(4)}`,
    res: `c = ${c.toFixed(1)} m/s`, note: "Salinity terms from Mackenzie (1981), surface pressure" });
  steps.push({ label: "Bulk modulus (isentropic)", eq: "K = ρ · c²", sub: `= ${rho.toFixed(2)} × ${c.toFixed(1)}²`,
    res: `K = ${(K / 1e9).toFixed(3)} GPa` });
  steps.push({ label: "Vapour pressure", eq: "Pv = Pv,w(T) / (1 + 0.57357·S/(1000 − S)),  log₁₀ Pv,w[mmHg] = 8.07131 − 1730.63/(233.426 + T)",
    res: `Pv = ${(Pv / 1000).toFixed(3)} kPa` });

  return { preset: s.preset, label: (PRESETS[s.preset] || {}).label || "Fluid", short: (PRESETS[s.preset] || {}).short || "Fluid", T, S, rho, nu, mu, K, c, Pv,
           source: "Sharqawy 2010 · Marczak 1997 · Mackenzie 1981", steps, warnings };
}

/* ---------- Shared store ---------- */
/* Matches the recommended design basis (feed.temp_C 25 °C, feed.tds_mgL 41,000 mg/L ≈ 40 g/kg). */
const DEFAULT_STATE = { preset: "sea", T_C: 25, S_gkg: 40, rho: 1025, nu_cSt: 0.95, K_GPa: 2.34 };
let state = Object.assign({}, DEFAULT_STATE);
const subs = new Set();

RO.fluid = {
  DEFAULT_STATE,
  get: () => Object.assign({}, state),
  set(patch, source) {
    state = Object.assign({}, state, patch);
    subs.forEach(fn => fn(state, source));
  },
  reset(source) { this.set(Object.assign({}, DEFAULT_STATE), source); },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  props() { return compute(state); }
};

RO.fluids = { PRESETS, compute, densitySW, viscositySW, soundSpeed, vaporPressure };
})(window.RO = window.RO || {});
