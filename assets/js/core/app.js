/* ============================================================
   RO Workbench — application shell (Claude Design "RO Shell", round 1)

   Layout: icon rail (collapsed) or grouped sidebar (expanded) · drawer below 1100 px
           top bar: project switcher · search (Ctrl K) · units · connection · alerts · account
           page header: breadcrumb · title · actions · module sub-tabs
   Modules register with RO.registerModule(def):
     id, title, mount(ctx), onShow(), onRoute(sub), reset(), getState()/setState(s),
     exportMenu(), importJson(o)
     ctx = { root, meta, tabs, actions, app }  (meta/tabs/actions live in the page header)
   Routes: #/<module>/<tab> for live pages, #/soon/<item-id> for roadmap pages.
   ============================================================ */
(function (RO) {
"use strict";

const esc = s => RO.util.escHtml(s);
const I = (n, s, x) => RO.nav.icon(n, s, x);
const $ = id => document.getElementById(id);

const modules = [];
const byId = Object.create(null);
let activeId = null;       // module id, or "soon"
let soonId = null;         // roadmap item shown
let pop = null;            // drawer | switcher | palette | alerts | user
let q = "", qi = 0;
let width = window.innerWidth;

/* ---------- prefs ---------- */
const PREF_KEY = "roshell.prefs";
const prefs = (() => {
  const d = { expanded: false, roadmap: false, openGroups: { home: true, design: true, libraries: true, tools: true, reports: true, admin: true, operations: true } };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(PREF_KEY) || "{}")); } catch (e) { return d; }
})();
function savePrefs() {
  try {
    const cur = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(cur, { expanded: prefs.expanded, roadmap: prefs.roadmap, openGroups: prefs.openGroups })));
  } catch (e) { /* not persisted */ }
}

/* ---------- modules ---------- */
function registerModule(def) {
  if (!def || !def.id || typeof def.mount !== "function") throw new Error("Invalid module definition");
  if (byId[def.id]) throw new Error("Duplicate module id: " + def.id);
  modules.push(def);
  byId[def.id] = def;
}

function ensureMounted(def) {
  if (def._ctx) return def._ctx;
  const root = document.createElement("div");
  root.className = "module mod-layout mod-" + def.id;
  root.hidden = true;
  $("module-host").appendChild(root);
  const meta = document.createElement("div");
  meta.className = "page-meta"; meta.id = "meta-" + def.id; meta.hidden = true;
  $("hdr-meta").appendChild(meta);
  const tabs = document.createElement("nav");
  tabs.className = "tabs"; tabs.hidden = true; tabs.setAttribute("aria-label", def.title + " sections");
  $("hdr-tabs").appendChild(tabs);
  const actions = document.createElement("div");
  actions.className = "mod-actions"; actions.hidden = true;
  $("page-mod-actions").appendChild(actions);
  def._ctx = { root, meta, tabs, actions, app: RO.app };
  def.mount(def._ctx);
  return def._ctx;
}

/* ---------- roles / visibility ---------- */
const RANK = { guest: 0, viewer: 1, engineer: 2, approver: 3, admin: 4 };
const roleOf = () => (RO.api.state.user ? RO.api.state.user.role : "guest");
const allowed = it => !it.target || !it.target.minRole || RANK[roleOf()] >= RANK[it.target.minRole];
const currentItem = () => (activeId === "soon" ? RO.nav.find(soonId) : (activeId ? RO.nav.pageFor(activeId, currentTab()) : null));
function currentTab() {
  const def = byId[activeId];
  if (!def || !def._ctx) return null;
  const b = def._ctx.tabs.querySelector("button.tab.active");
  return b ? b.dataset.tab : null;
}
function visItems(a) {
  const cur = currentItem();
  return a.items.map(([id, label, status, target]) => ({ id, label, status, target: target || null, area: a.label, areaId: a.id }))
    .filter(it => allowed(it) && (prefs.roadmap || it.status === "live" || (cur && it.id === cur.id)));
}
const soonCount = () => RO.nav.allItems().filter(i => i.status === "soon").length;

