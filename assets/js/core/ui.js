/* ============================================================
   Shared UI widgets: modal dialogs, confirm, toast notifications.
   ============================================================ */
(function (RO) {
"use strict";

const esc = s => RO.util.escHtml(s);

/**
 * Open a modal. opts: { title, body (HTML string), actions: [{ label, primary, danger, onClick(close) }], wide, onOpen(root) }
 * Returns { root, close }.
 */
function modal(opts) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML =
    `<div class="modal${opts.wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || "")}">` +
      `<div class="modal-head"><h3>${esc(opts.title || "")}</h3><button type="button" class="modal-x" aria-label="Close">✕</button></div>` +
      `<div class="modal-body">${opts.body || ""}</div>` +
      `<div class="modal-actions"></div>` +
    `</div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  back.querySelector(".modal-x").addEventListener("click", close);
  back.addEventListener("mousedown", e => { if (e.target === back) close(); });
  const bar = back.querySelector(".modal-actions");
  (opts.actions || [{ label: "Close" }]).forEach(a => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "");
    b.textContent = a.label;
    b.addEventListener("click", () => (a.onClick ? a.onClick(close, back) : close()));
    bar.appendChild(b);
  });
  const root = back.querySelector(".modal");
  if (opts.onOpen) opts.onOpen(root, close);
  const first = root.querySelector("input, select, textarea");
  if (first) first.focus();
  return { root, close };
}

function confirmBox(title, message, okLabel = "OK", danger = false) {
  return new Promise(resolve => {
    modal({
      title, body: `<p>${esc(message)}</p>`,
      actions: [
        { label: "Cancel", onClick: c => { c(); resolve(false); } },
        { label: okLabel, primary: !danger, danger, onClick: c => { c(); resolve(true); } }
      ]
    });
  });
}

function toast(message, kind = "info", ms = 3500) {
  let box = document.getElementById("toast-box");
  if (!box) { box = document.createElement("div"); box.id = "toast-box"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Show an API error consistently. */
function apiError(e, prefix = "") {
  toast((prefix ? prefix + ": " : "") + (e && e.message ? e.message : String(e)), "error", 6000);
}

RO.ui = { modal, confirm: confirmBox, toast, apiError };
})(window.RO = window.RO || {});
