/* ============================================================
   Recommended values ("recommended but user-defined").
   Bundled defaults mirror db/seed_values.php; the server copy (edited by
   approvers) replaces them when online. Modules read RO.values.get(key)
   as the default for an input the user can still override.
   ============================================================ */
(function (RO) {
"use strict";

const DEFAULTS = {
  "buoyancy.sf_min":        { value: 1.5,  unit: "—",     label: "Minimum anchoring safety factor (air-filled uplift)", source: "Team practice (legacy buoyancy app)" },
  "buoyancy.concrete_rho":  { value: 2400, unit: "kg/m³", label: "Concrete ballast density", source: "PPI Handbook Ch.10" },
  "buoyancy.pe_rho":        { value: 950,  unit: "kg/m³", label: "PE pipe material density", source: "PPI Handbook Ch.10" },
  "surge.psi_pe":           { value: 0.80, unit: "—",     label: "Wave-speed restraint factor ψ (PE)", source: "Wylie & Streeter: 1 − μ², μ ≈ 0.45" },
  "material.pe100_E_GPa":   { value: 1.0,  unit: "GPa",   label: "PE100 short-term elastic modulus (surge)", source: "Typical manufacturer data" },
  "pump.por_min":           { value: 0.70, unit: "× BEP", label: "Preferred operating region — lower limit", source: "ANSI/HI 9.6.3" },
  "pump.por_max":           { value: 1.20, unit: "× BEP", label: "Preferred operating region — upper limit", source: "ANSI/HI 9.6.3" },
  "pump.npsh_margin_m":     { value: 0.5,  unit: "m",     label: "NPSH margin NPSHa − NPSHr", source: "Design practice" },
  "pump.npsh_ratio":        { value: 1.1,  unit: "—",     label: "NPSH ratio NPSHa / NPSHr", source: "Design practice (see ANSI/HI 9.6.1)" },
  "pump.motor_margin":      { value: 1.15, unit: "—",     label: "Motor rating ÷ max absorbed power", source: "Design practice" },
  "intake.head_margin_m":   { value: 0.20, unit: "m",     label: "Gravity intake head margin at LAT", source: "Intake calculator (legacy)" },
  "velocity.suction_min":   { value: 0.6,  unit: "m/s",   label: "Suction velocity — min", source: "Design practice" },
  "velocity.suction_max":   { value: 1.5,  unit: "m/s",   label: "Suction velocity — max", source: "Design practice" },
  "velocity.discharge_min": { value: 0.6,  unit: "m/s",   label: "Discharge velocity — min", source: "Design practice" },
  "velocity.discharge_max": { value: 3.0,  unit: "m/s",   label: "Discharge velocity — max", source: "Design practice" },
  "submergence.hi_coeff":   { value: 2.3,  unit: "—",     label: "Submergence S = D(1 + c·Fr)", source: "ANSI/HI 9.8" },
  "velocity.gravity_min":   { value: 0.8,  unit: "m/s",   label: "Gravity line velocity @ Q_max — min", source: "Intake calculator (legacy)" },
  "velocity.gravity_max":   { value: 2.0,  unit: "m/s",   label: "Gravity line velocity @ Q_max — max", source: "Intake calculator (legacy)" },
  "velocity.sediment_min":  { value: 0.6,  unit: "m/s",   label: "Min velocity @ Q_min, one line (sediment)", source: "Intake calculator (legacy)" },
  "feed.temp_C":            { value: 25,    unit: "°C",    label: "Design feed temperature", source: "Design seawater temperature — edit per site" },
  "feed.tds_mgL":           { value: 41000, unit: "mg/L",  label: "Design feed TDS", source: "Arabian Gulf seawater ≈ 40 g/kg" },
  "delivery.residual_bar":  { value: 2.0,   unit: "bar",   label: "Residual pressure at delivery", source: "Pressure at the pretreatment / filter inlet" },
  "pump.head_margin_pct":   { value: 10,    unit: "%",     label: "Pump head design margin", source: "Design allowance" },
  "pump.eff_pct":           { value: 78,    unit: "%",     label: "Pump efficiency (before a pump is selected)", source: "Split-case pump near BEP" },
  "motor.eff_pct":          { value: 95,    unit: "%",     label: "Motor efficiency", source: "IE3 motor" },
  "velocity.size_target":   { value: 1.5,   unit: "m/s",   label: "Target velocity for recommended pipe size", source: "Design practice" },
  "pipeline.cover_m":        { value: 1.0,   unit: "m",     label: "Pipeline cover to crown (default)", source: "Typical minimum cover for buried PE — verify per local code / crossing" },
  "pipeline.residual_bar":   { value: 0.5,   unit: "bar",   label: "Pipeline residual pressure at delivery", source: "Open tank inlet ≈ 0–0.5 bar; filters ≈ 2 bar" },
  "pipeline.min_pressure_bar": { value: 0.2, unit: "bar",   label: "Minimum pressure along the pipeline", source: "Design practice: keep the HGL ≈ 2 m above the pipe" },
  "pipeline.bend_min_deg":   { value: 11.25, unit: "°",     label: "Profile deflection that suggests a bend", source: "Smallest standard bend (11.25°)" },
  "bom.stick_m":             { value: 12,    unit: "m",     label: "Pipe stick length (BOM)", source: "Standard straight PE length (6 / 12 m); check the supplier" },
  "bom.allowance_pct":       { value: 3,     unit: "%",     label: "Pipe ordering allowance (cut-offs, fusion beads)", source: "Design practice" },
  "buoyancy.wall_factor":    { value: 1.06,  unit: "—",     label: "Wall factor for pipe weight", source: "PPI Handbook Ch.10: manufacturers add ≈ 6 % wall" },
  "buoyancy.growth_rho":     { value: 1325,  unit: "kg/m³", label: "Marine growth density", source: "DNV-RP-C205" },
  "pt.rapid_t_s":            { value: 60, unit: "s", label: "Rapid mix time", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.rapid_G":              { value: 750, unit: "1/s", label: "Rapid mix velocity gradient G", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.floc_t_daf_min":       { value: 8, unit: "min", label: "Flocculation time ahead of DAF", source: "DAF studies: 5–8 min" },
  "pt.floc_t_sed_min":       { value: 20, unit: "min", label: "Flocculation time ahead of sedimentation", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.floc_G":               { value: 50, unit: "1/s", label: "Flocculation velocity gradient G", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.daf_hlr":              { value: 20, unit: "m/h", label: "DAF hydraulic loading rate (net flow)", source: "Pretreatment PRD v0.2 decision (high-rate 20–40 m/h)" },
  "pt.daf_recovery_pct":     { value: 98, unit: "%", label: "DAF recovery (float / drain loss)", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.daf_recycle_pct":      { value: 12, unit: "%", label: "DAF recycle ratio", source: "Typical value — confirm (Pretreatment PRD §3) (studied 5–50 %)" },
  "pt.daf_psat_bar":         { value: 5.5, unit: "bar", label: "DAF saturator pressure (gauge)", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.daf_sat_eff":          { value: 0.8, unit: "—", label: "DAF saturator efficiency", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.daf_contact_min":      { value: 2, unit: "min", label: "DAF contact zone time", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.daf_depth_m":          { value: 3.0, unit: "m", label: "DAF separation depth", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.daf_lw":               { value: 2, unit: "—", label: "DAF length : width", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.air_sol_mgL":          { value: 18.7, unit: "mg/L", label: "Air solubility at 1 atm (≈ 20 °C, fresh water)", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.daf_tss_removal_pct":  { value: 90, unit: "%", label: "DAF TSS removal", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.sed_lamella_rate":     { value: 12, unit: "m/h", label: "Lamella settler loading (basin plan area)", source: "Pretreatment PRD v0.2 decision (10–25 m/h)" },
  "pt.sed_conv_rate":        { value: 1.2, unit: "m/h", label: "Conventional settling overflow rate", source: "Pretreatment PRD v0.2 decision (20–40 m³/m²·d)" },
  "pt.sed_detention_h":      { value: 2.5, unit: "h", label: "Conventional settling detention time", source: "Pretreatment PRD v0.2 decision" },
  "pt.sed_plate_deg":        { value: 60, unit: "°", label: "Lamella plate angle", source: "50–70° typical" },
  "pt.sed_lw":               { value: 4, unit: "—", label: "Settling basin length : width", source: "Pretreatment PRD v0.2 decision" },
  "pt.sed_weir_max":         { value: 250, unit: "m³/m·d", label: "Maximum weir loading", source: "Pretreatment PRD v0.2 decision" },
  "pt.sed_tss_removal_pct":  { value: 80, unit: "%", label: "Settling TSS removal", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.sludge_solids_pct":    { value: 1, unit: "%", label: "Sludge / float solids content", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.mmf_rate_normal":      { value: 10, unit: "m/h", label: "Media filter rate — normal (all in service)", source: "DuPont FilmTec RO/NF manual Rev. 20 §2.5 (< 10 m/h high-fouling water)" },
  "pt.mmf_rate_max":         { value: 12.5, unit: "m/h", label: "Media filter rate — maximum with N−1", source: "Pretreatment PRD v0.2 decision" },
  "pt.mmf_diameter_m":       { value: 3.0, unit: "m", label: "Pressure filter diameter (custom size)", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.mmf_ld_dual":          { value: 1000, unit: "—", label: "Bed L/dₑ minimum — mono / dual media", source: "McGivney & Kawamura" },
  "pt.mmf_ld_tri":           { value: 1250, unit: "—", label: "Bed L/dₑ minimum — tri-media", source: "McGivney & Kawamura" },
  "pt.mmf_ld_fine":          { value: 1.15, unit: "—", label: "L/dₑ factor for filtrate < 0.1 NTU", source: "McGivney & Kawamura (+15 %)" },
  "pt.anth_depth_m":         { value: 0.8, unit: "m", label: "Anthracite depth", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.anth_es_mm":           { value: 1.2, unit: "mm", label: "Anthracite effective size", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.sand_depth_m":         { value: 0.6, unit: "m", label: "Sand depth", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.sand_es_mm":           { value: 0.5, unit: "mm", label: "Sand effective size", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.garnet_depth_m":       { value: 0.15, unit: "m", label: "Garnet depth (tri-media)", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.garnet_es_mm":         { value: 0.3, unit: "mm", label: "Garnet effective size", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.anth_bulk":            { value: 750, unit: "kg/m³", label: "Anthracite bulk density", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.sand_bulk":            { value: 1600, unit: "kg/m³", label: "Sand bulk density", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.garnet_bulk":          { value: 2300, unit: "kg/m³", label: "Garnet bulk density", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.bw_rate":              { value: 45, unit: "m/h", label: "Backwash water rate", source: "DuPont FilmTec RO/NF manual Rev. 20 §2.5 (40–50 m/h)" },
  "pt.bw_min":               { value: 10, unit: "min", label: "Backwash water duration", source: "DuPont FilmTec RO/NF manual Rev. 20 §2.5 (≈ 10 min)" },
  "pt.air_rate":             { value: 55, unit: "Nm³/m²·h", label: "Air scour rate", source: "Full-scale SWRO example (55 Nm³/m²·h)" },
  "pt.air_min":              { value: 4, unit: "min", label: "Air scour duration", source: "Full-scale SWRO example (3–5 min)" },
  "pt.rinse_min":            { value: 5, unit: "min", label: "Rinse (forward flush) duration", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.run_h":                { value: 24, unit: "h", label: "Filter run between backwashes", source: "Typical value — confirm (Pretreatment PRD §3) (backwash at ΔP 0.3–0.6 bar)" },
  "pt.bw_loss_max_pct":      { value: 5, unit: "%", label: "Maximum backwash water loss", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.bag_standby":          { value: 1, unit: "—", label: "Bag filter standby housings", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.bag_change_bar":       { value: 1.0, unit: "bar", label: "Bag change-out ΔP", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.cf_q10":               { value: 0.8, unit: "m³/h", label: "Cartridge flow per 10-inch length", source: "Pretreatment PRD v0.2 decision" },
  "pt.cf_elements_housing":  { value: 150, unit: "—", label: "Cartridge elements per housing (custom housing)", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.cf_standby":           { value: 1, unit: "—", label: "Cartridge standby housings", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.cf_replace_bar":       { value: 1.0, unit: "bar", label: "Cartridge replacement ΔP", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.cf_months":            { value: 3, unit: "months", label: "Cartridge replacement interval (max.)", source: "DuPont FilmTec RO/NF manual Rev. 20 §2.5 (at least every 3 months)" },
  "pt.dose_pump_margin":     { value: 1.3, unit: "—", label: "Dosing pump capacity margin", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.dose_turndown":        { value: 10, unit: "—", label: "Dosing pump turndown", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.cl2_residual":         { value: 0.5, unit: "mg/L", label: "Chlorine residual ahead of dechlorination", source: "Typical value — confirm (Pretreatment PRD §3)" },
  "pt.smbs_ratio":           { value: 3.0, unit: "—", label: "SMBS per mg chlorine", source: "DuPont FilmTec RO/NF manual Rev. 20 §2.6.3 (1.34 stoichiometric; 3.0 practice)" }
};

let table = JSON.parse(JSON.stringify(DEFAULTS));
let fromServer = false;
const subs = new Set();

async function load() {
  if (!RO.api || !RO.api.state.online) return;
  try {
    const j = await RO.api.get("/values");
    Object.keys(j.values).forEach(k => { table[k] = Object.assign({}, table[k] || {}, j.values[k]); });
    fromServer = true;
    subs.forEach(fn => fn());
  } catch (e) { /* keep bundled defaults */ }
}

RO.values = {
  DEFAULTS,
  load,
  get: key => (table[key] ? table[key].value : undefined),
  meta: key => table[key],
  all: () => table,
  isFromServer: () => fromServer,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
};
})(window.RO = window.RO || {});
