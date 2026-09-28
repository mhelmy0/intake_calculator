/* ============================================================
   Module: Libraries — fittings lists, pump library, recommended values, users.
   (PRD §5.4–5.5, §7.1, §9.1)
   ============================================================ */
(function (RO) {
"use strict";

const { $, fmt, escHtml: esc } = RO.util;
const api = RO.api;
let ROOT = null, META = null, TABS = null, tab = "fittings";
let selectedVersion = null;

const TAB_DEFS = [
  { id: "fittings", label: "Fittings" },
  { id: "pumps", label: "Pumps" },
  { id: "equipment", label: "Equipment" },
  { id: "values", label: "Recommended values" },
  { id: "users", label: "Users & roles", role: "admin" }
];

const MARKUP = `
  <section class="right-panel lib-panel">
    <div class="view lib-fittings-view">
      <div class="card">
        <h2>Fittings Lists <span class="h2-tag" id="lib-fit-active"></span></h2>
        <div class="card-body">
          <div class="toolbar-row">
            <button class="btn primary" id="lib-fit-import">Import CSV…</button>
            <a class="btn" href="assets/data/fittings/fittings_import_template.csv" download>⬇ CSV template</a>
            <a class="btn" href="assets/data/fittings/fittings_recommended_v1.csv" download>⬇ Recommended list (CSV)</a>
            <span class="spacer"></span>
            <span class="hint" id="lib-fit-hint"></span>
          </div>
          <div class="table-wrap"><table class="data-table" id="lib-fit-versions"></table></div>
        </div>
      </div>
      <div class="card">
        <h2>List Items <span class="h2-tag" id="lib-fit-items-tag"></span></h2>
        <div class="card-body table-wrap"><table class="data-table" id="lib-fit-items"></table></div>
      </div>
    </div>

    <div class="view lib-pumps-view">
      <div class="card">
        <h2>Pump Library <span class="h2-tag">curves entered from vendor datasheets</span></h2>
        <div class="card-body">
          <div class="toolbar-row">
            <button class="btn primary" id="lib-pump-new">+ New pump</button>
            <span class="spacer"></span>
            <span class="hint" id="lib-pump-hint"></span>
          </div>
          <div class="table-wrap"><table class="data-table" id="lib-pumps"></table></div>
        </div>
      </div>
    </div>

    <div class="view lib-equipment-view">
      <div class="card">
        <h2>Equipment List <span class="h2-tag">pretreatment — vendor / consultant data (MMF vessels, bag filters, cartridges)</span></h2>
        <div class="card-body">
          <div class="toolbar-row">
            <select id="lib-eq-cat" class="grow" style="max-width:260px"></select>
            <button class="btn primary" id="lib-eq-new">+ New entry</button>
            <button class="btn" id="lib-eq-import">Import CSV…</button>
            <button class="btn" id="lib-eq-template">⬇ CSV template</button>
            <span class="spacer"></span>
            <span class="hint" id="lib-eq-hint"></span>
          </div>
          <div class="table-wrap"><table class="data-table" id="lib-eq"></table></div>
        </div>
      </div>
    </div>

    <div class="view lib-values-view">
      <div class="card">
        <h2>Recommended Values <span class="h2-tag">defaults every calculator starts from — users can override per calculation · stored and edited in SI</span></h2>
        <div class="card-body table-wrap"><table class="data-table" id="lib-values"></table></div>
      </div>
    </div>

    <div class="view lib-users-view">
      <div class="card">
        <h2>Users <span class="h2-tag">accounts are created by the administrator only</span></h2>
        <div class="card-body">
          <div class="toolbar-row"><button class="btn primary" id="lib-user-new">+ New user</button></div>
          <div class="table-wrap"><table class="data-table" id="lib-users"></table></div>
        </div>
      </div>
    </div>
  </section>`;

const tag = (cls, text) => `<span class="tag ${cls}">${esc(text)}</span>`;
const btn = (act, label, extra = "") => `<button type="button" class="icon-btn" data-act="${act}" ${extra}>${label}</button>`;

/* ================= FITTINGS ================= */
async function renderFittings() {
  const act = RO.fittings.active();
  $("lib-fit-active").textContent = act ? `in use: ${act.name} v${act.version} (${act.origin})` : "";
  $("lib-fit-hint").textContent = !api.state.online ? "Offline: bundled list only; imports are session-only."
    : api.can("engineer") ? "Imports are saved as drafts; approvers approve and choose the recommended list."
    : "Guests / viewers can validate a CSV and use it for this session (not saved).";
  const tbl = $("lib-fit-versions");
  if (!api.state.online) {
    tbl.innerHTML = `<tbody><tr><td>${esc(act.name)} v${act.version} — ${act.items.length} items (${act.origin})</td></tr></tbody>`;
    renderItems(act.items, `${act.name} v${act.version}`);
    return;
  }
  let versions = [];
  try { versions = (await api.get("/fittings/lists")).versions; } catch (e) { RO.ui.apiError(e); }
  const me = api.state.user;
  tbl.innerHTML = "<thead><tr><th>List</th><th>Ver.</th><th>Status</th><th>Items</th><th>Source</th><th>Created by</th><th>Actions</th></tr></thead><tbody>" +
    versions.map(v => {
      const acts = [btn("view", "View"), `<a class="icon-btn" href="${api.url("/fittings/versions/" + v.id + "/csv")}">CSV</a>`, btn("use", "Use now")];
      if (api.can("approver") && v.status === "draft") acts.push(btn("approve", "Approve"));
      if (api.can("approver") && v.status === "approved" && !v.is_recommended) acts.push(btn("recommend", "Make recommended"));
      if (api.can("approver") && v.status === "approved" && !v.is_recommended) acts.push(btn("retire", "Retire"));
      if (v.status === "draft" && me && (api.can("approver") || v.created_by_name === me.username)) acts.push(`<button type="button" class="icon-btn del" data-act="delete">Delete</button>`);
      return `<tr data-id="${v.id}" data-list="${v.list_id}"${selectedVersion === v.id ? ' class="hl"' : ""}>
        <td>${esc(v.list_name)} ${v.is_recommended ? tag("rec", "recommended") : ""}</td><td>${v.version}</td>
        <td>${tag(v.status, v.status)}</td><td>${v.item_count}</td><td>${esc(v.source || "")}</td>
        <td>${esc(v.created_by_name || "system")}</td><td>${acts.join(" ")}</td></tr>`;
    }).join("") + "</tbody>";
  tbl.onclick = async e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const tr = b.closest("tr"), id = +tr.dataset.id, a = b.dataset.act;
    try {
      if (a === "view") { selectedVersion = id; const j = await api.get("/fittings/versions/" + id); renderItems(j.items, `${j.version.list_name} v${j.version.version}`); renderFittings(); }
      if (a === "use") { const l = await RO.fittings.loadVersion(id); RO.ui.toast(`Calculations now use ${l.name} v${l.version} (this browser session)`, "ok"); renderFittings(); }
      if (a === "approve" || a === "recommend" || a === "retire") {
        if (!(await RO.ui.confirm("Confirm", `${a[0].toUpperCase() + a.slice(1)} this list version?`, a))) return;
        await api.post(`/fittings/versions/${id}/${a}`);
        if (a === "recommend") await RO.fittings.loadRecommended();
        RO.ui.toast(`List version ${a}d`, "ok"); renderFittings();
      }
      if (a === "delete") {
        if (!(await RO.ui.confirm("Delete draft", "Delete this draft list version?", "Delete", true))) return;
        await api.del("/fittings/versions/" + id); RO.ui.toast("Draft deleted"); renderFittings();
      }
    } catch (err) { RO.ui.apiError(err); }
  };
  if (!selectedVersion) renderItems(act.items, `${act.name} v${act.version} (in use)`);
}

function renderItems(items, label) {
  $("lib-fit-items-tag").textContent = label + ` · ${items.length} items · K shown at OD 500 (f_T = ${fmt(RO.fittings.fT(0.4406), 4)})`;
  const D = 0.4406;
  $("lib-fit-items").innerHTML = "<thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Basis</th><th>n / K / Kv</th><th>K @ OD500</th><th>Velocity</th><th>DN range</th><th>BOM</th><th>Connection</th><th>Status</th><th>Source</th></tr></thead><tbody>" +
    items.map(it => {
      const k = RO.fittings.kOf(it, D, 1e6);
      const val = it.basis === "n" ? `n = ${it.n_ld}` : it.basis === "K" ? `K = ${it.k}` : it.basis === "kv" ? `Kv = ${it.kv ?? "per project"}` : it.basis === "3k" ? `${it.k1} / ${it.ki} / ${it.kd}` : "formula";
      return `<tr><td>${esc(it.code)}</td><td>${esc(it.name)}</td><td>${esc(it.category)}</td><td>${esc(it.basis)}</td><td>${esc(val)}</td>
        <td>${k.K === null ? "auto" : fmt(k.K, 3)}</td><td>${esc(it.velocity_ref)}</td>
        <td>${it.dn_min_mm != null || it.dn_max_mm != null ? `${it.dn_min_mm != null ? RO.units.fmt("dia", it.dn_min_mm, 0) : ""}–${it.dn_max_mm != null ? RO.units.fmt("dia", it.dn_max_mm, 0) : ""} ${RO.units.label("dia")}` : "all"}</td>
        <td>${it.bom ? "yes" : "no"}</td><td>${esc(it.connection)}</td><td>${tag(it.status, it.status)}</td><td>${esc(it.source || "")}</td></tr>`;
    }).join("") + "</tbody>";
}

function importDialog() {
  let lists = [];
  const canSave = api.state.online && api.can("engineer");
  const m = RO.ui.modal({
    title: "Import fittings list (CSV)",
    wide: true,
    body: `
      <div class="form-grid">
        <div class="input-row"><label>CSV file (UTF-8, format of the template)</label><input type="file" id="imp-file" accept=".csv,text/csv"></div>
        ${canSave ? `
        <div class="input-pair">
          <div class="input-row"><label>Import as</label><select id="imp-mode"><option value="new">New list</option><option value="version">New version of an existing list</option></select></div>
          <div class="input-row" id="imp-list-row" hidden><label>List</label><select id="imp-list"></select></div>
        </div>
        <div class="input-pair">
          <div class="input-row" id="imp-name-row"><label>List name</label><input id="imp-name" maxlength="120"></div>
          <div class="input-row"><label>Source (document / consultant)</label><input id="imp-source" maxlength="200"></div>
        </div>
        <div class="input-row"><label>Notes</label><input id="imp-notes" maxlength="1000"></div>` :
        `<p class="hint">You are ${api.state.online ? "not logged in with an engineer account" : "offline"}: the list can be validated and used for this browser session only — it is not saved.</p>`}
        <div id="imp-report"></div>
      </div>`,
    actions: [
      { label: "Cancel" },
      { label: "Validate", onClick: () => run(true) },
      { label: "Use for this session", onClick: c => useSession(c) },
      ...(canSave ? [{ label: "Save as draft", primary: true, onClick: c => run(false, c) }] : [])
    ],
    onOpen: async root => {
      if (!canSave) return;
      try {
        const v = (await api.get("/fittings/lists")).versions;
        const seen = new Set();
        lists = v.filter(x => !seen.has(x.list_id) && seen.add(x.list_id));
        root.querySelector("#imp-list").innerHTML = lists.map(l => `<option value="${l.list_id}">${esc(l.list_name)} (latest v${l.version})</option>`).join("");
      } catch (e) { RO.ui.apiError(e); }
      root.querySelector("#imp-mode").addEventListener("change", e => {
        root.querySelector("#imp-list-row").hidden = e.target.value !== "version";
        root.querySelector("#imp-name-row").hidden = e.target.value === "version";
      });
    }
  });
  const R = m.root;
  const readFile = async () => {
    const f = R.querySelector("#imp-file").files[0];
    if (!f) { RO.ui.toast("Choose a CSV file first", "warn"); return null; }
    return { name: f.name, text: await f.text() };
  };
  async function run(validateOnly, close) {
    const file = await readFile();
    if (!file) return;
    const body = { csv: file.text, filename: file.name, validate_only: validateOnly };
    if (canSave) {
      body.mode = R.querySelector("#imp-mode").value;
      body.list_id = +R.querySelector("#imp-list").value || null;
      body.name = R.querySelector("#imp-name").value.trim();
      body.source = R.querySelector("#imp-source").value.trim();
      body.notes = R.querySelector("#imp-notes").value.trim();
      if (!validateOnly && body.mode === "new" && !body.name) { RO.ui.toast("Enter a list name", "warn"); return; }
    }
    if (!api.state.online) { report(localValidate(file.text)); return; }
    try {
      const j = await api.post("/fittings/import", body);
      report(j);
      if (j.saved) { close(); RO.ui.toast(`Saved as draft v${j.version} — an approver must approve it`, "ok"); renderFittings(); }
    } catch (e) {
      if (e.data && e.data.errors) report(e.data); else RO.ui.apiError(e);
    }
  }
  async function useSession(close) {
    const file = await readFile();
    if (!file) return;
    let rep = api.state.online ? null : localValidate(file.text);
    if (api.state.online) {
      try { rep = await api.post("/fittings/import", { csv: file.text, validate_only: true }); } catch (e) { RO.ui.apiError(e); return; }
    }
    report(rep);
    if (rep.errors.length) { RO.ui.toast("Fix the errors first", "warn"); return; }
    RO.fittings.loadSessionCsv(file.name.replace(/\.csv$/i, ""), file.text);
    close();
    RO.ui.toast("List loaded for this browser session", "ok");
    renderFittings();
  }
  function report(j) {
    const rows = (list, cls) => list.map(x => `<li class="${cls}">Row ${x.row}${x.column ? " · " + esc(x.column) : ""}: ${esc(x.message)}</li>`).join("");
    const d = j.diff;
    R.querySelector("#imp-report").innerHTML =
      `<p><strong>${j.items.length}</strong> valid rows · <strong>${j.errors.length}</strong> errors · <strong>${j.warnings.length}</strong> warnings</p>` +
      (d ? `<p class="hint">Compared with the latest version: ${d.added.length} added (${esc(d.added.join(", "))}) · ${d.removed.length} removed (${esc(d.removed.join(", "))}) · ${d.changed.length} changed (${esc(d.changed.map(c => c.code + ": " + c.fields.join("/")).join("; "))})</p>` : "") +
      `<ul class="warn-list">${rows(j.errors, "err")}${rows(j.warnings.slice(0, 40), "")}</ul>`;
  }
}

/** Offline validation — structure only (the server validator is authoritative). */
function localValidate(text) {
  const rows = RO.csv.parseObjects(text);
  const errors = [], seen = {};
  rows.forEach((r, i) => {
    const line = i + 2;
    ["code", "name", "category", "basis"].forEach(c => { if (!r[c]) errors.push({ row: line, column: c, message: "Required" }); });
    if (r.code && seen[r.code.toUpperCase()]) errors.push({ row: line, column: "code", message: "Duplicate code" });
    seen[(r.code || "").toUpperCase()] = true;
    if (r.basis === "n" && !(+r.n_LD > 0)) errors.push({ row: line, column: "n_LD", message: "Required for basis n" });
    if (r.basis === "K" && !(r.K !== "" && +r.K >= 0)) errors.push({ row: line, column: "K", message: "Required for basis K" });
  });
  return { items: rows, errors, warnings: [], diff: null };
}

/* ================= PUMPS ================= */
async function renderPumps() {
  const canSave = api.state.online && api.can("engineer");
  $("lib-pump-hint").textContent = canSave ? "New pumps are drafts until an approver approves them." :
    "Guest / offline: pumps you add are kept for this browser session only (export your calculation to keep them).";
  const list = await RO.pumplib.list();
  const me = api.state.user;
  const U = RO.units;
  $("lib-pumps").innerHTML = `<thead><tr><th>Vendor</th><th>Model</th><th>Type</th><th>Speed (rpm)</th><th>Motor (${U.label("power")})</th><th>BEP (${U.label("flow")})</th><th>Points</th><th>Status</th><th>Owner</th><th>Actions</th></tr></thead><tbody>` +
    (list.length ? list.map(p => {
      const own = p.origin === "session" || (me && p.owner_id === me.id);
      const acts = [btn("open", own && (p.status === "draft" || p.status === "session") || api.can("approver") ? "Edit" : "View"), btn("dup", "Duplicate")];
      if (p.origin === "server" && api.can("approver") && p.status === "draft") acts.push(btn("approve", "Approve"));
      if (p.origin === "server" && api.can("approver") && p.status === "approved") acts.push(btn("retire", "Retire"));
      if ((p.origin === "session") || (p.status === "draft" && own) || api.can("admin")) acts.push(`<button type="button" class="icon-btn del" data-act="delete">Delete</button>`);
      return `<tr data-id="${p.id}"><td>${esc(p.vendor)}</td><td>${esc(p.model)}</td><td>${esc(p.pump_type)}</td><td>${p.speed_rpm ?? ""}</td>
        <td>${p.motor_kw != null ? U.fmt("power", p.motor_kw) : ""}</td><td>${p.bep_flow_m3h != null ? U.fmt("flow", p.bep_flow_m3h) : ""}</td><td>${p.point_count}</td><td>${tag(p.status, p.status)}</td>
        <td>${esc(p.owner_name || (p.origin === "session" ? "this session" : ""))}</td><td>${acts.join(" ")}</td></tr>`;
    }).join("") : `<tr><td colspan="10" class="hint">No pumps yet — add one from a vendor datasheet.</td></tr>`) + "</tbody>";
  $("lib-pumps").onclick = async e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest("tr").dataset.id, a = b.dataset.act;
    try {
      if (a === "open" || a === "dup") {
        const p = await RO.pumplib.get(id);
        if (a === "dup") { delete p.id; p.model += " (copy)"; p.status = "draft"; p.origin = null; }
        pumpEditor(p, renderPumps);
      }
      if (a === "approve" || a === "retire") {
        if (!(await RO.ui.confirm("Confirm", `${a === "approve" ? "Approve" : "Retire"} this pump?`, a))) return;
        await api.post(`/pumps/${id}/${a}`); RO.pumplib.invalidate(); renderPumps();
      }
      if (a === "delete") {
        if (!(await RO.ui.confirm("Delete pump", "Delete this pump?", "Delete", true))) return;
        if (String(id).startsWith("s")) RO.pumplib.deleteSession(id); else { await api.del("/pumps/" + id); RO.pumplib.invalidate(); }
        renderPumps();
      }
    } catch (err) { RO.ui.apiError(err); }
  };
}

