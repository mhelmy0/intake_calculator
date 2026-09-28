/* ============================================================
   Navigation map for the RO Workbench shell (Claude Design "RO Shell").
   Each item: [id, label, status, target]
     status  "live" = exists today · "soon" = on the roadmap (shown when "Show roadmap" is on)
     target  { module, tab } for live pages; minRole restricts visibility.
   ============================================================ */
(function (RO) {
"use strict";

/* Lucide-style icon paths (24×24, stroke) from the design. */
const ICONS = {
  home: ["M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  design: ["M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z", "m14.5 12.5 2-2", "m11.5 9.5 2-2", "m8.5 6.5 2-2", "m17.5 15.5 2-2"],
  inspection: ["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "m9 14 2 2 4-4"],
  commissioning: ["M12 2v10", "M18.4 6.6a9 9 0 1 1-12.77.04"],
  operations: ["M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"],
  maintenance: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"],
  automation: ["M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 11v4a2 2 0 0 0 2 2h4", "M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"],
  reports: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M16 13H8", "M16 17H8", "M10 9H8"],
  libraries: ["m16 6 4 14", "M12 6v14", "M8 8v12", "M4 4v16"],
  tools: ["M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M8 6h8", "M16 14v4", "M16 10h.01", "M12 10h.01", "M8 10h.01", "M12 14h.01", "M8 14h.01", "M12 18h.01", "M8 18h.01"],
  admin: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"],
  drop: ["M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"],
  panelOpen: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 3v18", "m14 9 3 3-3 3"],
  panelClose: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 3v18", "m16 15-3-3 3-3"],
  chevronRight: ["m9 18 6-6-6-6"],
  chevronDown: ["m6 9 6 6 6-6"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  layers: ["m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z", "m2 12 8.58 3.91a2 2 0 0 0 1.66 0L21 12", "m2 17 8.58 3.91a2 2 0 0 0 1.66 0L21 17"],
  search: ["M21 21l-4.3-4.3", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"],
  wifiOff: ["M12 20h.01", "M8.5 16.43a5 5 0 0 1 7 0", "M2 8.82a15 15 0 0 1 4.18-2.65", "M10.66 5c4.01-.36 8.14.9 11.34 3.76", "M5 12.86a10 10 0 0 1 5.17-2.7", "m2 2 20 20"],
  cloudOk: ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z", "m9 14 2 2 4-4"],
  bell: ["M10.27 21a2 2 0 0 0 3.46 0", "M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"],
  check: ["M20 6 9 17l-5-5"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4"]
};

/** Inline SVG markup for an icon. */
function icon(name, size = 18, extra = "") {
  const paths = ICONS[name] || [];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths.map(d => `<path d="${d}"></path>`).join("")}</svg>`;
}

const L = (module, tab) => ({ module, tab });

const AREAS = [
  { id: "home", label: "Home", items: [
    ["home", "Dashboard", "live", L("home")]] },
  { id: "design", label: "Design", items: [
    ["intake", "Intake", "live", L("intake")],
    ["pretreat", "Pretreatment", "live", L("pretreat")], ["projection", "Membrane projection", "soon"], ["massbal", "Mass balance", "soon"],
    ["hppump", "HP pump & ERD", "soon"], ["bom", "Bill of materials", "live", L("bom")], ["buoyancy", "Supports & buoyancy", "live", L("buoyancy")]] },
  { id: "inspection", label: "Inspection", items: [["checklists", "Checklists", "soon"], ["punch", "Punch list", "soon"]] },
  { id: "commissioning", label: "Commissioning", items: [["precomm", "Pre-commissioning", "soon"], ["startup", "Start-up log", "soon"], ["perftest", "Performance test", "soon"]] },
  { id: "operations", label: "Operations", items: [["production", "Production dashboard", "soon"], ["shiftlog", "Shift log", "soon"], ["normalised", "Normalised data", "soon"]] },
  { id: "maintenance", label: "Maintenance", items: [["workorders", "Work orders", "soon"], ["cip", "CIP schedule", "soon"], ["elements", "Membrane replacement", "soon"]] },
  { id: "automation", label: "Automation", items: [["rules", "Alert rules", "soon"], ["integrations", "Integrations", "soon"]] },
  { id: "reports", label: "Reports", items: [["calcreports", "Calculation reports", "soon"], ["exports", "Export history", "soon"]] },
  { id: "libraries", label: "Libraries", items: [
    ["fittings", "Fittings", "live", L("libraries", "fittings")], ["pumps", "Pumps", "live", L("libraries", "pumps")],
    ["equipment", "Equipment", "live", L("libraries", "equipment")],
    ["values", "Recommended values", "live", L("libraries", "values")],
    ["pipes", "Pipe schedules", "soon"], ["membranes", "Membranes", "soon"], ["chemicals", "Chemicals", "soon"]] },
  { id: "tools", label: "Tools", items: [
    ["velocity", "Line velocity", "live", L("tools", "velocity")], ["fluid", "Fluid properties", "live", L("tools", "fluid")],
    ["pipeline", "Pipeline design", "live", L("pipeline")], ["pdf", "PDF toolkit", "live", L("pdftools")], ["converter", "Unit converter", "soon"], ["osmotic", "Osmotic pressure", "soon"]] },
  { id: "admin", label: "Admin", items: [
    ["users", "Users & roles", "live", Object.assign(L("libraries", "users"), { minRole: "admin" })],
    ["projects", "Projects", "soon"], ["settings", "Settings", "soon"]] }
];

/* Start page per role (design: engineers start on Intake; operators / admins on Home). */
const START = { guest: "intake", viewer: "home", engineer: "intake", approver: "intake", admin: "home" };

function allItems() {
  const out = [];
  AREAS.forEach(a => a.items.forEach(([id, label, status, target]) => out.push({ id, label, status, target: target || null, area: a.label, areaId: a.id })));
  return out;
}
const find = id => allItems().find(i => i.id === id) || null;

/** Page for a module + tab (falls back to the module's first page). */
function pageFor(module, tab) {
  const items = allItems().filter(i => i.target && i.target.module === module);
  return items.find(i => i.target.tab === tab) || items.find(i => !i.target.tab) || items[0] || null;
}

RO.nav = { ICONS, icon, AREAS, START, allItems, find, pageFor };
})(window.RO = window.RO || {});
