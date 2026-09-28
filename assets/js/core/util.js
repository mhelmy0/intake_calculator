/* ============================================================
   RO Plant Design Calculator — shared UI helpers
   Used by every module (value cards, checks lists, canvas, steps).
   ============================================================ */
(function (RO) {
"use strict";

const $ = id => document.getElementById(id);

function fmt(v, d = 3) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1e6) return v.toExponential(2);
  return Number(v).toFixed(d);
}
function fmtExp(v, d = 2) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return Number(v).toExponential(d);
}
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/* Set a .value-card's value / unit / pass-warn-fail status by element id. */
function setVC(id, value, unit, status) {
  const el = $(id);
  if (!el) return;
  const vEl = el.querySelector(".v-val");
  if (vEl) vEl.textContent = value;
  if (unit !== undefined && unit !== null) {
    const uEl = el.querySelector(".v-unit");
    if (uEl) uEl.textContent = unit;
  }
  el.classList.remove("pass", "warn", "fail");
  if (status) el.classList.add(status);
}

/* checks: [{ name, desc, val, status: "pass"|"warn"|"fail" }] */
function renderChecksList(summaryId, listId, checks) {
  const failed = checks.filter(c => c.status === "fail").length;
  const warned = checks.filter(c => c.status === "warn").length;
  const summary = $(summaryId);
  if (summary) {
    if (failed > 0) {
      summary.className = "checks-summary fail";
      summary.textContent = `${failed} Check${failed === 1 ? "" : "s"} Failed`;
    } else if (warned > 0) {
      summary.className = "checks-summary warn";
      summary.textContent = `${warned} Marginal · ${checks.length - warned} Passed`;
    } else {
      summary.className = "checks-summary allpass";
      summary.textContent = "All Checks Passed ✓";
    }
  }
  const list = $(listId);
  if (!list) return;
  list.innerHTML = "";
  checks.forEach(c => {
    const row = document.createElement("div");
    row.className = "check-row " + c.status;
    const badgeText = c.status === "pass" ? "PASS" : (c.status === "warn" ? "WARN" : "FAIL");
    row.innerHTML =
      `<div class="info">` +
        `<div class="name">${escHtml(c.name)}</div>` +
        `<div class="desc">${escHtml(c.desc)} · ${escHtml(c.val)}</div>` +
      `</div>` +
      `<span class="badge ${c.status}">${badgeText}</span>`;
    list.appendChild(row);
  });
}

function showWarning(elId, msg) {
  const el = $(elId);
  if (!el) return;
  if (msg) {
    el.textContent = "⚠ " + msg;
    el.classList.add("show");
  } else {
    el.textContent = "";
    el.classList.remove("show");
  }
}

/* Step-by-step calculation trace (PRD: traceability).
   steps: [{ label, eq, sub, res, note }] or { head: "Section title" } */
function renderSteps(elId, steps) {
  const el = $(elId);
  if (!el) return;
  let n = 0;
  el.innerHTML = steps.map(s => {
    if (s.head) return `<div class="step-head">${escHtml(s.head)}</div>`;
    n++;
    return `<div class="step">` +
      `<div class="step-top"><span class="step-n">${n}</span><span class="step-label">${escHtml(s.label)}</span></div>` +
      (s.eq  ? `<div class="step-eq">${escHtml(s.eq)}</div>` : "") +
      (s.sub ? `<div class="step-sub">${escHtml(s.sub)}</div>` : "") +
      (s.res ? `<div class="step-res">${escHtml(s.res)}</div>` : "") +
      (s.note ? `<div class="step-note">${escHtml(s.note)}</div>` : "") +
    `</div>`;
  }).join("");
}

/* Collapsible left-panel cards (click the h2). */
function bindCollapsibles(root) {
  root.querySelectorAll("aside.left-panel .card > h2").forEach(h => {
    h.addEventListener("click", e => {
      if (e.target.closest("input,select,button")) return;
      h.parentElement.classList.toggle("collapsed");
    });
  });
}

/* ---------- Canvas ---------- */
function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  const w = Math.max(rect.width,  50);
  const h = Math.max(rect.height, 50);
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
function clearBg(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "#f2f2f3";
  ctx.fillRect(0, 0, w, h);
}

RO.util = {
  $, fmt, fmtExp, escHtml, setVC, renderChecksList, showWarning,
  renderSteps, bindCollapsibles, fitCanvas, clearBg
};
})(window.RO = window.RO || {});
