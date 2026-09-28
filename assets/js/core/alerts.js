/* ============================================================
   Alerts (bell) — real items only, until Automation alert rules exist:
     · approvers: fittings lists and pumps waiting for approval
     · engineers: their own drafts still waiting for an approver
   Read state is kept per browser (localStorage "roshell.alertsRead").
   ============================================================ */
(function (RO) {
"use strict";

const KEY = "roshell.alertsRead";
let items = [];
let readSet = new Set();
try { readSet = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (e) { /* none */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...readSet].slice(-500))); } catch (e) { /* not persisted */ } };
const when = iso => { if (!iso) return ""; const d = new Date(iso.replace(" ", "T")); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); };

async function refresh() {
  const st = RO.api.state;
  const out = [];
  if (st.online && st.user) {
    const approver = RO.api.can("approver"), me = st.user.username;
    try {
      const v = (await RO.api.get("/fittings/lists")).versions.filter(x => x.status === "draft");
      v.forEach(x => {
        const mine = x.created_by_name === me;
        if (!approver && !mine) return;
        out.push({ id: "fit-" + x.id, sev: approver ? "med" : "info", sevLabel: approver ? "Approval" : "Info",
          title: approver ? "Fittings list awaiting approval" : "Your fittings list awaits an approver",
          detail: `${x.list_name} v${x.version} · ${x.item_count} items`, meta: `Imported by ${x.created_by_name || "—"} · Libraries › Fittings`,
          time: when(x.created_at), target: "#/libraries/fittings" });
      });
    } catch (e) { /* library unavailable */ }
    try {
      const p = (await RO.api.get("/pumps")).pumps.filter(x => x.status === "draft");
      p.forEach(x => {
        const mine = x.owner_name === me;
        if (!approver && !mine) return;
        out.push({ id: "pump-" + x.id + "-" + (x.updated_at || ""), sev: approver ? "med" : "info", sevLabel: approver ? "Approval" : "Info",
          title: approver ? "Pump awaiting approval" : "Your pump awaits an approver",
          detail: `${x.vendor} ${x.model} · ${x.point_count} curve points`, meta: `Owner ${x.owner_name || "—"} · Libraries › Pumps`,
          time: when(x.updated_at), target: "#/libraries/pumps" });
      });
    } catch (e) { /* library unavailable */ }
  }
  items = out.map(a => Object.assign(a, { read: readSet.has(a.id) }));
  return items;
}

RO.alerts = {
  filter: "all",
  refresh,
  list: () => items,
  unread: () => items.filter(a => !a.read).length,
  markAll() { items.forEach(a => { a.read = true; readSet.add(a.id); }); save(); },
  open(id) { const a = items.find(x => x.id === id); if (!a) return null; a.read = true; readSet.add(id); save(); return a.target; }
};
})(window.RO = window.RO || {});
