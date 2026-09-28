/* ============================================================
   Shared fluid-properties card (inputs bound to the app-level RO.fluid store).
   Any module can embed it: RO.fluidui.cardHtml(prefix) + RO.fluidui.bind(prefix).
   ============================================================ */
(function (RO) {
"use strict";

const FL = RO.fluids;
const FIELDS = { preset: "preset", T: "T_C", S: "S_gkg", rho: "rho", nu: "nu_cSt", K: "K_GPa" };

function cardHtml(p, tabs) {
  const num = (id, label, step, extra = "") =>
    `<div class="input-row"><label for="${p}_${id}">${label}</label><input type="number" id="${p}_${id}" step="${step}"${extra}></div>`;
  const vc = (id, label, unit) =>
    `<div class="value-card" id="${p}_fp_${id}"><span class="v-label">${label}</span><span class="v-val">—</span><span class="v-unit">${unit}</span></div>`;
  return `
    <div class="card" ${tabs ? `data-tabs="${tabs}"` : ""}>
      <h2>Fluid <span class="h2-tag">shared by all calculators</span></h2>
      <div class="card-body">
        <div class="input-row">
          <label for="${p}_preset">Fluid</label>
          <select id="${p}_preset">${Object.keys(FL.PRESETS).map(k => `<option value="${k}">${FL.PRESETS[k].label}</option>`).join("")}</select>
          <div class="hint" id="${p}_note"></div>
        </div>
        <div class="input-pair">
          ${num("T", `Temperature (${RO.units.ul("temp")})`, "any")}
          <div id="${p}_S_row">${num("S", "Salinity S (g/kg)", "0.5", ' min="0"')}</div>
        </div>
        <div id="${p}_custom" style="margin-top:7px">
          ${num("rho", `Density ρ (${RO.units.ul("dens")})`, "any", ' min="0"')}
          ${num("nu", "Kinematic viscosity ν (×10⁻⁶ m²/s = cSt)", "0.01", ' min="0"')}
          ${num("K", `Bulk modulus K (${RO.units.ul("gpa")})`, "any", ' min="0"')}
        </div>
        <div class="pl-mini-grid fluid">
          ${vc("rho", "Density", RO.units.label("dens"))}${vc("nu", "Kin. visc.", "cSt")}${vc("mu", "Dyn. visc.", "mPa·s")}${vc("K", "Bulk mod.", RO.units.label("gpa"))}
        </div>
        <div class="src-note" id="${p}_src"></div>
      </div>
    </div>`;
}

function sync(p) {
  const s = RO.fluid.get();
  const Q = { T: "temp", rho: "dens", K: "gpa" };
  Object.keys(FIELDS).forEach(id => {
    const el = document.getElementById(`${p}_${id}`);
    if (el && document.activeElement !== el) el.value = Q[id] ? RO.units.inputValue(Q[id], s[FIELDS[id]]) : s[FIELDS[id]];
  });
  const custom = s.preset === "custom";
  document.getElementById(`${p}_custom`).hidden = !custom;
  document.getElementById(`${p}_S_row`).hidden = custom;
  document.getElementById(`${p}_note`).textContent = (FL.PRESETS[s.preset] || {}).note || "";
}

function renderProps(p) {
  const F = RO.fluid.props();
  const set = (id, v) => RO.util.setVC(`${p}_fp_${id}`, v);
  if (F.error) {
    ["rho", "nu", "mu", "K"].forEach(id => set(id, "—"));
    document.getElementById(`${p}_src`).textContent = F.error;
    return F;
  }
  set("rho", RO.units.fmt("dens", F.rho));
  set("nu", RO.util.fmt(F.nu * 1e6, 4));
  set("mu", RO.util.fmt(F.mu * 1000, 4));
  set("K", RO.units.fmt("gpa", F.K / 1e9));
  document.getElementById(`${p}_src`).textContent = "source: " + F.source + (F.warnings.length ? " · ⚠ " + F.warnings.join("; ") : "");
  return F;
}

/** Bind inputs to the store. onChange() is called after every fluid change (from any module). */
function bind(p, onChange) {
  Object.keys(FIELDS).forEach(id => {
    const el = document.getElementById(`${p}_${id}`);
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const patch = {};
      Object.keys(FIELDS).forEach(k => {
        const e = document.getElementById(`${p}_${k}`);
        const q = { T: "temp", rho: "dens", K: "gpa" }[k];
        patch[FIELDS[k]] = e.tagName === "SELECT" ? e.value : (q ? RO.units.parse(q, e.value) : parseFloat(e.value));
      });
      if (id === "preset" && patch.preset !== "custom") patch.S_gkg = FL.PRESETS[patch.preset].S;
      RO.fluid.set(patch, p);
    });
  });
  RO.fluid.subscribe(() => {
    sync(p);                       // skips the field being typed in
    renderProps(p);
    if (onChange) onChange();
  });
  RO.units.subscribe(() => {
    const card = document.getElementById(`${p}_preset`).closest(".card");
    RO.units.applyLabels(card);
    card.querySelector(`#${p}_fp_rho .v-unit`).textContent = RO.units.label("dens");
    card.querySelector(`#${p}_fp_K .v-unit`).textContent = RO.units.label("gpa");
    sync(p); renderProps(p);
  });
  sync(p);
  renderProps(p);
}

RO.fluidui = { cardHtml, bind, sync, renderProps };
})(window.RO = window.RO || {});
