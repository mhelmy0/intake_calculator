/* ============================================================
   API client + session state.
   Works offline (file:// or API down): the app runs as a guest with the
   bundled recommended values / fittings list, and saving is disabled.
   ============================================================ */
(function (RO) {
"use strict";

const BASE = "api/index.php";
const subs = new Set();
const state = { online: false, user: null, csrf: null, checked: false };

class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

async function request(method, path, body) {
  const opts = { method, headers: { "Accept": "application/json" }, credentials: "same-origin" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (method !== "GET" && state.csrf) opts.headers["X-CSRF-Token"] = state.csrf;
  let res;
  try { res = await fetch(BASE + path, opts); }
  catch (e) { throw new ApiError(0, "Server not reachable — working offline"); }
  const ctype = res.headers.get("Content-Type") || "";
  const data = ctype.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || ("HTTP " + res.status), data);
  return data;
}

function emit() { subs.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }

async function init() {
  if (location.protocol === "file:") { state.checked = true; emit(); return state; }
  try {
    const j = await request("GET", "/auth/me");
    state.online = true; state.user = j.user; state.csrf = j.csrf;
  } catch (e) {
    state.online = false; state.user = null;
  }
  state.checked = true;
  emit();
  return state;
}

async function login(username, password) {
  const j = await request("POST", "/auth/login", { username, password });
  state.user = j.user; state.csrf = j.csrf; emit();
  return j.user;
}
async function logout() {
  const j = await request("POST", "/auth/logout");
  state.user = null; state.csrf = j.csrf; emit();
}
async function changePassword(current, next) {
  await request("POST", "/auth/password", { current, new: next });
  const j = await request("GET", "/auth/me");
  state.user = j.user; state.csrf = j.csrf; emit();
}

const RANK = { viewer: 1, engineer: 2, approver: 3, admin: 4 };
function can(minRole) { return !!state.user && (RANK[state.user.role] || 0) >= RANK[minRole]; }

RO.api = {
  ApiError, state, init, login, logout, changePassword, can,
  get: p => request("GET", p),
  post: (p, b) => request("POST", p, b === undefined ? {} : b),
  put: (p, b) => request("PUT", p, b),
  patch: (p, b) => request("PATCH", p, b),
  del: p => request("DELETE", p),
  url: p => BASE + p,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
};
})(window.RO = window.RO || {});