/* ---------- navigation ---------- */
function go(itemId) {
  const it = RO.nav.find(itemId);
  if (!it) return;
  pop = null;
  prefs.openGroups[it.areaId] = true; savePrefs();
  location.hash = it.status === "live" && it.target
    ? "#/" + it.target.module + (it.target.tab ? "/" + it.target.tab : "")
    : "#/soon/" + it.id;
}
function startPage() { return RO.nav.find(RO.nav.START[roleOf()] || "intake"); }

function onHash() {
  const m = /^#\/([\w-]+)(?:\/([\w-]+))?/.exec(location.hash || "");
  if (!m) { go(startPage().id); return; }
  if (m[1] === "soon") { showSoon(m[2]); return; }
  if (!byId[m[1]]) { go(startPage().id); return; }
  activate(m[1], m[2]);
}

function hideAllModules() {
  modules.forEach(x => {
    if (!x._ctx) return;
    x._ctx.root.hidden = true; x._ctx.meta.hidden = true; x._ctx.tabs.hidden = true; x._ctx.actions.hidden = true;
  });
}

function activate(id, sub) {
  const def = byId[id];
  ensureMounted(def);
  $("soon-root").hidden = true;
  hideAllModules();
  activeId = id; soonId = null;
  const c = def._ctx;
  c.root.hidden = false; c.meta.hidden = false; c.actions.hidden = false;
  c.tabs.hidden = !c.tabs.children.length;
  if (def.onRoute) def.onRoute(sub);
  if (def.onShow) requestAnimationFrame(() => requestAnimationFrame(() => def.onShow()));
  renderChrome();
}

function showSoon(itemId) {
  const it = RO.nav.find(itemId);
  if (!it) { go(startPage().id); return; }
  hideAllModules();
  activeId = "soon"; soonId = itemId;
  const area = RO.nav.AREAS.find(a => a.id === it.areaId);
  const start = startPage();
  const root = $("soon-root");
  root.hidden = false;
  root.innerHTML = `
    <div class="soon-page">
      <p class="soon-text">Planned for ${esc(it.area)}. It appears in the sidebar once released. Turn on “Show roadmap” to see every planned page.</p>
      <div class="blueprint soon-roadmap">${corners()}
        <div class="kicker">${esc(it.area)} roadmap</div>
        <table class="table"><tbody>${area.items.map(([, label, status]) =>
          `<tr><td>${esc(label)}</td><td style="text-align:right"><span class="tag ${status === "live" ? "tag-accent" : "tag-neutral"}">${status === "live" ? "Available" : "Coming soon"}</span></td></tr>`).join("")}</tbody></table>
      </div>
      <button class="btn btn-secondary" id="soon-start">Go to my start screen · ${esc(start.area)} › ${esc(start.label)}</button>
    </div>`;
  $("soon-start").addEventListener("click", () => go(start.id));
  renderChrome();
}

const corners = () => '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';

