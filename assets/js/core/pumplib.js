/* ============================================================
   Pump library access: server pumps (approved + own drafts) merged with
   session-only pumps (guests / offline — kept in sessionStorage, never sent
   to the server, lost when the browser tab closes unless exported).
   ============================================================ */
(function (RO) {
"use strict";

const KEY = "rocalc.sessionPumps";
const subs = new Set();
let cache = null;

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
}
function writeSession(list) {
  try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable — kept in memory only */ }
  memory = list;
}
let memory = null;
const sessionList = () => memory || (memory = readSession());

function emit() { cache = null; subs.forEach(fn => fn()); }

/** Summary list of all visible pumps. */
async function list() {
  if (cache) return cache;
  let server = [];
  if (RO.api.state.online) {
    try { server = (await RO.api.get("/pumps")).pumps.map(p => Object.assign(p, { origin: "server" })); }
    catch (e) { RO.ui && RO.ui.apiError(e, "Pump library"); }
  }
  const sess = sessionList().map(p => Object.assign({}, p, { origin: "session", status: "session", point_count: p.points.length }));
  cache = server.concat(sess);
  return cache;
}

/** Full pump record with curve points. */
async function get(id) {
  if (String(id).startsWith("s")) {
    const p = sessionList().find(x => x.id === id);
    if (!p) throw new Error("Session pump not found");
    return Object.assign({}, p, { origin: "session", status: "session" });
  }
  const j = await RO.api.get("/pumps/" + id);
  return Object.assign(j.pump, { origin: "server" });
}

function saveSession(p) {
  const list = sessionList().slice();
  if (!p.id) p.id = "s" + Date.now().toString(36);
  const i = list.findIndex(x => x.id === p.id);
  if (i >= 0) list[i] = p; else list.push(p);
  writeSession(list);
  emit();
  return p;
}
function deleteSession(id) { writeSession(sessionList().filter(x => x.id !== id)); emit(); }

RO.pumplib = {
  list, get, saveSession, deleteSession, sessionList, invalidate: emit,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
};
})(window.RO = window.RO || {});
