/* ============================================================
   Module: Tools — quick calculators shared across jobs.
     · Line velocity (from the legacy intake; shared fluid model; SI / Imperial)
     · Fluid properties (correlations, preset source values, traces)
   ============================================================ */
(function (RO) {
"use strict";

const { G, swameeJain, regimeOf } = RO.hyd;
const { $, fmt, fmtExp, escHtml, setVC, renderSteps } = RO.util;
const U = RO.units;
const FL = RO.fluids;

let ROOT = null, META = null, TABS = null, tab = "velocity";
const TL = { Q: 1500, V: 1.5, D: 500, eps: 0.0015 };     // SI state (m³/h, m/s, mm, mm)

const vc = (id, label, unit) =>
  `<div class="value-card" id="${id}"><span class="v-label">${label}</span><span class="v-val">—</span><span class="v-unit">${unit}</span></div>`;
const inp = (id, label, q) => `<div id="${id}-row" class="input-row"><label for="${id}">${label} (${U.ul(q)})</label><input type="text" inputmode="decimal" id="${id}" data-q="${q}"></div>`;

const MARKUP = `
  <aside class="left-panel">
    ${RO.fluidui.cardHtml("tl", "velocity fluid")}
  </aside>
  <section class="right-panel">
    <div class="view tl-velocity-view">
      <div class="vc-card blueprint"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <h2>Line velocity</h2>
        <div class="input-row">
          <label for="tl_mode">Calculation mode</label>
          <select id="tl_mode">
            <option value="QD">Flow + diameter → velocity</option>
            <option value="VD">Velocity + diameter → flow</option>
            <option value="VQ">Velocity + flow → diameter</option>
          </select>
        </div>
        <h3>Required inputs</h3>
        ${inp("tl_Q", "Flow rate", "flow")}${inp("tl_V", "Velocity", "vel")}${inp("tl_D", "Pipe inner diameter", "dia")}
        <h3>Friction loss &amp; pipe suggestion</h3>
        <div class="input-pair">
          ${inp("tl_eps", "Roughness ε", "rough")}
          <div class="input-row"><label for="tl_sdr">PE SDR for suggested pipe</label>
            <select id="tl_sdr">${RO.pipes.SDR_KEYS.map(k => `<option value="${k}">${k}</option>`).join("")}</select></div>
        </div>
        <div class="vc-status-line" id="tl_status">—</div>
        <h3>Outputs</h3>
        <div class="vc-output-grid">
          ${vc("tl_out_V", "Flow velocity", "")}${vc("tl_out_Q", "Flow rate", "")}
          ${vc("tl_out_D", "Inner diameter", "")}${vc("tl_out_A", "Flow area", "")}
          ${vc("tl_out_Re", "Reynolds number", "regime")}${vc("tl_out_f", "Darcy friction factor", "—")}
          ${vc("tl_out_hf", "Friction loss", "")}${vc("tl_out_DN", "Suggested PE pipe", "OD")}
        </div>
        <p class="hint" id="tl_bands"></p>
      </div>
    </div>

    <div class="view tl-fluid-view">
      <div class="card tl-fl-props">
        <h2>Fluid properties <span class="h2-tag" id="tl-fl-tag"></span></h2>
        <div class="card-body">
          <div class="value-grid">
            ${vc("tl_fl_rho", "Density ρ", "")}${vc("tl_fl_nu", "Kinematic viscosity ν", "m²/s")}
            ${vc("tl_fl_mu", "Dynamic viscosity μ", "mPa·s")}${vc("tl_fl_K", "Bulk modulus K", "")}
            ${vc("tl_fl_c", "Sound speed c", "")}${vc("tl_fl_Pv", "Vapour pressure", "")}
          </div>
          <ul class="warn-list" id="tl-fl-warn"></ul>
        </div>
      </div>
      <div class="card tl-fl-presets">
        <h2>Preset source values <span class="h2-tag" id="tl-fl-preset-tag"></span></h2>
        <div class="card-body table-wrap"><table class="data-table" id="tl-fl-table"></table></div>
      </div>
      <div class="card tl-fl-steps">
        <h2>Correlations &amp; intermediate values <span class="h2-tag">SI units</span></h2>
        <div class="card-body"><div class="steps" id="tl-fl-steps"></div></div>
      </div>
    </div>
  </section>`;

/* ---------- velocity ---------- */
function writeInputs() {
  [["tl_Q", "flow", TL.Q], ["tl_V", "vel", TL.V], ["tl_D", "dia", TL.D], ["tl_eps", "rough", TL.eps]].forEach(([id, q, v]) => {
    const el = $(id); if (el && document.activeElement !== el) el.value = U.inputValue(q, v);
  });
}
function readInput(el) {
  const map = { tl_Q: "Q", tl_V: "V", tl_D: "D", tl_eps: "eps" };
  const v = U.parse(el.dataset.q, el.value);
  if (v !== null && isFinite(v)) TL[map[el.id]] = v;
}

function velocity() {
  const mode = $("tl_mode").value;
  $("tl_Q-row").hidden = !(mode === "QD" || mode === "VQ");
  $("tl_V-row").hidden = !(mode === "VD" || mode === "VQ");
  $("tl_D-row").hidden = !(mode === "QD" || mode === "VD");
  const F = RO.fluid.props();
  let Q, V, D, err = "";
  if (F.error) err = F.error;
  else if (mode === "QD") { Q = TL.Q / 3600; D = TL.D / 1000; if (!(D > 0)) err = "Enter diameter"; else V = Q / (Math.PI * D * D / 4); }
  else if (mode === "VD") { V = TL.V; D = TL.D / 1000; if (!(D > 0)) err = "Enter diameter"; else Q = V * Math.PI * D * D / 4; }
  else { V = TL.V; Q = TL.Q / 3600; if (!(V > 0)) err = "Enter velocity"; else D = Math.sqrt(4 * Q / V / Math.PI); }
  const vB = x => `${U.fmt("vel", x, 1)}`;
  $("tl_bands").textContent = `Status bands (${U.label("vel")}): < ${vB(0.6)} sediment risk · ${vB(0.6)}–${vB(0.8)} marginal · ${vB(0.8)}–${vB(2.0)} gravity OK · ${vB(2.0)}–${vB(2.5)} pumped OK · > ${vB(2.5)} too fast. Fluid from the Fluid card, shared with every calculator.`;
  const status = $("tl_status");
  const ids = ["tl_out_V", "tl_out_Q", "tl_out_D", "tl_out_A", "tl_out_Re", "tl_out_f", "tl_out_hf", "tl_out_DN"];
  if (err || !isFinite(V) || !isFinite(D)) {
    status.className = "vc-status-line warn"; status.textContent = err || "Check inputs";
    ids.forEach(id => setVC(id, "—"));
    return;
  }
  const A = Math.PI * D * D / 4, Re = V * D / F.nu;
  const f = Re < 2300 && Re > 0 ? 64 / Re : swameeJain(TL.eps / 1000, D, Re);
  const hf100 = f * (100 / D) * V * V / (2 * G);            // m per 100 m = ft per 100 ft
  const sdr = $("tl_sdr").value;
  const dn = RO.pipes.DN_LIST_MM.find(d => { const p = RO.pipes.getPipeData(d, sdr); return p && p.ID_mm / 1000 >= D - 1e-9; });
  let badge, st;
  if (V <= 0) { badge = "—"; st = "warn"; }
  else if (V < 0.6) { badge = "Sediment risk — too slow"; st = "fail"; }
  else if (V < 0.8) { badge = "Marginal"; st = "warn"; }
  else if (V <= 2.0) { badge = "OK gravity"; st = "pass"; }
  else if (V <= 2.5) { badge = "OK pumped"; st = "pass"; }
  else { badge = "Too fast — erosion / cavitation"; st = "fail"; }
  status.className = "vc-status-line " + st;
  status.textContent = `V = ${U.fmt("vel", V)} ${U.label("vel")} — ${badge}`;
  setVC("tl_out_V", U.fmt("vel", V), U.label("vel"), st);
  setVC("tl_out_Q", U.fmt("flow", Q * 3600, 1), U.label("flow"));
  setVC("tl_out_D", U.fmt("dia", D * 1000), U.label("dia"));
  setVC("tl_out_A", U.fmt("area", A), U.label("area"));
  setVC("tl_out_Re", fmtExp(Re, 2), regimeOf(Re));
  setVC("tl_out_f", fmt(f, 5), Re < 2300 ? "64/Re" : "Swamee–Jain");
  setVC("tl_out_hf", fmt(hf100, 3), `${U.label("head")} / 100 ${U.label("len")}`);
  setVC("tl_out_DN", dn ? "OD " + dn : "> OD 1200", `${sdr} · mm${U.isImperial() && dn ? ` (${(dn / 25.4).toFixed(1)} in)` : ""}`);
}

/* ---------- fluid view ---------- */
function fluidView() {
  const F = RO.fluid.props();
  if (F.error) { $("tl-fl-tag").textContent = F.error; return; }
  $("tl-fl-tag").textContent = `${F.label}${F.S != null ? " · " + F.S + " g/kg" : ""} · ${U.fmt("temp", F.T)} ${U.label("temp")}`;
  setVC("tl_fl_rho", U.fmt("dens", F.rho), U.label("dens"));
  setVC("tl_fl_nu", fmtExp(F.nu, 3), "m²/s");
  setVC("tl_fl_mu", fmt(F.mu * 1000, 4), "mPa·s");
  setVC("tl_fl_K", U.fmt("gpa", F.K / 1e9), U.label("gpa"));
  setVC("tl_fl_c", U.fmt("speed", F.c), U.label("speed"));
  setVC("tl_fl_Pv", U.fmt("kpa", F.Pv / 1000), U.label("kpa"));
  $("tl-fl-warn").innerHTML = F.warnings.map(w => `<li>${escHtml(w)}</li>`).join("");
  $("tl-fl-preset-tag").textContent = `evaluated at ${U.fmt("temp", F.T)} ${U.label("temp")}`;
  const rows = ["fresh", "sea", "brine"].map(k => {
    const p = FL.compute({ preset: k, T_C: F.T, S_gkg: FL.PRESETS[k].S });
    return { name: FL.PRESETS[k].label, S: FL.PRESETS[k].S, p, hl: F.preset === k && F.S === FL.PRESETS[k].S };
  });
  if (F.preset === "custom" || !rows.some(r => r.hl)) rows.push({ name: F.preset === "custom" ? "Custom (entered)" : `${F.label} (S modified)`, S: F.S, p: F, hl: true });
  $("tl-fl-table").innerHTML =
    `<thead><tr><th>Fluid</th><th>S (g/kg)</th><th>ρ (${U.label("dens")})</th><th>ν (cSt)</th><th>μ (mPa·s)</th><th>c (${U.label("speed")})</th><th>K (${U.label("gpa")})</th><th>Pv (${U.label("kpa")})</th></tr></thead><tbody>` +
    rows.map(r => `<tr${r.hl ? ' class="hl"' : ""}><td>${escHtml(r.name)}</td><td>${r.S == null ? "—" : r.S}</td>` +
      `<td>${U.fmt("dens", r.p.rho)}</td><td>${fmt(r.p.nu * 1e6, 4)}</td><td>${fmt(r.p.mu * 1000, 4)}</td>` +
      `<td>${U.fmt("speed", r.p.c)}</td><td>${U.fmt("gpa", r.p.K / 1e9)}</td><td>${U.fmt("kpa", r.p.Pv / 1000)}</td></tr>`).join("") + "</tbody>";
  renderSteps("tl-fl-steps", F.steps);
}

function refresh() {
  if (!ROOT) return;
  const F = RO.fluid.props();
  META.textContent = F.error ? F.error : `ρ = ${U.fmt("dens", F.rho)} ${U.label("dens")} · ν = ${fmtExp(F.nu, 2)} m²/s · ${F.short}${F.S != null ? " " + F.S + " g/kg" : ""} @ ${U.fmt("temp", F.T)} ${U.label("temp")}`;
  velocity();
  fluidView();
}

function setTab(t, fromRoute) {
  tab = t === "fluid" ? "fluid" : "velocity";
  ROOT.setAttribute("data-tab", tab);
  TABS.querySelectorAll("button.tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  if (!fromRoute && RO.app.isActive("tools")) history.replaceState(null, "", "#/tools/" + tab);
  RO.app.refresh();
}

RO.registerModule({
  id: "tools",
  title: "Tools",
  pageTitle: () => (tab === "fluid" ? "Fluid properties" : "Line velocity"),
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta; TABS = ctx.tabs;
    ROOT.innerHTML = MARKUP;
    TABS.innerHTML = `<button class="tab" data-tab="velocity">Line velocity</button><button class="tab" data-tab="fluid">Fluid properties</button>`;
    TABS.querySelectorAll("button.tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    ROOT.querySelectorAll(".tl-velocity-view input[data-q]").forEach(el => el.addEventListener("input", () => { readInput(el); velocity(); }));
    ROOT.querySelectorAll(".tl-velocity-view select").forEach(el => el.addEventListener("change", velocity));
    RO.fluidui.bind("tl", refresh);
    RO.units.subscribe(() => { U.applyLabels(ROOT); writeInputs(); refresh(); });
    RO.util.bindCollapsibles(ROOT);
    writeInputs();
    setTab("velocity", true);
    refresh();
  },
  onShow: refresh,
  onRoute(sub) { if (sub) setTab(sub, true); },
  reset() { Object.assign(TL, { Q: 1500, V: 1.5, D: 500, eps: 0.0015 }); writeInputs(); RO.fluid.reset(); refresh(); }
});
})(window.RO = window.RO || {});