/* ---------- chrome rendering ---------- */
function renderChrome() {
  width = window.innerWidth;
  const narrow = width < 1100, wide = width >= 1280;
  const it = currentItem();
  const shell = $("shell");
  shell.classList.toggle("is-narrow", narrow);
  shell.classList.toggle("is-expanded", !narrow && prefs.expanded);

  // rail (collapsed, wide screens)
  const rail = $("rail");
  rail.hidden = narrow || prefs.expanded;
  if (!rail.hidden) {
    const areas = RO.nav.AREAS.filter(a => visItems(a).length);
    rail.innerHTML =
      `<button class="rail-brand" data-act="expand" title="RO Workbench — expand navigation">${I("drop")}</button>` +
      areas.map(a => `<button class="rail-btn${it && it.areaId === a.id ? " active" : ""}" data-area="${a.id}" title="${esc(a.label)}" aria-label="${esc(a.label)}">${I(a.id)}</button>`).join("") +
      `<div class="grow"></div><button class="rail-btn" data-act="expand" title="Expand navigation" aria-label="Expand navigation">${I("panelOpen")}</button>`;
  }

  // sidebar (expanded) or drawer (narrow)
  const side = $("side");
  const showSide = (!narrow && prefs.expanded) || (narrow && pop === "drawer");
  side.hidden = !showSide;
  side.classList.toggle("drawer", narrow);
  $("drawer-scrim").hidden = !(narrow && pop === "drawer");
  if (showSide) {
    const areas = RO.nav.AREAS.filter(a => visItems(a).length);
    side.innerHTML = `
      <div class="side-head">
        <div class="side-logo">${I("drop")}</div>
        <div class="side-title">RO Workbench</div>
        <button class="side-collapse" data-act="collapse" title="Collapse navigation" aria-label="Collapse navigation">${I("panelClose")}</button>
      </div>
      <div class="side-body">${areas.map(a => {
        const open = !!prefs.openGroups[a.id];
        return `<div class="side-group">
          <button class="side-area${it && it.areaId === a.id ? " current" : ""}" data-group="${a.id}" aria-expanded="${open}">
            ${I(a.id)}<span>${esc(a.label)}</span>${I("chevronRight", 14, `class="chev${open ? " open" : ""}"`)}
          </button>
          ${open ? `<div class="side-items">${visItems(a).map(x =>
            `<button class="side-item${it && x.id === it.id ? " active" : ""}${x.status === "soon" ? " soon" : ""}" data-go="${x.id}" ${it && x.id === it.id ? 'aria-current="page"' : ""}>
               <span>${esc(x.label)}</span>${x.status === "soon" ? '<span class="tag tag-neutral soon-tag">Soon</span>' : ""}</button>`).join("")}</div>` : ""}
        </div>`;
      }).join("")}</div>
      <div class="side-foot"><label class="roadmap-toggle"><input type="checkbox" data-act="roadmap" ${prefs.roadmap ? "checked" : ""}><span>Show roadmap</span><span class="dim">${soonCount()} planned</span></label></div>`;
  }

  // top bar
  $("btn-drawer").hidden = !narrow;
  const st = RO.api.state;
  const offline = st.checked && !st.online;
  const guest = !st.user;
  $("net-status").innerHTML = offline
    ? `<span class="tag net-off">${I("wifiOff", 14)}Offline</span>`
    : (st.online ? `<span class="net-ok" title="Connected to the server">${I("cloudOk", 14)}Online</span>` : "");
  $("guest-tag").hidden = !guest;
  const unread = RO.alerts.unread();
  $("alerts-btn").innerHTML = I("bell", 20) + (unread ? `<span class="badge-count">${unread}</span>` : "");
  $("alerts-btn").setAttribute("aria-label", `Alerts, ${unread} unread`);
  const u = st.user;
  const initials = u ? (u.display_name || u.username).split(/[\s._-]+/).map(s => s[0]).join("").slice(0, 2).toUpperCase() : "G";
  $("account").innerHTML = `<button class="user-btn" data-act="user" aria-haspopup="menu">
      <span class="avatar">${esc(initials)}</span>
      ${wide ? `<span class="user-lines"><span class="user-name">${esc(u ? (u.display_name || u.username) : "Guest")}</span><span class="user-role">${esc(u ? roleLabel(u.role) : "Not signed in")}</span></span>` : ""}
    </button>`;
  syncUnits();

  // banners
  $("banner-offline").hidden = !offline;
  $("banner-guest").hidden = !(guest && st.checked && st.online);

  // page header
  const crumbs = [];
  if (it) {
    const area = RO.nav.AREAS.find(a => a.id === it.areaId);
    const first = area.items.find(i => i[2] === "live") || area.items[0];
    crumbs.push({ label: it.area, go: first[0] }, { label: it.label, go: it.id });
    const tb = byId[activeId] && byId[activeId]._ctx && byId[activeId]._ctx.tabs.querySelector("button.tab.active");
    if (tb && activeId !== "libraries" && activeId !== "tools") crumbs.push({ label: tb.textContent.trim() });
  }
  $("crumbs").innerHTML = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    return last ? `<span class="crumb-cur">${esc(c.label)}</span>` : `<button class="crumb" data-go="${c.go}">${esc(c.label)}</button><span class="crumb-sep" aria-hidden="true">/</span>`;
  }).join("");
  const def = byId[activeId];
  $("page-title").textContent = activeId === "soon" ? it.label : (def && def.pageTitle ? def.pageTitle() : (it ? it.label : ""));
  $("page-soon-tag").hidden = activeId !== "soon";
  document.title = (it ? it.label + " · " : "") + "RO Workbench";
  const d = byId[activeId];
  $("btn-export").hidden = !(d && d.exportMenu);
  $("btn-import").hidden = !(d && d.importJson);
  $("btn-reset").hidden = !(d && d.reset);
  $("btn-print").hidden = activeId === "soon";

  renderPop();
}