const PUMP_TYPES = ["submersible", "vertical_turbine", "end_suction", "split_case", "dewatering", "other"];

/** Pump editor dialog. Exposed as RO.pumpEditor for other modules. */
function pumpEditor(pump, onSaved) {
  const p = Object.assign({ vendor: "", model: "", pump_type: "submersible", stages: 1, points: [] }, pump || {});
  const me = api.state.user;
  const serverEditable = api.state.online && api.can("engineer") &&
    (!p.id || p.origin !== "server" || api.can("approver") || (p.owner_id === (me && me.id) && p.status === "draft"));
  const toServer = api.state.online && api.can("engineer") && p.origin !== "session";
  const readOnly = p.origin === "server" && !serverEditable;
  const U = RO.units;
  const QOF = { imp: "dia", motor: "power", bep: "flow", minq: "flow" };      // unit-aware fields (stored SI)
  const f = (id, label, val, type = "number", extra = "") => {
    const disp = QOF[id] ? U.inputValue(QOF[id], val) : (val ?? "");
    return `<div class="input-row"><label for="pe-${id}">${label}</label><input id="pe-${id}" type="${QOF[id] ? "text" : type}" ${QOF[id] ? 'inputmode="decimal"' : ""} value="${disp}" ${extra} ${readOnly ? "disabled" : ""}></div>`;
  };
  const PQ = { q_m3h: "flow", h_m: "head", eff_pct: "pct", npshr_m: "head", power_kw: "power" };
  const m = RO.ui.modal({
    title: (p.id ? (readOnly ? "Pump" : "Edit pump") : "New pump") + (p.status ? ` — ${p.status}` : ""),
    wide: true,
    body: `
      <div class="pe-grid">
        <div>
          <div class="input-pair">${f("vendor", "Vendor", esc(p.vendor), "text", 'maxlength="80"')}${f("model", "Model", esc(p.model), "text", 'maxlength="120"')}</div>
          <div class="input-pair">
            <div class="input-row"><label for="pe-type">Type</label><select id="pe-type" ${readOnly ? "disabled" : ""}>${PUMP_TYPES.map(t => `<option ${t === p.pump_type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
            ${f("speed", "Speed (rpm)", p.speed_rpm)}
          </div>
          <div class="input-pair">${f("imp", `Impeller Ø (${U.label("dia")})`, p.impeller_mm)}${f("stages", "Stages", p.stages)}</div>
          <div class="input-pair">${f("motor", `Motor rating (${U.label("power")})`, p.motor_kw)}${f("volt", "Voltage (V)", p.voltage_v)}</div>
          <div class="input-pair">${f("freq", "Frequency (Hz)", p.frequency_hz)}${f("bep", `BEP flow (${U.label("flow")}, blank = from η curve)`, p.bep_flow_m3h)}</div>
          <div class="input-pair">${f("minq", `Min continuous flow (${U.label("flow")})`, p.min_flow_m3h)}${f("ds", "Datasheet reference", esc(p.datasheet_ref || ""), "text")}</div>
          ${f("mat", "Materials", esc(p.materials || ""), "text")}
          ${f("notes", "Notes", esc(p.notes || ""), "text")}
        </div>
        <div>
          <div class="toolbar-row"><strong>Curve points</strong><span class="spacer"></span>
            ${readOnly ? "" : `<button type="button" class="btn-small" id="pe-add">+ Row</button><button type="button" class="btn-small" id="pe-paste">Paste from Excel</button>`}</div>
          <table class="edit-table" id="pe-points"><thead><tr><th>Q (${U.label("flow")})</th><th>H (${U.label("head")})</th><th>η (%)</th><th>NPSHr (${U.label("head")})</th><th>P (${U.label("power")})</th><th></th></tr></thead><tbody></tbody></table>
          <div class="pe-chart"><canvas id="pe-canvas"></canvas></div>
          <ul class="warn-list" id="pe-warn"></ul>
        </div>
      </div>
      ${toServer || readOnly ? "" : `<p class="hint">This pump will be kept for this browser session only (${api.state.online ? "log in as an engineer to save it to the library" : "offline"}).</p>`}`,
    actions: readOnly ? [{ label: "Close" }] : [{ label: "Cancel" }, { label: toServer ? "Save" : "Save for session", primary: true, onClick: save }],
    onOpen: root => {
      const tb = root.querySelector("#pe-points tbody");
      const cols = ["q_m3h", "h_m", "eff_pct", "npshr_m", "power_kw"];
      const addRow = (pt = {}) => {
        const tr = document.createElement("tr");
        tr.innerHTML = cols.map(c => `<td><input type="text" inputmode="decimal" data-c="${c}" value="${U.inputValue(PQ[c], pt[c])}" ${readOnly ? "disabled" : ""}></td>`).join("") +
          `<td>${readOnly ? "" : '<button type="button" class="icon-btn del" title="Remove row">✕</button>'}</td>`;
        tb.appendChild(tr);
      };
      (p.points.length ? p.points : [{}, {}, {}, {}, {}]).forEach(addRow);
      root.addEventListener("input", preview);
      tb.addEventListener("click", e => { if (e.target.closest(".del")) { e.target.closest("tr").remove(); preview(); } });
      if (!readOnly) {
        root.querySelector("#pe-add").addEventListener("click", () => addRow());
        root.querySelector("#pe-paste").addEventListener("click", () => {
          RO.ui.modal({
            title: "Paste curve points",
            body: `<p class="hint">Copy the columns Q, H [, η, NPSHr, P] from Excel in ${U.isImperial() ? "Imperial" : "SI"} units (${U.label("flow")}, ${U.label("head")}, %, ${U.label("head")}, ${U.label("power")}); tab, semicolon or comma separated. A header row is ignored.</p><textarea id="pe-ta" rows="10" style="width:100%"></textarea>`,
            actions: [{ label: "Cancel" }, { label: "Replace points", primary: true, onClick: (c, r) => {
              const lines = r.querySelector("#pe-ta").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
              const pts = lines.map(l => l.split(/\t|;|,(?=\s*-?\d)/).map(x => x.trim().replace(",", "."))).filter(a => a.length >= 2 && isFinite(+a[0]) && isFinite(+a[1]))
                .map(a => { const o = {}; cols.forEach((col, i) => { if (a[i] !== undefined && a[i] !== "") o[col] = U.toSI(PQ[col], +a[i]); }); return o; });
              if (pts.length < 3) { RO.ui.toast("Need at least 3 numeric rows", "warn"); return; }
              tb.innerHTML = ""; pts.forEach(addRow); c(); preview();
            } }]
          });
        });
      }
      setTimeout(preview, 30);
    }
  });
  const R = m.root;
  function collect() {
    const v = id => { const el = R.querySelector("#pe-" + id); return el ? el.value.trim() : ""; };
    const n = id => (v(id) === "" ? null : (QOF[id] ? U.parse(QOF[id], v(id)) : +v(id)));
    const points = [...R.querySelectorAll("#pe-points tbody tr")].map(tr => {
      const o = {};
      tr.querySelectorAll("input").forEach(i => { o[i.dataset.c] = i.value.trim() === "" ? null : U.parse(PQ[i.dataset.c], i.value); });
      return o;
    }).filter(pt => pt.q_m3h !== null && pt.h_m !== null);
    return Object.assign({}, p, {
      vendor: v("vendor"), model: v("model"), pump_type: R.querySelector("#pe-type").value,
      speed_rpm: n("speed"), impeller_mm: n("imp"), stages: n("stages") || 1, motor_kw: n("motor"), voltage_v: n("volt"),
      frequency_hz: n("freq"), bep_flow_m3h: n("bep"), min_flow_m3h: n("minq"), datasheet_ref: v("ds"), materials: v("mat"), notes: v("notes"), points
    });
  }
  function preview() {
    const rec = collect();
    const fitRes = rec.points.length >= 3 ? RO.pumpcurve.fit(rec) : { error: "Enter at least 3 points (Q, H)" };
    drawPumpPreview(R.querySelector("#pe-canvas"), rec, fitRes);
    const w = fitRes.error ? [fitRes.error] : fitRes.warnings.concat(fitRes.bep ? [`BEP ${U.fmt("flow", fitRes.bep)} ${U.label("flow")} (${fitRes.bepSource})`] : ["No η points — BEP unknown (POR check skipped)"]);
    R.querySelector("#pe-warn").innerHTML = w.map(x => `<li>${esc(x)}</li>`).join("");
  }
  async function save(close) {
    const rec = collect();
    if (!rec.vendor || !rec.model) { RO.ui.toast("Vendor and model are required", "warn"); return; }
    if (rec.points.length < 3) { RO.ui.toast("At least 3 curve points are required", "warn"); return; }
    try {
      if (toServer) {
        const body = Object.assign({}, rec); delete body.origin;
        const j = p.id && p.origin === "server" ? await api.put("/pumps/" + p.id, body) : await api.post("/pumps", body);
        RO.pumplib.invalidate();
        RO.ui.toast(`Pump saved (${j.pump.status})`, "ok");
      } else {
        RO.pumplib.saveSession(Object.assign(rec, { origin: undefined, status: undefined }));
        RO.ui.toast("Pump kept for this session", "ok");
      }
      close();
      if (onSaved) onSaved();
    } catch (e) { RO.ui.apiError(e); }
  }
}

function drawPumpPreview(canvas, rec, pf) {
  const { ctx, w, h } = RO.util.fitCanvas(canvas);
  RO.util.clearBg(ctx, w, h);
  if (!rec.points.length) return;
  const pad = { l: 44, r: 40, t: 12, b: 26 };
  const Qm = Math.max(...rec.points.map(p => p.q_m3h)) * 1.05 || 1;
  const Hm = Math.max(...rec.points.map(p => p.h_m)) * 1.1 || 1;
  const x = q => pad.l + q / Qm * (w - pad.l - pad.r), y = v => h - pad.b - v / Hm * (h - pad.t - pad.b);
  const ye = e => h - pad.b - e / 100 * (h - pad.t - pad.b);
  ctx.strokeStyle = "#b7b7ba"; ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b); ctx.stroke();
  ctx.fillStyle = "#5d5d60"; ctx.font = "10px ui-monospace, monospace";
  for (let i = 0; i <= 4; i++) {
    ctx.textAlign = "right"; ctx.fillText(RO.units.toDisp("head", Hm * i / 4).toFixed(0), pad.l - 4, y(Hm * i / 4) + 3);
    ctx.textAlign = "left"; ctx.fillText((25 * i) + "%", w - pad.r + 4, ye(25 * i) + 3);
    ctx.textAlign = "center"; ctx.fillText(RO.units.toDisp("flow", Qm * i / 4).toFixed(0), x(Qm * i / 4), h - pad.b + 12);
  }
  if (!pf.error) {
    const line = (fn, color, yf) => { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i <= 60; i++) { const q = pf.Qmax * i / 60, v = fn(q); if (v === null) return; i ? ctx.lineTo(x(q), yf(v)) : ctx.moveTo(x(q), yf(v)); } ctx.stroke(); };
    line(pf.head, "#5980a6", y);
    if (pf.eta) line(pf.eff, "#486077", ye);
    if (pf.npshr) line(pf.npsh, "#98989b", y);
  }
  rec.points.forEach(p => {
    ctx.fillStyle = "#2c455d"; ctx.beginPath(); ctx.arc(x(p.q_m3h), y(p.h_m), 3.5, 0, 7); ctx.fill();
    if (p.eff_pct != null) { ctx.fillStyle = "#486077"; ctx.beginPath(); ctx.arc(x(p.q_m3h), ye(p.eff_pct), 3, 0, 7); ctx.fill(); }
  });
  ctx.fillStyle = "#5d5d60"; ctx.textAlign = "left"; ctx.fillText("H (accent) · η (dark, right axis) · NPSHr (grey)", pad.l + 4, pad.t + 10);
}

/* ================= VALUES ================= */
function renderValues() {
  const all = RO.values.all();
  const edit = api.state.online && api.can("approver");
  $("lib-values").innerHTML = "<thead><tr><th>Key</th><th>Description</th><th>Value</th><th>Unit</th><th>Source</th>" + (edit ? "<th></th>" : "") + "</tr></thead><tbody>" +
    Object.keys(all).sort().map(k => {
      const v = all[k];
      return `<tr data-k="${esc(k)}"><td>${esc(k)}</td><td>${esc(v.label)}</td>
        <td>${edit ? `<input type="number" step="any" class="val-in" value="${v.value}">` : fmt(v.value, 3)}</td><td>${esc(v.unit || "")}</td>
        <td>${edit ? `<input class="src-in" value="${esc(v.source || "")}">` : esc(v.source || "")}</td>
        ${edit ? `<td>${btn("save", "Save")}</td>` : ""}</tr>`;
    }).join("") + "</tbody>";
  $("lib-values").onclick = async e => {
    const b = e.target.closest("[data-act=save]");
    if (!b) return;
    const tr = b.closest("tr");
    try {
      await api.put("/values/" + tr.dataset.k, { value: +tr.querySelector(".val-in").value, source: tr.querySelector(".src-in").value });
      await RO.values.load();
      RO.ui.toast("Recommended value updated", "ok");
    } catch (err) { RO.ui.apiError(err); }
  };
}

/* ================= USERS ================= */
const genPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56]).join("") + "-7";
async function renderUsers() {
  if (!api.can("admin")) { $("lib-users").innerHTML = ""; return; }
  let users = [];
  try { users = (await api.get("/users")).users; } catch (e) { RO.ui.apiError(e); return; }
  const roles = ["viewer", "engineer", "approver", "admin"];
  $("lib-users").innerHTML = "<thead><tr><th>Username</th><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last login</th><th></th></tr></thead><tbody>" +
    users.map(u => `<tr data-id="${u.id}"><td>${esc(u.username)}${u.must_change_password ? " " + tag("draft", "must change pw") : ""}</td>
      <td>${esc(u.display_name)}</td><td>${esc(u.email || "")}</td>
      <td><select class="role-sel">${roles.map(r => `<option ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}</select></td>
      <td><input type="checkbox" class="act-chk" ${u.is_active ? "checked" : ""}></td>
      <td>${u.last_login_at ? esc(u.last_login_at.slice(0, 16).replace("T", " ")) : "never"}</td>
      <td>${btn("pw", "Reset password")}</td></tr>`).join("") + "</tbody>";
  const tbl = $("lib-users");
  tbl.onchange = async e => {
    const tr = e.target.closest("tr");
    const body = e.target.classList.contains("role-sel") ? { role: e.target.value } : { is_active: e.target.checked };
    try { await api.patch("/users/" + tr.dataset.id, body); RO.ui.toast("User updated", "ok"); }
    catch (err) { RO.ui.apiError(err); renderUsers(); }
  };
  tbl.onclick = e => {
    if (!e.target.closest("[data-act=pw]")) return;
    const id = e.target.closest("tr").dataset.id, pw = genPassword();
    RO.ui.modal({
      title: "Reset password",
      body: `<div class="input-row"><label>New one-time password (the user must change it at next login)</label><input id="rp-pw" value="${pw}"></div>`,
      actions: [{ label: "Cancel" }, { label: "Set password", primary: true, onClick: async (c, r) => {
        try { await api.patch("/users/" + id, { password: r.querySelector("#rp-pw").value }); c(); RO.ui.toast("Password reset — give it to the user securely", "ok"); renderUsers(); }
        catch (err) { RO.ui.apiError(err); }
      } }]
    });
  };
}
function newUserDialog() {
  RO.ui.modal({
    title: "New user",
    body: `<div class="form-grid">
      <div class="input-row"><label>Username (3–60: letters, digits, . _ -)</label><input id="nu-user"></div>
      <div class="input-row"><label>Display name</label><input id="nu-name"></div>
      <div class="input-row"><label>Email</label><input id="nu-mail" type="email"></div>
      <div class="input-row"><label>Role</label><select id="nu-role"><option>viewer</option><option selected>engineer</option><option>approver</option><option>admin</option></select></div>
      <div class="input-row"><label>One-time password (user must change it at first login)</label><input id="nu-pw" value="${genPassword()}"></div></div>`,
    actions: [{ label: "Cancel" }, { label: "Create", primary: true, onClick: async (c, r) => {
      const v = id => r.querySelector(id).value.trim();
      try {
        await api.post("/users", { username: v("#nu-user"), display_name: v("#nu-name"), email: v("#nu-mail"), role: v("#nu-role"), password: v("#nu-pw") });
        c(); RO.ui.toast("User created — give them the one-time password securely", "ok"); renderUsers();
      } catch (err) { RO.ui.apiError(err); }
    } }]
  });
}

/* ================= EQUIPMENT (Pretreatment PRD v0.2 §1A) ================= */
let eqCat = "mmf_vessel";
async function renderEquipment() {
  const EQ = RO.equiplib, U = RO.units;
  const sel = $("lib-eq-cat");
  sel.innerHTML = Object.entries(EQ.CATS).map(([k, c]) => `<option value="${k}"${k === eqCat ? " selected" : ""}>${esc(c.plural)}</option>`).join("");
  const canSave = api.state.online && api.can("engineer");
  $("lib-eq-hint").textContent = canSave ? "New entries are drafts until an approver approves them. Generic entries are placeholders — replace them with vendor data."
    : "Guest / offline: entries you add are kept for this browser session only.";
  const cat = EQ.CATS[eqCat], list = await EQ.list(eqCat), me = api.state.user;
  const head = cat.fields.map(([k, label, q]) => `<th>${esc(label.replace(/ \(.*\)$/, ""))}${q ? ` (${U.label(q)})` : ""}</th>`).join("");
  const val = (e, [k, , q, kind]) => { const v = (e.specs || {})[k]; return v === undefined || v === null ? "" : Array.isArray(kind) ? esc(v) : q ? U.fmt(q, v) : esc(v); };
  $("lib-eq").innerHTML = `<thead><tr><th>Vendor</th><th>Model</th>${head}<th>Status</th><th>Owner</th><th>Actions</th></tr></thead><tbody>` +
    (list.length ? list.map(e => {
      const own = e.origin === "session" || (me && e.owner_id === me.id);
      const acts = [];
      if (e.origin !== "generic") acts.push(btn("open", own && (e.status === "draft" || e.status === "session") || api.can("approver") ? "Edit" : "View"));
      acts.push(btn("dup", "Duplicate"));
      if (e.origin === "server" && api.can("approver") && e.status === "draft") acts.push(btn("approve", "Approve"));
      if (e.origin === "server" && api.can("approver") && e.status === "approved") acts.push(btn("retire", "Retire"));
      if (e.origin === "session" || (e.origin === "server" && ((e.status === "draft" && own) || api.can("admin")))) acts.push(`<button type="button" class="icon-btn del" data-act="delete">Delete</button>`);
      return `<tr data-id="${e.id}"><td>${esc(e.vendor)}</td><td>${esc(e.model)}</td>${cat.fields.map(f => `<td>${val(e, f)}</td>`).join("")}
        <td>${tag(e.status === "generic" ? "placeholder" : e.status, e.status)}</td><td>${esc(e.owner_name || (e.origin === "session" ? "this session" : e.origin === "generic" ? "bundled" : ""))}</td><td>${acts.join(" ")}</td></tr>`;
    }).join("") : `<tr><td colspan="${cat.fields.length + 5}" class="hint">No entries.</td></tr>`) + "</tbody>";
  $("lib-eq").onclick = async ev => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest("tr").dataset.id, a = b.dataset.act, e = EQ.find(id);
    try {
      if (a === "open") equipEditor(e);
      if (a === "dup") equipEditor(Object.assign({}, JSON.parse(JSON.stringify(e)), { id: undefined, origin: null, status: null, vendor: e.origin === "generic" ? "" : e.vendor, model: e.model + (e.origin === "generic" ? "" : " (copy)") }));
      if (a === "approve" || a === "retire") {
        if (!(await RO.ui.confirm("Confirm", `${a === "approve" ? "Approve" : "Retire"} this entry?`, a))) return;
        await api.post(`/equipment/${id}/${a}`); EQ.invalidate();
      }
      if (a === "delete") {
        if (!(await RO.ui.confirm("Delete entry", "Delete this entry?", "Delete", true))) return;
        if (String(id).startsWith("s")) EQ.deleteSession(id); else { await api.del("/equipment/" + id); EQ.invalidate(); }
      }
    } catch (err) { RO.ui.apiError(err); }
  };
}

/** Equipment editor dialog. Exposed as RO.equipEditor for the Pretreatment page. */
function equipEditor(entry, onSaved) {
  const EQ = RO.equiplib, U = RO.units;
  const e = Object.assign({ category: eqCat, vendor: "", model: "", specs: {}, datasheet_ref: "", notes: "" }, entry || {});
  const cat = EQ.CATS[e.category], me = api.state.user;
  const toServer = api.state.online && api.can("engineer") && e.origin !== "session";
  const readOnly = e.origin === "server" && !(api.can("approver") || (me && e.owner_id === me.id && e.status === "draft"));
  const dis = readOnly ? "disabled" : "";
  const field = ([k, label, q, kind, req]) => {
    const v = e.specs[k];
    const input = Array.isArray(kind)
      ? `<select id="eq-${k}" ${dis}>${req ? "" : '<option value="">—</option>'}${kind.map(o => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
      : `<input id="eq-${k}" type="text" inputmode="decimal" value="${v === undefined || v === null ? "" : q ? U.inputValue(q, v) : v}" ${dis}>`;
    return `<div class="input-row"><label for="eq-${k}">${esc(label)}${q ? ` (${U.label(q)})` : ""}${req ? " *" : ""}</label>${input}</div>`;
  };
  RO.ui.modal({
    title: `${readOnly ? "" : e.id ? "Edit" : "New"} ${cat.label.toLowerCase()}${e.status ? " — " + e.status : ""}`.trim(),
    body: `<div class="input-pair"><div class="input-row"><label for="eq-vendor">Vendor *</label><input id="eq-vendor" value="${esc(e.vendor)}" maxlength="80" ${dis}></div>
        <div class="input-row"><label for="eq-model">Model *</label><input id="eq-model" value="${esc(e.model)}" maxlength="120" ${dis}></div></div>
      ${cat.fields.map(field).join("")}
      <div class="input-row"><label for="eq-ds">Datasheet reference</label><input id="eq-ds" value="${esc(e.datasheet_ref || "")}" ${dis}></div>
      <div class="input-row"><label for="eq-notes">Notes</label><input id="eq-notes" value="${esc(e.notes || "")}" ${dis}></div>
      ${toServer || readOnly ? "" : `<p class="hint">Kept for this browser session only (${api.state.online ? "sign in as an engineer to save it to the library" : "offline"}).</p>`}`,
    actions: readOnly ? [{ label: "Close" }] : [{ label: "Cancel" }, { label: toServer ? "Save" : "Save for session", primary: true, onClick: async (close, root) => {
      const v = id => root.querySelector("#eq-" + id).value.trim();
      const rec = { category: e.category, vendor: v("vendor"), model: v("model"), datasheet_ref: v("ds"), notes: v("notes"), specs: {} };
      cat.fields.forEach(([k, , q, kind]) => { const x = v(k); if (x !== "") rec.specs[k] = Array.isArray(kind) ? x : (q ? U.parse(q, x) : +x); });
      const err = EQ.validate(rec);
      if (err) { RO.ui.toast(err, "warn"); return; }
      try {
        let saved;
        if (toServer) { const j = e.id && e.origin === "server" ? await api.put("/equipment/" + e.id, rec) : await api.post("/equipment", rec); saved = Object.assign(j.equipment, { origin: "server" }); RO.ui.toast(`Saved (${j.equipment.status})`, "ok"); EQ.invalidate(); }
        else { saved = EQ.saveSession(Object.assign(rec, { id: e.origin === "session" ? e.id : undefined })); RO.ui.toast("Kept for this session", "ok"); }
        close();
        if (onSaved) onSaved(saved);
      } catch (x) { RO.ui.apiError(x); }
    } }]
  });
}

function equipImport() {
  const EQ = RO.equiplib;
  const toServer = api.state.online && api.can("engineer");
  RO.ui.modal({
    title: "Import equipment (CSV)", wide: true,
    body: `<p class="hint">Columns: ${esc(EQ.CSV_HEAD.join(", "))}. Values in SI (m, m², mm, bar, m³/h, m/h). Download the template for examples. ${toServer ? "Rows are saved as drafts for approval." : "Guest / offline: rows are kept for this session only."}</p>
      <input type="file" id="eq-file" accept=".csv,text/csv"><ul class="warn-list" id="eq-imp-msg"></ul>`,
    actions: [{ label: "Cancel" }, { label: "Import", primary: true, onClick: async (close, root) => {
      const f = root.querySelector("#eq-file").files[0];
      if (!f) { RO.ui.toast("Choose a CSV file", "warn"); return; }
      const res = EQ.parseCsv(await f.text());
      root.querySelector("#eq-imp-msg").innerHTML = res.errors.map(x => `<li>${esc(x)}</li>`).join("");
      if (!res.records.length) { RO.ui.toast("No valid rows", "error"); return; }
      let n = 0;
      try {
        for (const r of res.records) { if (toServer) await api.post("/equipment", r); else EQ.saveSession(Object.assign({}, r)); n++; }
      } catch (x) { RO.ui.apiError(x, `Row ${n + 1}`); }
      EQ.invalidate();
      RO.ui.toast(`${n} entr${n === 1 ? "y" : "ies"} imported${res.errors.length ? ` · ${res.errors.length} row(s) skipped` : ""}`, res.errors.length ? "warn" : "ok", 5000);
      if (!res.errors.length) close();
    } }]
  });
}
RO.equipEditor = { open: (entry, onSaved) => equipEditor(entry, onSaved) };

/* ================= WIRING ================= */
function renderTabs() {
  TABS.innerHTML = TAB_DEFS.filter(t => !t.role || api.can(t.role))
    .map(t => `<button class="tab${t.id === tab ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");
  TABS.querySelectorAll("button.tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
}
function setTab(t, fromRoute) {
  const def = TAB_DEFS.find(x => x.id === t && (!x.role || api.can(x.role)));
  tab = def ? t : "fittings";
  ROOT.setAttribute("data-tab", tab);
  TABS.querySelectorAll("button.tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  if (!fromRoute && RO.app.isActive("libraries")) history.replaceState(null, "", "#/libraries/" + tab);
  refresh();
  RO.app.refresh();
}
function refresh() {
  if (!ROOT) return;
  const st = api.state;
  META.textContent = !st.online ? "Offline — bundled defaults; nothing can be saved"
    : st.user ? `Logged in as ${st.user.username} (${st.user.role})` : "Guest — read-only; session-only imports";
  if (tab === "fittings") renderFittings();
  if (tab === "pumps") renderPumps();
  if (tab === "equipment") renderEquipment();
  if (tab === "values") renderValues();
  if (tab === "users") renderUsers();
}

RO.pumpEditor = { open: pumpEditor };

RO.registerModule({
  id: "libraries",
  title: "Libraries",
  pageTitle: () => ({ fittings: "Fittings", pumps: "Pumps", equipment: "Equipment", values: "Recommended values", users: "Users & roles" })[tab],
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta; TABS = ctx.tabs;
    ROOT.innerHTML = MARKUP;
    renderTabs();
    $("lib-fit-import").addEventListener("click", importDialog);
    $("lib-pump-new").addEventListener("click", () => pumpEditor(null, renderPumps));
    $("lib-user-new").addEventListener("click", newUserDialog);
    $("lib-eq-cat").addEventListener("change", e => { eqCat = e.target.value; renderEquipment(); });
    $("lib-eq-new").addEventListener("click", () => equipEditor(null));
    $("lib-eq-import").addEventListener("click", equipImport);
    $("lib-eq-template").addEventListener("click", () => RO.csv.download("equipment_import_template.csv", RO.equiplib.templateCsv()));
    RO.equiplib.subscribe(() => { if (tab === "equipment") renderEquipment(); });
    api.subscribe(() => { renderTabs(); setTab(tab, true); });
    RO.values.subscribe(() => { if (tab === "values") renderValues(); });
    RO.pumplib.subscribe(() => { if (tab === "pumps") renderPumps(); });
    RO.units.subscribe(refresh);
    setTab("fittings", true);
  },
  onShow: refresh,
  onRoute(sub) { if (sub) setTab(sub, true); }
});
})(window.RO = window.RO || {});
