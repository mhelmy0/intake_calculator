/* ============================================================
   Shared hydraulic equations (SI units throughout)
   - Darcy–Weisbach head loss with Swamee–Jain friction factor
   - Korteweg wave speed + Joukowsky surge
   ============================================================ */
(function (RO) {
"use strict";

const G = 9.81;          // m/s²
const PATM = 101325;     // Pa

/* Swamee–Jain explicit approximation of Colebrook–White (Darcy f).
   f = 0.25 / [log10(ε/(3.7·D) + 5.74/Re^0.9)]²
   Same form the intake module has always used. */
function swameeJain(eps_m, D, Re) {
  if (Re <= 0 || D <= 0) return 0;
  const arg = eps_m / (3.7 * D) + 5.74 / Math.pow(Re, 0.9);
  const den = Math.log10(arg);
  return 0.25 / (den * den);
}

function regimeOf(Re) {
  if (Re < 2300) return "Laminar";
  if (Re < 4000) return "Transitional";
  return "Turbulent";
}

/* Darcy f with a laminar branch (64/Re below Re 2300); Swamee–Jain otherwise. */
function darcyFriction(eps_m, D, Re) {
  if (Re > 0 && Re < 2300) return { f: 64 / Re, method: "laminar" };
  return { f: swameeJain(eps_m, D, Re), method: "swamee-jain" };
}

const circleArea = D => Math.PI * D * D / 4;

/* Darcy–Weisbach: h_f = f · (L/D) · V²/2g  (m) */
function headLossDW(f, L, D, V) {
  return f * (L / D) * V * V / (2 * G);
}

/* Korteweg pressure-wave speed in a fluid-filled elastic pipe (m/s).
   a = √(K/ρ) / √(1 + ψ·(K/E)·(D/e)); ψ = pipe restraint factor (1 = thin-walled, anchored w/ expansion joints). */
function waveSpeed(K, rho, E, D, e, psi = 1) {
  return Math.sqrt(K / rho) / Math.sqrt(1 + psi * (K / E) * (D / e));
}

/* Joukowsky: ΔP = ρ·a·ΔV (Pa) */
function joukowskyPressure(rho, a, dV) {
  return rho * a * dV;
}

RO.hyd = {
  G, PATM,
  swameeJain, frictionFactor: swameeJain, darcyFriction, regimeOf,
  circleArea, headLossDW, waveSpeed, joukowskyPressure
};
})(window.RO = window.RO || {});