const roleLabel = r => ({ viewer: "Viewer", engineer: "Engineer", approver: "Approver", admin: "Administrator" })[r] || r;

function syncUnits() {
  const s = RO.units.system();
  $("u-si").checked = s === "si";
  $("u-imp").checked = s === "imp";
}

/* ---------- popovers ---------- */
function openPop(p) { pop = pop === p ? null : p; q = ""; qi = 0; renderChrome(); if (pop === "palette") setTimeout(() => { const i = $("pal-q"); if (i) i.focus(); }, 0); }
function closePop() { if (pop) { pop = null; renderChrome(); } }

function renderPop() {
  const box = $("pop");
  const scrim = $("pop-scrim");
  const any = ["switcher", "palette", "alerts", "user"].includes(pop);
  scrim.hidden = !any;
  scrim.classList.toggle("dim", pop === "palette" || pop === "alerts");
  if (!any) { box.innerHTML = ""; box.className = ""; return; }
  box.className = "pop pop-" + pop;
  if (pop === "switcher") box.innerHTML = switcherHtml();
  if (pop === "palette") { box.innerHTML = paletteHtml(); bindPalette(); }
  if (pop === "alerts") box.innerHTML = alertsHtml();
  if (pop === "user") box.innerHTML = userHtml();
  const narrow = width < 1100;
  if (pop === "switcher") box.style.left = narrow ? "12px" : (prefs.expanded ? "276px" : "68px");
}

function switcherHtml() {
  const col = (title, body) => `<div class="sw-col"><div class="sw-head">${title}</div>${body}</div>`;
  return `<div role="dialog" aria-label="Switch project, plant and train">
    <div class="sw-grid">
      ${col("Project", `<div class="sw-empty">No projects yet.</div>`)}
      ${col("Plant", `<div class="sw-empty">—</div>`)}
      ${col("RO train", `<div class="sw-empty">—</div>`)}
    </div>
    <div class="sw-foot">You are working <strong>standalone</strong>: calculations are not linked to a project. Projects, plants and trains arrive with project profiles (Admin › Projects, on the roadmap). Every page, calculation and alert will then follow the selected train.</div>
  </div>`;
}

function paletteEntries() {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = t => words.every(w => t.toLowerCase().includes(w));
  const pages = [], soon = [];
  RO.nav.AREAS.forEach(a => a.items.forEach(([id, label, status, target]) => {
    const it = { id, label, status, target: target || null };
    if (!allowed(it)) return;
    const e = { label, sub: a.label, soon: status === "soon", run: () => go(id), key: label + " " + a.label };
    (e.soon ? soon : pages).push(e);
  }));
  const d = byId[activeId];
  const acts = [
    { label: RO.units.isImperial() ? "Switch to SI units" : "Switch to Imperial units", sub: "Units", run: () => { RO.units.set(RO.units.isImperial() ? "si" : "imp"); closePop(); } },
    { label: prefs.expanded ? "Collapse sidebar" : "Expand sidebar", sub: "View", run: () => { prefs.expanded = !prefs.expanded; savePrefs(); closePop(); } },
    { label: "Open alerts", sub: RO.alerts.unread() + " unread", run: () => openPop("alerts") },
    { label: prefs.roadmap ? "Hide roadmap pages" : "Show roadmap pages", sub: "Navigation", run: () => { prefs.roadmap = !prefs.roadmap; savePrefs(); closePop(); } }
  ];
  if (d && d.exportMenu) acts.push({ label: "Export this page", sub: "File", run: () => { closePop(); exportDialog(); } });
  if (d && d.importJson) acts.push({ label: "Import a calculation file", sub: "File", run: () => { closePop(); importPick(); } });
  if (activeId !== "soon") acts.push({ label: "Print / save as PDF", sub: "File", run: () => { closePop(); window.print(); } });
  acts.push(RO.api.state.user ? { label: "Log out", sub: "Account", run: async () => { closePop(); await RO.api.logout(); } }
    : { label: "Sign in", sub: "Account", run: () => { closePop(); RO.authui.loginDialog(); } });
  let groups = [["Pages", pages], ["Actions", acts], ["Coming soon", soon]]
    .map(([l, arr]) => [l, arr.filter(e => match(e.key || (e.label + " " + e.sub)))]).filter(g => g[1].length);
  if (!words.length) groups = groups.map(([l, a]) => [l, l === "Pages" ? a : a.slice(0, 4)]);
  return groups;
}

function paletteHtml() {
  const groups = paletteEntries();
  let idx = 0;
  const flat = [].concat(...groups.map(g => g[1]));
  qi = Math.min(qi, Math.max(0, flat.length - 1));
  return `<div role="dialog" aria-label="Command palette">
    <div class="pal-top">${I("search", 18)}<input id="pal-q" value="${esc(q)}" placeholder="Search pages and actions" aria-label="Search"><kbd>Esc</kbd></div>
    <div class="pal-list">${groups.map(([l, arr]) => `<div class="pal-group">${esc(l)}</div>` + arr.map(e => {
      const i = idx++;
      return `<button class="pal-item${i === qi ? " on" : ""}${e.soon ? " soon" : ""}" data-pi="${i}"><span class="grow">${esc(e.label)}</span><span class="dim">${esc(e.sub)}</span>${e.soon ? '<span class="tag tag-neutral soon-tag">Coming soon</span>' : ""}</button>`;
    }).join("")).join("")}
    ${flat.length ? "" : `<div class="pal-empty">No pages or actions match “${esc(q)}”.</div>`}</div>
    <div class="pal-foot"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
  </div>`;
}

function bindPalette() {
  const flat = [].concat(...paletteEntries().map(g => g[1]));
  const input = $("pal-q");
  input.addEventListener("input", () => { q = input.value; qi = 0; const pos = input.selectionStart; renderPop(); const i = $("pal-q"); i.focus(); i.setSelectionRange(pos, pos); });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); qi = Math.min(qi + 1, flat.length - 1); renderPop(); $("pal-q").focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); qi = Math.max(qi - 1, 0); renderPop(); $("pal-q").focus(); }
    else if (e.key === "Enter" && flat[qi]) { e.preventDefault(); flat[qi].run(); }
  });
  $("pop").querySelectorAll("[data-pi]").forEach(b => {
    b.addEventListener("click", () => flat[+b.dataset.pi].run());
    b.addEventListener("mouseenter", () => { qi = +b.dataset.pi; $("pop").querySelectorAll(".pal-item").forEach(x => x.classList.toggle("on", x === b)); });
  });
}

function alertsHtml() {
  const f = RO.alerts.filter;
  const rows = RO.alerts.list().filter(a => f === "all" || !a.read);
  return `<aside role="dialog" aria-label="Alerts" class="alerts">
    <div class="al-head"><h2>Alerts</h2><button class="btn btn-ghost" data-act="markall" ${RO.alerts.unread() ? "" : "disabled"}>Mark all read</button>
      <button class="icon-x" data-act="close" aria-label="Close alerts">×</button></div>
    <div class="al-filter"><div class="seg">
      <label class="seg-opt"><input type="radio" name="af" value="all" ${f === "all" ? "checked" : ""}>All</label>
      <label class="seg-opt"><input type="radio" name="af" value="unread" ${f === "unread" ? "checked" : ""}>Unread · ${RO.alerts.unread()}</label></div>
      <span class="dim">${RO.api.state.user ? "Your approvals and library activity" : "Sign in to see alerts"}</span></div>
    <div class="al-list">${rows.map(a => `<button class="al-row" data-alert="${esc(a.id)}">
        <span class="al-dot${a.read ? "" : " unread"}"></span>
        <span class="al-main"><span class="al-top"><span class="tag ${a.sev === "high" ? "tag-solid" : a.sev === "med" ? "tag-outline" : "tag-neutral"} al-sev">${esc(a.sevLabel)}</span>
          <span class="al-title${a.read ? "" : " unread"}">${esc(a.title)}</span><span class="dim">${esc(a.time || "")}</span></span>
          <span class="al-detail">${esc(a.detail)}</span><span class="dim">${esc(a.meta || "")}</span></span></button>`).join("") ||
        `<p class="al-empty">${f === "unread" ? "No unread alerts." : "No alerts. Items waiting for your approval appear here."}</p>`}</div>
    <div class="al-foot">Alert rules are configured in Automation (coming soon).</div>
  </aside>`;
}

function userHtml() {
  const u = RO.api.state.user;
  const start = startPage();
  return `<div role="menu" class="user-menu">
    <div class="um-head"><div class="um-name">${esc(u ? (u.display_name || u.username) : "Guest")}</div>
      <div class="dim">${esc(u ? roleLabel(u.role) : "Not signed in")} · starts on ${esc(start.area)} › ${esc(start.label)}</div></div>
    ${u ? `<button class="um-item" data-act="password">Change password</button><button class="um-item" data-act="logout">Log out</button>`
        : (RO.api.state.online ? `<button class="um-item" data-act="login">Sign in</button>` : `<div class="um-note">Offline — sign-in needs the server.</div>`)}
  </div>`;
}

/* ---------- export / import (module hooks) ---------- */
function exportDialog() {
  const d = byId[activeId];
  const items = d.exportMenu();
  RO.ui.modal({
    title: "Export — " + (currentItem() ? currentItem().label : d.title),
    body: `<p class="hint">Exports are generated in your browser; nothing is stored on the server. A JSON export can be imported again later to continue the calculation.</p>
           <div class="export-list">${items.map((it, i) =>
             `<button type="button" class="btn btn-secondary export-item" data-i="${i}"><strong>${esc(it.label)}</strong><span>${esc(it.hint || "")}</span></button>`).join("")}</div>`,
    onOpen: (root, close) => root.querySelectorAll(".export-item").forEach(b =>
      b.addEventListener("click", () => { close(); items[+b.dataset.i].run(); }))
  });
}
function importPick() {
  const d = byId[activeId];
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    try { d.importJson(JSON.parse(await f.text())); RO.ui.toast(`Imported ${f.name}`, "ok"); }
    catch (e) { RO.ui.toast("Import failed: " + e.message, "error", 6000); }
  });
  input.click();
}

/* ---------- events ---------- */
function bindShell() {
  document.addEventListener("click", e => {
    const t = e.target;
    const goBtn = t.closest("[data-go]");
    if (goBtn && !t.closest(".module")) { go(goBtn.dataset.go); return; }
    const area = t.closest("[data-area]");
    if (area) { prefs.expanded = true; prefs.openGroups[area.dataset.area] = true; savePrefs(); renderChrome(); return; }
    const grp = t.closest("[data-group]");
    if (grp) { prefs.openGroups[grp.dataset.group] = !prefs.openGroups[grp.dataset.group]; savePrefs(); renderChrome(); return; }
    const act = t.closest("[data-act]");
    if (act && !t.closest(".module") && !t.closest(".modal")) {
      const a = act.dataset.act;
      if (a === "expand") { prefs.expanded = true; savePrefs(); renderChrome(); }
      if (a === "collapse") { prefs.expanded = false; pop = null; savePrefs(); renderChrome(); }
      if (a === "user") openPop("user");
      if (a === "close") closePop();
      if (a === "markall") { RO.alerts.markAll(); renderChrome(); }
      if (a === "login") { closePop(); RO.authui.loginDialog(); }
      if (a === "logout") { closePop(); RO.api.logout().then(() => RO.ui.toast("Logged out")); }
      if (a === "password") { closePop(); RO.authui.passwordDialog(false); }
      return;
    }
    const al = t.closest("[data-alert]");
    if (al) { const target = RO.alerts.open(al.dataset.alert); closePop(); if (target) location.hash = target; }
  });
  document.addEventListener("change", e => {
    if (e.target.matches("[data-act=roadmap]")) { prefs.roadmap = e.target.checked; savePrefs(); renderChrome(); }
    if (e.target.name === "af") { RO.alerts.filter = e.target.value; renderPop(); }
    if (e.target.name === "units") RO.units.set(e.target.value);
  });
  $("btn-drawer").addEventListener("click", () => openPop("drawer"));
  $("drawer-scrim").addEventListener("click", closePop);
  $("pop-scrim").addEventListener("click", closePop);
  $("ctx-btn").addEventListener("click", () => openPop("switcher"));
  $("search-btn").addEventListener("click", () => openPop("palette"));
  $("alerts-btn").addEventListener("click", () => { RO.alerts.refresh().then(renderChrome); openPop("alerts"); });
  $("guest-signin").addEventListener("click", () => RO.authui.loginDialog());
  $("btn-reset").addEventListener("click", () => { const d = byId[activeId]; if (d && d.reset) d.reset(); });
  $("btn-print").addEventListener("click", () => window.print());
  $("btn-export").addEventListener("click", exportDialog);
  $("btn-import").addEventListener("click", importPick);
  $("hdr-tabs").addEventListener("click", () => setTimeout(renderChrome, 0));
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPop("palette"); }
    else if (e.key === "Escape" && pop && !document.querySelector(".modal-back")) closePop();
  });
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (window.innerWidth >= 1100 && pop === "drawer") pop = null; renderChrome(); }, 60); });
  window.addEventListener("hashchange", onHash);
  RO.api.subscribe(() => { RO.alerts.refresh().then(renderChrome); renderChrome(); });
  RO.units.subscribe(renderChrome);
}

async function start() {
  if (!modules.length) return;
  if (RO.api) await RO.api.init();
  if (RO.values) await RO.values.load();
  if (RO.fittings) await RO.fittings.loadRecommended();
  bindShell();
  RO.alerts.refresh().then(renderChrome);
  onHash();
}

RO.app = {
  registerModule, start, go, refresh: () => renderChrome(),
  /** Mount a module without showing it (e.g. to hand data to it) and return its definition. */
  ensure: id => (byId[id] ? (ensureMounted(byId[id]), byId[id]) : null),
  get activeId() { return activeId; },
  isActive: id => activeId === id,
  modules: () => modules.slice(),
  snapshot() {
    const s = { version: 1, fluid: RO.fluid ? RO.fluid.get() : null, units: RO.units.system(), modules: {} };
    modules.forEach(m => { if (m._ctx && m.getState) s.modules[m.id] = m.getState(); });
    return s;
  },
  restore(s) {
    if (!s) return;
    if (s.fluid && RO.fluid) RO.fluid.set(s.fluid, "restore");
    Object.keys(s.modules || {}).forEach(id => {
      const m = byId[id];
      if (!m || !m.setState) return;
      ensureMounted(m);
      m.setState(s.modules[id]);
    });
  }
};
RO.registerModule = registerModule;
})(window.RO = window.RO || {});
